#!/usr/bin/env node

/**
 * 自定义轻量化的 Redis Client-Side Cache 实现
 * 不使用 node-redis 的 BasicClientSideCache
 */

const redis = require('redis');

/**
 * 轻量化的客户端缓存类
 */
class LightweightClientCache {
  constructor(options = {}) {
    this.ttl = options.ttl || 0; // 0 表示永不过期
    this.maxSize = options.maxSize || 1000;
    
    // 缓存存储: key -> { value, expireAt }
    this.cache = new Map();
    
    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: 0
    };
  }

  /**
   * 获取缓存
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * 设置缓存
   */
  set(key, value) {
    // 如果超过最大容量，删除最早的条目
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    const expireAt = this.ttl > 0 ? Date.now() + this.ttl : null;
    
    this.cache.set(key, {
      value,
      expireAt
    });
  }

  /**
   * 删除缓存（失效）
   */
  invalidate(key) {
    if (key === null) {
      // 全部失效
      this.cache.clear();
      this.stats.invalidations++;
    } else {
      if (this.cache.delete(key)) {
        this.stats.invalidations++;
      }
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size() {
    return this.cache.size;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      invalidations: this.stats.invalidations,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) : 0,
      size: this.cache.size
    };
  }
}

/**
 * 支持客户端缓存的 Redis 客户端封装
 */
class CachedRedisClient {
  constructor(options = {}) {
    this.cache = new LightweightClientCache({
      ttl: options.cacheTTL || 60000,
      maxSize: options.cacheMaxSize || 1000
    });
    
    this.redisOptions = {
      socket: options.socket || { host: 'localhost', port: 6379 },
      RESP: 3  // 必须使用 RESP3
    };
    
    this.client = null;
    this.pubSubClient = null; // 用于接收失效消息的专用连接
    this.connected = false;
    this.trackingClientId = null;
  }

  /**
   * 连接到 Redis
   */
  async connect() {
    // 主客户端
    this.client = redis.createClient(this.redisOptions);
    await this.client.connect();
    
    // 获取主客户端的 ID
    this.trackingClientId = await this.client.clientId();
    console.log(`✅ 主客户端已连接 (ID: ${this.trackingClientId})`);
    
    // 创建专用的 PubSub 客户端接收失效消息
    this.pubSubClient = redis.createClient(this.redisOptions);
    await this.pubSubClient.connect();
    console.log('✅ PubSub 客户端已连接');
    
    // 在主客户端上启用 REDIRECT 模式的客户端跟踪
    // REDIRECT 模式会将失效消息发送到指定的客户端
    const pubSubClientId = await this.pubSubClient.clientId();
    await this.client.sendCommand([
      'CLIENT', 
      'TRACKING', 
      'ON', 
      'REDIRECT', 
      pubSubClientId.toString()
    ]);
    console.log(`✅ 已启用客户端跟踪 (REDIRECT to ${pubSubClientId})`);
    
    // 在 PubSub 客户端上订阅 __redis__:invalidate 频道
    // 这是 Redis 用于发送失效消息的内部频道
    await this.pubSubClient.subscribe('__redis__:invalidate', (message, channel) => {
      console.log(`🔔 收到失效消息:`, message);
      
      try {
        // message 是失效的 key（可能是数组）
        if (Array.isArray(message)) {
          message.forEach(key => {
            const keyStr = key instanceof Buffer ? key.toString() : String(key);
            console.log(`   失效 key: ${keyStr}`);
            this.cache.invalidate(keyStr);
          });
        } else if (message) {
          const keyStr = message instanceof Buffer ? message.toString() : String(message);
          console.log(`   失效 key: ${keyStr}`);
          this.cache.invalidate(keyStr);
        }
      } catch (error) {
        console.error('处理失效消息出错:', error);
      }
    });
    
    this.connected = true;
  }

  /**
   * 带缓存的 GET 操作
   */
  async get(key) {
    // 先查本地缓存
    const cached = this.cache.get(key);
    if (cached !== null) {
      console.log(`🎯 缓存命中: ${key} = ${cached}`);
      return cached;
    }

    // 缓存未命中，从 Redis 获取
    console.log(`⚠️  缓存未命中: ${key}, 从 Redis 获取`);
    
    // 使用 sendCommand 确保被跟踪
    const value = await this.client.sendCommand(['GET', key]);
    
    if (value !== null) {
      // 存入缓存
      this.cache.set(key, value);
      console.log(`💾 已缓存: ${key} = ${value}`);
    }
    
    return value;
  }

