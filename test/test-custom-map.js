const { test, describe } = require('node:test');
const assert = require('node:assert');
const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

// Custom Map class with tracking for testing
class TrackedMap extends Map {
  constructor() {
    super();
    this.setCount = 0;
    this.deleteCount = 0;
    this.clearCount = 0;
  }

  set(key, value) {
    this.setCount++;
    return super.set(key, value);
  }

  delete(key) {
    this.deleteCount++;
    return super.delete(key);
  }

  clear() {
    this.clearCount++;
    return super.clear();
  }
}

// Custom Map with size limit for testing
class LimitedMap extends Map {
  constructor(maxSize = 100) {
    super();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      this.delete(firstKey);
    }
    return super.set(key, value);
  }
}

describe('Custom Map Class Tests', () => {
  test('should accept custom CacheMapClass', async () => {
    const trackedCache = new TrackedMap();
    const cache = new SimpleClientSideCache({ 
      CacheMapClass: TrackedMap 
    });

    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      await client.set('custom:1', 'value1');
      await client.get('custom:1'); // miss, should set cache

      assert.ok(cache.cache instanceof TrackedMap, 'cache should be TrackedMap instance');
      assert.ok(cache.cache.setCount > 0, 'TrackedMap.set should be called');

      await client.del('custom:1');
    } finally {
      await client.quit();
    }
  });

  test('should accept custom KeyMapClass', async () => {
    const cache = new SimpleClientSideCache({ 
      KeyMapClass: TrackedMap 
    });

    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      await client.set('custom:2', 'value2');
      await client.get('custom:2'); // miss, should build reverse index

      assert.ok(cache.keyToCacheKeys instanceof TrackedMap, 'keyToCacheKeys should be TrackedMap instance');
      assert.ok(cache.keyToCacheKeys.setCount > 0, 'TrackedMap.set should be called for reverse index');

      await client.del('custom:2');
    } finally {
      await client.quit();
    }
  });

  test('should accept both custom Map classes', async () => {
    const cache = new SimpleClientSideCache({ 
      CacheMapClass: TrackedMap,
      KeyMapClass: LimitedMap 
    });

    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      await client.set('custom:3', 'value3');
      await client.get('custom:3');

      assert.ok(cache.cache instanceof TrackedMap, 'cache should be TrackedMap');
      assert.ok(cache.keyToCacheKeys instanceof LimitedMap, 'keyToCacheKeys should be LimitedMap');

      await client.del('custom:3');
    } finally {
      await client.quit();
    }
  });

  test('should use native Map by default', () => {
    const cache = new SimpleClientSideCache();
    
    assert.ok(cache.cache instanceof Map, 'cache should be Map instance');
    assert.ok(cache.keyToCacheKeys instanceof Map, 'keyToCacheKeys should be Map instance');
    assert.strictEqual(cache.cache.constructor, Map, 'cache should be native Map');
    assert.strictEqual(cache.keyToCacheKeys.constructor, Map, 'keyToCacheKeys should be native Map');
  });

  test('should throw TypeError for invalid CacheMapClass', () => {
    class NotAMap {}
    
    assert.throws(
      () => new SimpleClientSideCache({ CacheMapClass: NotAMap }),
      TypeError,
      'Should throw TypeError for non-Map class'
    );
  });

  test('should throw TypeError for invalid KeyMapClass', () => {
    class NotAMap {}
    
    assert.throws(
      () => new SimpleClientSideCache({ KeyMapClass: NotAMap }),
      TypeError,
      'Should throw TypeError for non-Map class'
    );
  });

  test('custom Map should work with cache invalidation', async () => {
    const cache = new SimpleClientSideCache({ 
      CacheMapClass: TrackedMap,
      KeyMapClass: TrackedMap
    });

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

      // Write and read
      await master.set('custom:inv', 'value1');
      await worker.get('custom:inv'); // cache it

      const initialSetCount = cache.cache.setCount;
      const initialDeleteCount = cache.cache.deleteCount;

      // Trigger invalidation
      await master.set('custom:inv', 'value2');
      await new Promise(r => setTimeout(r, 100));

      assert.ok(cache.cache.deleteCount > initialDeleteCount, 'delete should be called on invalidation');

      // Read again (should fetch from Redis)
      await worker.get('custom:inv');
      assert.ok(cache.cache.setCount > initialSetCount, 'set should be called after invalidation');

      await master.del('custom:inv');
    } finally {
      await worker.quit();
      await master.quit();
    }
  });

  test('custom Map with LimitedMap should enforce size limit', async () => {
    const cache = new SimpleClientSideCache({ 
      CacheMapClass: class extends LimitedMap {
        constructor() { super(3); } // Max 3 entries
      }
    });

    const client = redis.createClient({
      socket: { host: 'localhost', port: 6379 },
      RESP: 3,
      clientSideCache: cache
    });

    try {
      await client.connect();

      // Write 5 keys
      for (let i = 1; i <= 5; i++) {
        await client.set(`limit:${i}`, `value${i}`);
        await client.get(`limit:${i}`);
      }

      // Cache should only have 3 entries (limited)
      assert.ok(cache.cache.size <= 3, `Cache size should be limited to 3, got ${cache.cache.size}`);

      // Cleanup
      for (let i = 1; i <= 5; i++) {
        await client.del(`limit:${i}`);
      }
    } finally {
      await client.quit();
    }
  });
});
