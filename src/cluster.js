const { createCluster, BasicPooledClientSideCache } = require('redis');

// Reuse command handling; own both maps so eviction also releases reverse keys.
class BoundedClusterCache extends BasicPooledClientSideCache {
  #entries = new Map();
  #keyToCacheKeys = new Map();
  #disabled = false;

  get(cacheKey) {
    if (this.#disabled) return undefined;
    const stored = this.#entries.get(cacheKey);
    if (!stored) return undefined;
    if (!stored.entry.validate()) {
      this.delete(cacheKey);
      this.recordEvictions(1);
      return undefined;
    }
    this.#entries.delete(cacheKey);
    this.#entries.set(cacheKey, stored);
    return stored.entry;
  }

  has(cacheKey) {
    return !this.#disabled && this.#entries.has(cacheKey);
  }

  set(cacheKey, entry, keys) {
    if (this.#disabled) {
      entry.invalidate();
      return;
    }
    this.delete(cacheKey);
    if (this.#entries.size >= this.maxEntries) {
      this.deleteOldest();
      this.recordEvictions(1);
    }
    const redisKeys = [...new Set(keys.map(key => key.toString()))];
    this.#entries.set(cacheKey, { entry, keys: redisKeys });
    for (const key of redisKeys) {
      if (!this.#keyToCacheKeys.has(key)) {
        this.#keyToCacheKeys.set(key, new Set());
      }
      this.#keyToCacheKeys.get(key).add(cacheKey);
    }
  }

  delete(cacheKey) {
    const stored = this.#entries.get(cacheKey);
    if (!stored) return;
    stored.entry.invalidate();
    this.#entries.delete(cacheKey);
    for (const key of stored.keys) {
      const cacheKeys = this.#keyToCacheKeys.get(key);
      cacheKeys.delete(cacheKey);
      if (cacheKeys.size === 0) this.#keyToCacheKeys.delete(key);
    }
  }

  deleteOldest() {
    const oldest = this.#entries.keys().next();
    if (!oldest.done) this.delete(oldest.value);
  }

  invalidate(key) {
    if (key === null) {
      this.clear(false);
    } else {
      const cacheKeys = this.#keyToCacheKeys.get(key.toString());
      if (cacheKeys) {
        for (const cacheKey of cacheKeys) this.delete(cacheKey);
      }
    }
    this.emit('invalidate', key);
  }

  clear(resetStats = true) {
    const size = this.#entries.size;
    // In-flight reads retain their entry after removal and must not refill it.
    for (const { entry } of this.#entries.values()) entry.invalidate();
    this.#entries.clear();
    this.#keyToCacheKeys.clear();
    super.clear(resetStats);
    if (!resetStats) this.recordEvictions(size);
  }

  disable() {
    this.#disabled = true;
  }

  enable() {
    this.#disabled = false;
  }

  size() {
    return this.#entries.size;
  }

  *entryEntries() {
    for (const [cacheKey, { entry }] of this.#entries) yield [cacheKey, entry];
  }

  keySetEntries() {
    return this.#keyToCacheKeys.entries();
  }
}

function createCachedCluster({ clusterOptions, cacheOptions } = {}) {
  if (!Number.isSafeInteger(cacheOptions?.maxEntries) || cacheOptions.maxEntries <= 0) {
    throw new TypeError('cacheOptions.maxEntries must be a positive safe integer');
  }
  const cache = new BoundedClusterCache({ ...cacheOptions, ttl: 0, evictPolicy: 'LRU' });
  const client = createCluster({ ...clusterOptions, RESP: 3, clientSideCache: cache });
  return { client, cache };
}

module.exports = { createCachedCluster };
