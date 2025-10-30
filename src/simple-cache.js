#!/usr/bin/env node

const { ClientSideCacheProvider } = require('@redis/client/dist/lib/client/cache');

function generateCacheKey(redisArgs) {
  const tmp = new Array(redisArgs.length * 2);
  for (let i = 0; i < redisArgs.length; i++) {
    tmp[i] = redisArgs[i].length;
    tmp[i + redisArgs.length] = redisArgs[i];
  }
  return tmp.join('_');
}

/**
 * 极简客户端缓存 - 只有本地Map + GET/SET + INVALIDATE
 * 继承 ClientSideCacheProvider
 */
class SimpleClientSideCache extends ClientSideCacheProvider {
  constructor() {
    super();
    this.cache = new Map();
    this.keyToCacheKeys = new Map();
  }

  async handleCache(client, parser, fn, transformReply, typeMapping) {
    const cacheKey = generateCacheKey(parser.redisArgs);
    
    if (this.cache.has(cacheKey)) {
      return structuredClone(this.cache.get(cacheKey));
    }

    let reply = await fn();

    let value = transformReply 
      ? transformReply(reply, parser.preserve, typeMapping)
      : reply;

    this.cache.set(cacheKey, value);
    
    for (const key of parser.keys) {
      const keyStr = key.toString();
      if (!this.keyToCacheKeys.has(keyStr)) {
        this.keyToCacheKeys.set(keyStr, new Set());
      }
      this.keyToCacheKeys.get(keyStr).add(cacheKey);
    }

    return structuredClone(value);
  }

  trackingOn() {
    return ['CLIENT', 'TRACKING', 'ON'];
  }

  invalidate(key) {
    if (key === null) {
      this.cache.clear();
      this.keyToCacheKeys.clear();
      this.emit('invalidate', key);
      return;
    }

    const keyStr = key.toString();
    const cacheKeys = this.keyToCacheKeys.get(keyStr);
    
    if (cacheKeys) {
      for (const cacheKey of cacheKeys) {
        this.cache.delete(cacheKey);
      }
      this.keyToCacheKeys.delete(keyStr);
    }
    
    this.emit('invalidate', key);
  }

  clear() {
    this.cache.clear();
    this.keyToCacheKeys.clear();
  }

  stats() {
    return {
      hitCount: 0,
      missCount: 0,
      loadSuccessCount: 0,
      loadFailureCount: 0,
      totalLoadTime: 0,
      evictionCount: 0
    };
  }

  onError() {
    this.clear();
  }

  onClose() {
    this.clear();
  }

  size() {
    return this.cache.size;
  }
}

module.exports = { SimpleClientSideCache };
