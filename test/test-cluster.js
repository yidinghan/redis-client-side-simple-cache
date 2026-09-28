const { test } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const redis = require('redis');
const { createCachedCluster } = require('../src/cluster');

const urls = (process.env.REDIS_CLUSTER_URLS || '').split(',').map(url => url.trim()).filter(Boolean);

function assertBounded(cache, maxEntries) {
  const entries = new Map(cache.entryEntries());
  const keySets = [...cache.keySetEntries()];
  let references = 0;

  assert.strictEqual(entries.size, cache.size());
  assert.ok(entries.size <= maxEntries, 'Main entries must stay within capacity');
  for (const [, cacheKeys] of keySets) {
    assert.ok(cacheKeys.size > 0, 'Empty reverse sets must be removed');
    for (const cacheKey of cacheKeys) {
      assert.ok(entries.has(cacheKey), 'Reverse references must point to live entries');
      references++;
    }
  }
  // Every cached command here references exactly one distinct Redis key.
  assert.strictEqual(keySets.length, entries.size, 'Reverse keys must match live entries');
  assert.strictEqual(references, entries.size, 'Reverse references must match live entries');
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(10);
  }
}

function waitForInvalidation(cache, key) {
  return waitFor(() => ![...cache.keySetEntries()].some(([redisKey]) => redisKey === key),
    `Timed out waiting for invalidation of ${key}`);
}