  /**
   * 直接操作 Redis（不使用缓存）
   */
  async set(key, value) {
    return await this.client.set(key, value);
  }

  async incr(key) {
    return await this.client.incr(key);
  }

  async del(...keys) {
    return await this.client.del(...keys);
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * 打印统计信息
   */
  printStats() {
    const stats = this.cache.getStats();
    console.log('\n📊 缓存统计:');
    console.log(`  命中: ${stats.hits}`);
    console.log(`  未命中: ${stats.misses}`);
    console.log(`  失效次数: ${stats.invalidations}`);
    console.log(`  命中率: ${stats.hitRate}%`);
    console.log(`  缓存大小: ${stats.size} keys\n`);
  }

  /**
   * 断开连接
   */
  async disconnect() {
    if (this.pubSubClient) {
      await this.pubSubClient.unsubscribe();
      await this.pubSubClient.quit();
    }
    if (this.client) {
      await this.client.quit();
    }
  }

  /**
   * 获取原始 Redis 客户端（用于其他操作）
   */
  getRawClient() {
    return this.client;
  }
}

/**
 * 完整演示
 */
async function demo() {
  console.log('=== 自定义轻量化 Client-Side Cache 演示 ===\n');

  // 创建带缓存的客户端
  const worker = new CachedRedisClient({
    socket: { host: 'localhost', port: 6379 },
    cacheTTL: 60000,      // 60秒过期
    cacheMaxSize: 100     // 最多100个key
  });

  // 创建普通客户端（用于写入）
  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  try {
    await worker.connect();
    await master.connect();
    console.log('✅ Master 已连接\n');

    // === 步骤 1: 初始化数据 ===
    console.log('--- 步骤 1: Master 初始化数据 ---\n');
    await master.set('user:1', 'Alice');
    await master.set('user:2', 'Bob');
    await master.set('counter', '100');
    console.log('✍️  Master 写入了 3 个 key\n');

    // === 步骤 2: Worker 首次读取 ===
    console.log('--- 步骤 2: Worker 首次读取（建立缓存） ---\n');
    await worker.get('user:1');
    await worker.get('user:2');
    await worker.get('counter');
    worker.printStats();

    // === 步骤 3: Worker 再次读取（命中缓存） ===
    console.log('--- 步骤 3: Worker 再次读取（应该命中缓存） ---\n');
    await worker.get('user:1');
    await worker.get('user:2');
    await worker.get('counter');
    worker.printStats();

    // === 步骤 4: Master 修改数据 ===
    console.log('--- 步骤 4: Master 修改数据（触发失效） ---\n');
    await master.set('user:1', 'Charlie');
    console.log('✍️  Master 修改了 user:1\n');
    
    await new Promise(r => setTimeout(r, 300));

    // === 步骤 5: Worker 读取修改后的数据 ===
    console.log('--- 步骤 5: Worker 读取（user:1 应该重新从 Redis 获取） ---\n');
    await worker.get('user:1');  // 应该失效，重新获取
    await worker.get('user:2');  // 应该命中缓存
    worker.printStats();

    // === 步骤 6: Master 增加计数器 ===
    console.log('--- 步骤 6: Master 增加计数器 ---\n');
    const newCounter = await master.incr('counter');
    console.log(`✍️  Master 将计数器增加到 ${newCounter}\n`);
    
    await new Promise(r => setTimeout(r, 300));

    // === 步骤 7: Worker 读取新的计数器 ===
    console.log('--- 步骤 7: Worker 读取新的计数器值 ---\n');
    await worker.get('counter');  // 应该失效，重新获取
    worker.printStats();

    console.log('=== 演示完成 ===\n');
    
    // 清理
    await master.del('user:1', 'user:2', 'counter');

  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    await worker.disconnect();
    await master.quit();
  }
}

// 运行演示
if (require.main === module) {
  demo();
}

// 导出供其他模块使用
module.exports = {
  LightweightClientCache,
  CachedRedisClient
};
