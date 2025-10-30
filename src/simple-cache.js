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
 * 
 * 核心数据结构:
 * - cache: Map<cacheKey, value> - 存储缓存值
 * - keyToCacheKeys: Map<redisKey, Set<cacheKey>> - 反向索引，用于失效通知
 * 
 * 为什么需要 keyToCacheKeys?
 * 问题: 缓存用 cacheKey (命令+参数)，失效通知用 Redis key (单个键名)
 * 例如:
 *   GET('user:1')              → cacheKey: "6_user:1"
 *   MGET(['user:1', 'user:2']) → cacheKey: "6_6_user:1_user:2"
 * 当 Redis 发送失效通知 'user:1' 时，需要删除两个缓存条目！
 * 
 * 解决方案: keyToCacheKeys 维护 Redis key → Set<cacheKey> 的映射
 *   'user:1' → Set(['6_user:1', '6_6_user:1_user:2'])
 *   'user:2' → Set(['6_6_user:1_user:2'])
 * 失效时 O(1) 查找 + O(k) 删除，精准高效
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
    
    // 建立反向索引: 每个 Redis key → 包含它的所有 cacheKey
    // 这样失效通知来时能快速找到所有相关缓存条目
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
      // 全局失效 (FLUSHDB 等)
      this.cache.clear();
      this.keyToCacheKeys.clear();
      this.emit('invalidate', key);
      return;
    }

    const keyStr = key.toString();
    const cacheKeys = this.keyToCacheKeys.get(keyStr);
    
    if (cacheKeys) {
      // 删除所有包含此 Redis key 的缓存条目
      // 例如: 'user:1' 失效会删除 GET('user:1') 和 MGET(['user:1','user:2']) 的缓存
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
