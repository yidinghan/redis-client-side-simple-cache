#!/usr/bin/env node

const { ClientSideCacheProvider } = require('@redis/client/dist/lib/client/cache');

/**
 * Generate a unique cache key from Redis command arguments
 * @param {Array<Buffer|string>} redisArgs - Redis command arguments
 * @returns {string} Cache key in format "len1_len2_arg1_arg2"
 * @example
 * generateCacheKey(['user:1']) // "6_user:1"
 * generateCacheKey(['user:1', 'user:2']) // "6_6_user:1_user:2"
 */
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
 * 
 * @extends ClientSideCacheProvider
 * @fires SimpleClientSideCache#invalidate
 * @example
 * const cache = new SimpleClientSideCache({ enableStat: true });
 * const client = redis.createClient({
 *   RESP: 3,
 *   clientSideCache: cache
 * });
 */
class SimpleClientSideCache extends ClientSideCacheProvider {
  /**
   * Create a simple client-side cache instance
   * @param {Object} [options={}] - Cache options
   * @param {boolean} [options.enableStat=false] - Enable statistics tracking
   */
  constructor(options = {}) {
    super();
    this.cache = new Map();
    this.keyToCacheKeys = new Map();
    this._initializeStatistics(options.enableStat);
  }

  /**
   * Initialize statistics tracking
   * @private
   * @param {boolean} enableStat - Whether to enable statistics
   */
  _initializeStatistics(enableStat) {
    if (enableStat) {
      this._stats = {
        hitCount: 0,
        missCount: 0,
        loadSuccessCount: 0,
        loadFailureCount: 0,
        totalLoadTime: 0,
        evictionCount: 0
      };
      this._incHit = () => this._stats.hitCount++;
      this._incMiss = () => this._stats.missCount++;
      this._incLoadSuccess = () => this._stats.loadSuccessCount++;
      this._incLoadFailure = () => this._stats.loadFailureCount++;
      this._addLoadTime = (time) => this._stats.totalLoadTime += time;
      this._incEviction = (count = 1) => this._stats.evictionCount += count;
    } else {
      this._incHit = () => {};
      this._incMiss = () => {};
      this._incLoadSuccess = () => {};
      this._incLoadFailure = () => {};
      this._addLoadTime = () => {};
      this._incEviction = () => {};
    }
  }

  /**
   * Handle cache lookup and storage for Redis commands
   * @param {Object} client - Redis client instance
   * @param {Object} parser - Command parser with redisArgs and keys
   * @param {Function} fn - Function to execute Redis command
   * @param {Function} [transformReply] - Optional reply transformation function
   * @param {Object} [typeMapping] - Type mapping for reply transformation
   * @returns {Promise<*>} Cached or fresh command result
   */
  async handleCache(client, parser, fn, transformReply, typeMapping) {
    const cacheKey = generateCacheKey(parser.redisArgs);
    
    if (this.cache.has(cacheKey)) {
      this._incHit();
      return structuredClone(this.cache.get(cacheKey));
    }

    this._incMiss();
    
    const startTime = process.hrtime.bigint();
    let reply;
    try {
      reply = await fn();
      this._incLoadSuccess();
    } catch (err) {
      this._incLoadFailure();
      throw err;
    } finally {
      const endTime = process.hrtime.bigint();
      const elapsed = Number(endTime - startTime) / 1e6; // Convert to ms
      this._addLoadTime(elapsed);
    }

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

  /**
   * Return the command to enable client tracking
   * @returns {string[]} Redis command array
   */
  trackingOn() {
    return ['CLIENT', 'TRACKING', 'ON'];
  }

  /**
   * Handle cache invalidation notifications from Redis
   * @param {Buffer|null} key - Redis key to invalidate, or null for global flush
   * @fires SimpleClientSideCache#invalidate
   */
  invalidate(key) {
    if (key === null) {
      // 全局失效 (FLUSHDB 等)
      const evictedCount = this.cache.size;
      this.cache.clear();
      this.keyToCacheKeys.clear();
      this._incEviction(evictedCount);
      this.emit('invalidate', key);
      return;
    }

    const keyStr = key.toString();
    const cacheKeys = this.keyToCacheKeys.get(keyStr);
    
    if (cacheKeys) {
      // 删除所有包含此 Redis key 的缓存条目
      // 例如: 'user:1' 失效会删除 GET('user:1') 和 MGET(['user:1','user:2']) 的缓存
      const evictedCount = cacheKeys.size;
      for (const cacheKey of cacheKeys) {
        this.cache.delete(cacheKey);
      }
      this.keyToCacheKeys.delete(keyStr);
      this._incEviction(evictedCount);
    }
    
    this.emit('invalidate', key);
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
    this.keyToCacheKeys.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics object
   * @property {number} hitCount - Number of cache hits
   * @property {number} missCount - Number of cache misses
   * @property {number} loadSuccessCount - Number of successful loads from Redis
   * @property {number} loadFailureCount - Number of failed loads from Redis
   * @property {number} totalLoadTime - Total time spent loading from Redis (ms)
   * @property {number} evictionCount - Number of cache entries evicted
   */
  stats() {
    if (this._stats) {
      return { ...this._stats };
    }
    return {
      hitCount: 0,
      missCount: 0,
      loadSuccessCount: 0,
      loadFailureCount: 0,
      totalLoadTime: 0,
      evictionCount: 0
    };
  }

  /**
   * Handle Redis client errors by clearing cache
   */
  onError() {
    this.clear();
  }

  /**
   * Handle Redis client closure by clearing cache
   */
  onClose() {
    this.clear();
  }

  /**
   * Get the number of cached entries
   * @returns {number} Number of entries in cache
   */
  size() {
    return this.cache.size;
  }
}

/**
 * Invalidate event
 * @event SimpleClientSideCache#invalidate
 * @type {Buffer|null}
 * @description Emitted when cache entries are invalidated. 
 * The key is a Buffer for specific key invalidations, or null for global flush.
 */

module.exports = { SimpleClientSideCache };