test('cached Redis Cluster protocol and bounded storage', {
  skip: urls.length === 0 ? 'Set REDIS_CLUSTER_URLS to comma-separated Redis Cluster URLs' : false,
  timeout: 15000
}, async t => {
  const clusterOptions = {
    rootNodes: urls.map(url => ({ url })),
    defaults: { socket: { connectTimeout: 1000, reconnectStrategy: () => 50 } }
  };
  const maxEntries = 4;
  const { client, cache } = createCachedCluster({ clusterOptions, cacheOptions: { maxEntries } });
  const writer = redis.createCluster(clusterOptions);
  const prefix = `csc-cluster-test:${randomUUID()}`;
  const keys = ['a', 'b', 'c'].map(tag => `${prefix}:{${tag}}`);
  const errors = [];
  const expectedDisconnectErrors = [];
  let expectDisconnect = false;
  const onReaderError = error => {
    if (expectDisconnect && error instanceof redis.SocketClosedUnexpectedlyError) {
      expectedDisconnectErrors.push(error);
    } else {
      errors.push(error);
    }
  };
  client.on('error', onReaderError);
  client.on('node-error', onReaderError);
  writer.on('error', error => errors.push(error));
  writer.on('node-error', error => errors.push(error));

  try {
    await client.connect();
    await writer.connect();

    await t.test('caches empty and nonempty SMEMBERS across slots', async () => {
      const slots = await Promise.all(keys.map(key => writer.sendCommand(key, true, ['CLUSTER', 'KEYSLOT', key])));
      assert.strictEqual(new Set(slots).size, keys.length);
      assert.ok(new Set(slots.map(slot => writer.slots[slot].master)).size > 1, 'Reads must reach multiple masters');

      await writer.sAdd(keys[0], ['1', '-2']);
      await writer.sAdd(keys[1], ['3']);
      const expected = [['-2', '1'], ['3'], []];
      const before = cache.stats();
      for (let i = 0; i < keys.length; i++) {
        assert.deepStrictEqual((await client.sMembers(keys[i])).sort(), expected[i]);
      }
      assert.strictEqual(cache.stats().missCount - before.missCount, keys.length);
      for (let i = 0; i < keys.length; i++) {
        assert.deepStrictEqual((await client.sMembers(keys[i])).sort(), expected[i]);
      }
      assert.strictEqual(cache.stats().hitCount - before.hitCount, keys.length);
      assertBounded(cache, maxEntries);
    });

    await t.test('independent writer updates invalidate SMEMBERS and duplicate-key MGET replies', async () => {
      await writer.sAdd(keys[2], '4');
      await waitForInvalidation(cache, keys[2]);
      assert.deepStrictEqual(await client.sMembers(keys[2]), ['4']);

      await writer.sRem(keys[0], '1');
      await waitForInvalidation(cache, keys[0]);
      assert.deepStrictEqual(await client.sMembers(keys[0]), ['-2']);

      await writer.sRem(keys[2], '4');
      await waitForInvalidation(cache, keys[2]);
      assert.deepStrictEqual(await client.sMembers(keys[2]), []);
      const hits = cache.stats().hitCount;
      assert.deepStrictEqual(await client.sMembers(keys[2]), []);
      assert.strictEqual(cache.stats().hitCount, hits + 1);
      assertBounded(cache, maxEntries);

      const repeatedKey = `${prefix}:duplicate-key`;
      keys.push(repeatedKey);
      await writer.set(repeatedKey, 'before');
      assert.deepStrictEqual(await client.mGet([repeatedKey, repeatedKey]), ['before', 'before']);
      const repeatedHits = cache.stats().hitCount;
      assert.deepStrictEqual(await client.mGet([repeatedKey, repeatedKey]), ['before', 'before']);
      assert.strictEqual(cache.stats().hitCount, repeatedHits + 1);
      assertBounded(cache, maxEntries);

      await writer.set(repeatedKey, 'after');
      await waitForInvalidation(cache, repeatedKey);
      assert.deepStrictEqual(await client.mGet([repeatedKey, repeatedKey]), ['after', 'after']);
      assertBounded(cache, maxEntries);
    });

    await t.test('more than ten times capacity keeps entries and reverse references bounded', async () => {
      cache.clear();
      assert.deepStrictEqual(await client.sMembers(keys[0]), ['-2']);
      for (let i = 0; i < maxEntries * 12; i++) {
        const key = `${prefix}:rotation:${i}`;
        keys.push(key);
        if (i % 2 === 0) await writer.sAdd(key, String(i));
        assert.deepStrictEqual(await client.sMembers(key), i % 2 === 0 ? [String(i)] : []);
        const hits = cache.stats().hitCount;
        assert.deepStrictEqual(await client.sMembers(keys[0]), ['-2']);
        assert.strictEqual(cache.stats().hitCount, hits + 1, 'LRU must retain a repeatedly accessed hot key');
        assertBounded(cache, maxEntries);
      }
      assert.strictEqual(cache.size(), maxEntries);
      assert.ok(cache.stats().evictionCount > 0);
    });

    await t.test('late replies after invalidation, clear or error cannot refill the cache', async () => {
      const node = await client.nodeClient(client.masters[0]);
      for (const action of ['invalidate', 'clear', 'onError']) {
        cache.clear();
        const key = `${prefix}:pending:${action}`;
        let resolveReply;
        const reply = new Promise(resolve => { resolveReply = resolve; });
        const pending = cache.handleCache(node, { redisArgs: ['SMEMBERS', key], keys: [key] }, () => reply);
        assert.strictEqual(cache.size(), 1);
        if (action === 'invalidate') cache.invalidate(Buffer.from(key));
        else if (action === 'onError') cache.onError(new Error('test connection error'));
        else cache.clear();
        resolveReply(['old-value']);
        assert.deepStrictEqual(await pending, ['old-value']);
        assert.strictEqual(cache.size(), 0, 'An invalidated in-flight reply must not be cached');
        assertBounded(cache, maxEntries);
      }
    });

    await t.test('stale client slot receives MOVED and rediscovery clears cache', async () => {
      const key = `${prefix}:moved:{b}`;
      keys.push(key);
      await writer.sAdd(key, 'moved-value');
      assert.deepStrictEqual(await client.sMembers(keys[0]), ['-2']);
      const slot = await writer.sendCommand(key, true, ['CLUSTER', 'KEYSLOT', key]);
      const correctMaster = client.slots[slot].master;
      const wrongMaster = client.masters.find(master => master.address !== correctMaster.address);
      assert.ok(wrongMaster);

      // Only this client's routing is stale; the server returns the actual MOVED reply.
      client.slots[slot] = { master: wrongMaster, replicas: [] };
      assert.deepStrictEqual(await client.sMembers(key), ['moved-value']);
      assert.strictEqual(client.slots[slot].master.address, correctMaster.address);
      const cachedKeys = new Map(cache.keySetEntries());
      assert.ok(!cachedKeys.has(keys[0]), 'Rediscovery must discard previously cached data');
      assert.ok(cachedKeys.has(key), 'The retried command must populate the current cache');
      assertBounded(cache, maxEntries);
      cache.clear();
    });

    await t.test('close and reconnect clear cached data', async () => {
      assert.deepStrictEqual(await client.sMembers(keys[0]), ['-2']);
      assert.strictEqual(cache.size(), 1);
      await client.close();
      assert.strictEqual(cache.size(), 0);
      assertBounded(cache, maxEntries);
      await writer.sAdd(keys[0], 'new-value');
      await client.connect();
      assert.strictEqual(cache.size(), 0);
      assert.deepStrictEqual((await client.sMembers(keys[0])).sort(), ['-2', 'new-value']);
      assertBounded(cache, maxEntries);
    });

    await t.test('killed tracking connection clears cache and reconnects automatically', async () => {
      const expected = ['-2', 'new-value'];
      const hits = cache.stats().hitCount;
      assert.deepStrictEqual((await client.sMembers(keys[0])).sort(), expected);
      assert.strictEqual(cache.stats().hitCount, hits + 1, 'The killed connection must own a hot cached value');
      const slot = await writer.sendCommand(keys[0], true, ['CLUSTER', 'KEYSLOT', keys[0]]);
      const readerNode = await client.nodeClient(client.slots[slot].master);
      const writerNode = await writer.nodeClient(writer.slots[slot].master);
      const connectionId = await readerNode.clientId();
      let reconnected = false;
      readerNode.once('ready', () => { reconnected = true; });

      expectDisconnect = true;
      try {
        assert.strictEqual(await writerNode.sendCommand(['CLIENT', 'KILL', 'ID', String(connectionId)]), 1);
        await waitFor(() => expectedDisconnectErrors.length > 0, 'The killed reader must report a socket error');
        assert.strictEqual(cache.size(), 0, 'The actual socket error must clear tracked cached values');
        assertBounded(cache, maxEntries);
        await writer.sAdd(keys[0], 'after-disconnect');
        await waitFor(() => reconnected, 'The reader must reconnect automatically');
        assert.notStrictEqual(await readerNode.clientId(), connectionId);
        assert.deepStrictEqual((await client.sMembers(keys[0])).sort(), ['-2', 'after-disconnect', 'new-value']);
        assertBounded(cache, maxEntries);
      } finally {
        expectDisconnect = false;
      }
    });

    assert.deepStrictEqual(errors, [], 'Cluster clients must not emit background errors');
  } finally {
    if (writer.isOpen) await Promise.allSettled(keys.map(key => writer.del(key)));
    if (client.isOpen) client.destroy();
    if (writer.isOpen) writer.destroy();
  }
});
