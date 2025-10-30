const { test, describe } = require('node:test');
const assert = require('node:assert');
const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

describe('Coverage Gap Tests', () => {
  test('stats() method returns correct structure', async () => {
    const cache = new SimpleClientSideCache();
    
    const stats = cache.stats();
    
    assert.ok(stats !== null, 'stats should return an object');
    assert.strictEqual(typeof stats, 'object', 'stats should be an object');
    assert.strictEqual(stats.hitCount, 0, 'hitCount should be 0');
    assert.strictEqual(stats.missCount, 0, 'missCount should be 0');
    assert.strictEqual(stats.loadSuccessCount, 0, 'loadSuccessCount should be 0');
    assert.strictEqual(stats.loadFailureCount, 0, 'loadFailureCount should be 0');
    assert.strictEqual(stats.totalLoadTime, 0, 'totalLoadTime should be 0');
    assert.strictEqual(stats.evictionCount, 0, 'evictionCount should be 0');
  });

  test('onError() clears cache', async () => {
    const cache = new SimpleClientSideCache();
    
    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      // Populate cache
      await client.set('error:test', 'value');
      await client.get('error:test');
      assert.ok(cache.size() > 0, 'Cache should have entries');

      // Trigger onError
      cache.onError(new Error('test error'));

      // Verify cache is cleared
      assert.strictEqual(cache.size(), 0, 'Cache should be empty after onError');

      // Cleanup
      await client.del('error:test');
    } finally {
      await client.quit();
    }
  });

  test('onClose() clears cache', async () => {
    const cache = new SimpleClientSideCache();
    
    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      // Populate cache
      await client.set('close:test', 'value');
      await client.get('close:test');
      assert.ok(cache.size() > 0, 'Cache should have entries');

      // Trigger onClose
      cache.onClose();

      // Verify cache is cleared
      assert.strictEqual(cache.size(), 0, 'Cache should be empty after onClose');

      // Cleanup
      await client.del('close:test');
    } finally {
      await client.quit();
    }
  });

  test('invalidate() with non-existent key should not throw', async () => {
    const cache = new SimpleClientSideCache();

    let eventFired = false;
    cache.on('invalidate', (key) => {
      eventFired = true;
    });

    // Invalidate a key that doesn't exist in cache
    assert.doesNotThrow(() => {
      cache.invalidate(Buffer.from('non:existent:key'));
    }, 'Should not throw when invalidating non-existent key');

    assert.ok(eventFired, 'Should still emit invalidate event');
  });

  test('multiple clear() calls should be safe', async () => {
    const cache = new SimpleClientSideCache();
    
    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      // Populate cache
      await client.set('clear:test', 'value');
      await client.get('clear:test');
      assert.ok(cache.size() > 0, 'Cache should have entries');

      // First clear
      cache.clear();
      assert.strictEqual(cache.size(), 0, 'Cache should be empty after first clear');

      // Second clear (on empty cache)
      assert.doesNotThrow(() => {
        cache.clear();
      }, 'Second clear should not throw');
      assert.strictEqual(cache.size(), 0, 'Cache should still be empty');

      // Cleanup
      await client.del('clear:test');
    } finally {
      await client.quit();
    }
  });

  test('invalidate(null) clears all cache and mappings', async () => {
    const cache = new SimpleClientSideCache();
    
    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      // Populate cache with multiple keys
      await client.set('global:1', 'value1');
      await client.set('global:2', 'value2');
      await client.get('global:1');
      await client.get('global:2');
      
      assert.ok(cache.size() > 0, 'Cache should have entries');

      let invalidatedKey = null;
      cache.on('invalidate', (key) => {
        invalidatedKey = key;
      });

      // Global invalidation
      cache.invalidate(null);

      assert.strictEqual(cache.size(), 0, 'Cache should be empty after global invalidation');
      assert.strictEqual(invalidatedKey, null, 'Event should have null key');

      // Cleanup
      await client.del('global:1', 'global:2');
    } finally {
      await client.quit();
    }
  });
});
