const redis = require('redis');

// Worker 进程 - 只读，使用客户端缓存
class CacheWorker {
  constructor(workerId) {
    this.workerId = workerId;
    this.client = null;
    this.cache = null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  async connect() {
    // 创建缓存实例
    this.cache = new redis.BasicClientSideCache({
      ttl: 60000,  // 60秒 TTL
      maxEntries: 1000,  // 最多1000个条目
      evictPolicy: 'LRU',  // LRU淘汰策略
      recordStats: true  // 记录统计
    });

    // 监听缓存失效事件
    this.cache.on('invalidate', (keys) => {
      const keyStr = keys instanceof Buffer ? keys.toString() : String(keys);
      console.log(`[Worker ${this.workerId}] 🔄 Cache invalidated for key: ${keyStr}`);
    });

    // 创建支持客户端缓存的连接 (使用 RESP3 协议)
    this.client = redis.createClient({
      socket: {
        host: 'localhost',
        port: 6379
      },
      RESP: 3,  // 启用 RESP3 协议
      clientSideCache: this.cache  // 启用客户端缓存
    });

    await this.client.connect();
    
    console.log(`[Worker ${this.workerId}] ✅ Connected to Redis with client-side caching enabled`);
  }

  async get(key) {
    const value = await this.client.get(key);
    
    // 从缓存统计中获取命中/未命中信息
    const stats = this.cache.stats();
    const prevTotal = this.cacheHits + this.cacheMisses;
    const currentTotal = stats.hitCount + stats.missCount;
    
    if (currentTotal > prevTotal) {
      const wasHit = stats.hitCount > this.cacheHits;
      this.cacheHits = stats.hitCount;
      this.cacheMisses = stats.missCount;
      
      if (wasHit) {
        console.log(`[Worker ${this.workerId}] 🎯 Local cache HIT for "${key}": ${value}`);
      } else {
        console.log(`[Worker ${this.workerId}] ⚠️  Local cache MISS for "${key}", fetched from Redis: ${value}`);
      }
    }
    
    return value;
  }

  printStats() {
    const stats = this.cache.stats();
    const total = stats.requestCount();
    const hitRate = stats.hitRate() * 100;
    
    console.log(`\n[Worker ${this.workerId}] 📊 Statistics:`);
    console.log(`  Cache Hits: ${stats.hitCount}`);
    console.log(`  Cache Misses: ${stats.missCount}`);
    console.log(`  Hit Rate: ${hitRate.toFixed(2)}%`);
    console.log(`  Load Success: ${stats.loadSuccessCount}`);
    console.log(`  Evictions: ${stats.evictionCount}`);
    console.log(`  Cache Size: ${this.cache.size()} keys\n`);
  }

  async disconnect() {
    await this.client.quit();
  }
}

// 演示函数
async function demo() {
  const worker = new CacheWorker(1);
  
  try {
    await worker.connect();
    
    console.log('\n=== Demo: Worker Reading with Client-Side Cache ===\n');
    
    // 模拟定期读取
    const readInterval = setInterval(async () => {
      try {
        // 读取多个 key
        await worker.get('user:1000:name');
        await worker.get('user:1000:email');
        await worker.get('counter');
        
        worker.printStats();
      } catch (error) {
        console.error('Error during read:', error.message);
      }
    }, 3000);

    // 优雅关闭
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down worker...');
      clearInterval(readInterval);
      worker.printStats();
      await worker.disconnect();
      process.exit(0);
    });

    console.log('✨ Worker is running. Press Ctrl+C to stop.\n');
    console.log('💡 Tip: Run master.js in another terminal to see cache invalidation in action!\n');

  } catch (error) {
    console.error('Error:', error);
    await worker.disconnect();
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  demo();
}

module.exports = CacheWorker;
