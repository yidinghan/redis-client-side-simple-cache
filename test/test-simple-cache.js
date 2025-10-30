const { test, describe } = require('node:test');
const assert = require('node:assert');
const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

describe('Simple Client-Side Cache', () => {
  test('basic cache operations and invalidation', async () => {
    const cache = new SimpleClientSideCache();

    const worker = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    const master = redis.createClient({
      socket: { host: 'localhost', port: 6379 }
    });

    try {
      await worker.connect();
      await master.connect();

      let invalidatedKey = null;
      cache.on('invalidate', (key) => {
        invalidatedKey = key;
      });

      // Step 1: Master writes data
      await master.set('test:1', 'value1');
      await master.set('test:2', 'value2');
      assert.strictEqual(cache.size(), 0, 'Cache should be empty before reads');

      // Step 2: Worker reads (cache miss, load from Redis)
      const v1 = await worker.get('test:1');
      const v2 = await worker.get('test:2');
      assert.strictEqual(v1, 'value1', 'Should get value1');
      assert.strictEqual(v2, 'value2', 'Should get value2');
      assert.strictEqual(cache.size(), 2, 'Cache should have 2 entries');

      // Step 3: Worker reads again (cache hit)
      const v1b = await worker.get('test:1');
      const v2b = await worker.get('test:2');
      assert.strictEqual(v1b, 'value1', 'Should hit cache for value1');
      assert.strictEqual(v2b, 'value2', 'Should hit cache for value2');
      assert.strictEqual(cache.size(), 2, 'Cache size unchanged');

      // Step 4: Master modifies data
      await master.set('test:1', 'newvalue');
      await new Promise(r => setTimeout(r, 100));
      assert.ok(invalidatedKey !== null, 'Should receive invalidation');
      assert.strictEqual(cache.size(), 1, 'Cache should have 1 entry after invalidation');

      // Step 5: Worker reads modified data
      const v1c = await worker.get('test:1');
      const v2c = await worker.get('test:2');
      assert.strictEqual(v1c, 'newvalue', 'Should get new value');
      assert.strictEqual(v2c, 'value2', 'Should still have cached value2');

      // Cleanup
      await master.del('test:1', 'test:2');

    } finally {
      await worker.quit();
      await master.quit();
    }
  });
});
