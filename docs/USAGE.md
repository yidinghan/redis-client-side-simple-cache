# SimpleClientSideCache 使用指南

完整的 Redis 客户端缓存使用指南，涵盖基础用法、高级场景、性能优化和常见问题。

## 目录

- [快速开始](#快速开始)
- [基础用法](#基础用法)
- [高级场景](#高级场景)
- [监控和调试](#监控和调试)
- [性能优化](#性能优化)
- [常见问题](#常见问题)
- [最佳实践](#最佳实践)

## 快速开始

### 安装

```bash
npm install @playding/redis-simple-csc redis
```

### 最小示例

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const redis = require('redis');

const cache = new SimpleClientSideCache();
const client = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,  // 必须启用 RESP3 协议
  clientSideCache: cache
});

await client.connect();

// 使用就像普通的 Redis 客户端一样
const value = await client.get('mykey');
console.log('缓存大小:', cache.size());
```

## 基础用法

### 1. 创建缓存客户端

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const redis = require('redis');

// 创建缓存实例
const cache = new SimpleClientSideCache();

// 配置 Redis 客户端
const client = redis.createClient({
  socket: { 
    host: 'localhost', 
    port: 6379 
  },
  RESP: 3,                    // ⚠️ 必须设置为 3
  clientSideCache: cache      // 传入缓存实例
});

await client.connect();
```

### 2. 读取数据（自动缓存）

```javascript
// 第一次读取 - 缓存未命中，从 Redis 获取
const value1 = await client.get('user:1001');
console.log('第一次读取:', value1);

// 第二次读取 - 缓存命中，立即返回
const value2 = await client.get('user:1001');
console.log('第二次读取:', value2);

console.log('缓存大小:', cache.size()); // 输出: 1
```

### 3. 写入数据（自动失效）

```javascript
// 写入会自动触发缓存失效
await client.set('user:1001', 'new-data');

// 下次读取会重新从 Redis 获取
const freshValue = await client.get('user:1001');
console.log('更新后的值:', freshValue);
```

### 4. 监听失效事件

```javascript
cache.on('invalidate', (key) => {
  if (key === null) {
    console.log('全局缓存已清空（FLUSHDB）');
  } else {
    console.log('缓存失效的键:', key.toString());
  }
});

// 触发失效
await client.set('user:1001', 'value');  // 日志: "缓存失效的键: user:1001"
await client.flushDb();                  // 日志: "全局缓存已清空（FLUSHDB）"
```

## 高级场景

### 1. 批量操作（MGET）

```javascript
// 批量读取会创建一个联合缓存键
const values = await client.mGet(['user:1', 'user:2', 'user:3']);
console.log('批量读取:', values);

// 单个键的更新会精准失效相关缓存
await client.set('user:1', 'new-value');  // 只失效包含 user:1 的缓存
```

**缓存键示例：**
- `GET user:1` → 缓存键: `"6_user:1"`
- `MGET user:1 user:2` → 缓存键: `"6_6_user:1_user:2"`

当 `user:1` 失效时，两个缓存键都会被删除。

### 2. 不同数据类型

```javascript
// String
await client.set('config:version', '1.2.3');
const version = await client.get('config:version');

// Hash
await client.hSet('user:1001', { name: 'Alice', age: '30' });
const userData = await client.hGetAll('user:1001');

// JSON (需要 RedisJSON 模块)
await client.json.set('product:1', '$', { id: 1, name: 'Laptop' });
const product = await client.json.get('product:1');

// 所有类型都会自动缓存和失效
```

### 3. 特殊字符和大数据

```javascript
// 中文字符
await client.set('message:cn', '你好世界');
const cn = await client.get('message:cn');

// Emoji
await client.set('status:emoji', '🎉✨');
const emoji = await client.get('status:emoji');

// 大数据（1MB+）
const largeData = 'x'.repeat(1024 * 1024);
await client.set('large:data', largeData);
const retrieved = await client.get('large:data');
console.log('大小:', retrieved.length); // 1048576
```

### 4. 边缘情况

```javascript
// null 值
await client.set('key:null', '');
const nullValue = await client.get('key:null');
console.log(nullValue); // ''

// 不存在的键
const notExist = await client.get('nonexistent');
console.log(notExist); // null

// 字符串 "0"
await client.set('key:zero', '0');
const zero = await client.get('key:zero');
console.log(zero); // '0'
```

### 5. 多客户端场景

```javascript
// Worker（带缓存的读取客户端）
const cache = new SimpleClientSideCache();
const worker = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,
  clientSideCache: cache
});

// Master（写入客户端，无需缓存）
const master = redis.createClient({
  socket: { host: 'localhost', port: 6379 }
});

await worker.connect();
await master.connect();

// Worker 读取并缓存
await worker.get('product:100');  // 缓存未命中
await worker.get('product:100');  // 缓存命中

// Master 写入会通知 Worker 失效
await master.set('product:100', 'new-value');

// 等待失效通知传播（通常 < 10ms）
await new Promise(r => setTimeout(r, 50));

// Worker 下次读取会获取新值
const newValue = await worker.get('product:100');
```

## 监控和调试

### 1. 查看缓存大小

```javascript
console.log('当前缓存条目数:', cache.size());

// 在生产环境中监控
setInterval(() => {
  console.log('缓存统计:', {
    size: cache.size(),
    timestamp: new Date().toISOString()
  });
}, 60000); // 每分钟
```

### 2. 统计信息

```javascript
const stats = cache.stats();
console.log(stats);
// 输出:
// {
//   hitCount: 0,         // SimpleClientSideCache 不跟踪命中率
//   missCount: 0,
//   loadSuccessCount: 0,
//   loadFailureCount: 0,
//   totalLoadTime: 0,
//   evictionCount: 0
// }
```

**注意**: SimpleClientSideCache 为了保持简洁，不提供命中率统计。如需统计功能，可以使用 `BasicClientSideCache`。

### 3. 失效事件追踪

```javascript
let invalidationCount = 0;

cache.on('invalidate', (key) => {
  invalidationCount++;
  console.log(`失效 #${invalidationCount}:`, key ? key.toString() : 'GLOBAL');
});

// 生产环境可以发送到监控系统
cache.on('invalidate', (key) => {
  metrics.increment('redis.cache.invalidation', {
    key: key ? key.toString() : 'all',
    timestamp: Date.now()
  });
});
```

### 4. 手动清空缓存

```javascript
// 清空所有缓存（不会通知其他客户端）
cache.clear();
console.log('缓存已清空，大小:', cache.size()); // 0

// 适用场景：
// - 应用重启前清理
// - 内存压力时释放空间
// - 测试环境重置状态
```

## 性能优化

### 1. 了解缓存命中模式

```javascript
// 好的模式：读多写少
for (let i = 0; i < 100; i++) {
  await client.get('config:app');  // 99 次缓存命中
}

// 差的模式：频繁写入
for (let i = 0; i < 100; i++) {
  await client.set(`key:${i}`, 'value');  // 100 次写入，缓存无效
}
```

### 2. 批量操作优化

```javascript
// ❌ 低效：多次单独调用
const user1 = await client.get('user:1');
const user2 = await client.get('user:2');
const user3 = await client.get('user:3');

// ✅ 高效：使用 MGET
const users = await client.mGet(['user:1', 'user:2', 'user:3']);
```

### 3. 控制缓存大小

```javascript
// 定期检查并清理
async function checkCacheSize() {
  const size = cache.size();
  
  if (size > 10000) {  // 设置阈值
    console.warn('缓存过大，清理中...');
    cache.clear();
  }
}

setInterval(checkCacheSize, 300000); // 每 5 分钟检查
```

### 4. 连接生命周期管理

```javascript
async function setupClient() {
  const cache = new SimpleClientSideCache();
  const client = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  // 错误时自动清空缓存
  client.on('error', (err) => {
    console.error('Redis 错误:', err);
    cache.clear();  // 避免使用过期缓存
  });

  // 关闭时清理
  client.on('end', () => {
    console.log('连接关闭，清理缓存');
    cache.clear();
  });

  await client.connect();
  return { client, cache };
}
```

## 常见问题

### Q1: 为什么必须使用 RESP3？

**A:** 客户端缓存依赖 RESP3 协议的 `CLIENT TRACKING` 功能。RESP2 不支持服务器推送的失效通知。

```javascript
// ❌ 错误：RESP 默认为 2
const client = redis.createClient({
  clientSideCache: cache  // 不会工作！
});

// ✅ 正确：明确设置 RESP 3
const client = redis.createClient({
  RESP: 3,
  clientSideCache: cache
});
```

### Q2: 缓存没有失效怎么办？

**检查清单：**

1. 确认 RESP 版本：
   ```javascript
   console.log('RESP 版本:', client.options.RESP); // 应该是 3
   ```

2. 确认失效事件：
   ```javascript
   cache.on('invalidate', (key) => {
     console.log('失效事件触发:', key);
   });
   ```

3. 等待传播延迟：
   ```javascript
   await master.set('key', 'value');
   await new Promise(r => setTimeout(r, 100)); // 给失效通知时间
   ```

### Q3: 如何处理多个 Redis 实例？

**A:** 为每个实例创建独立的缓存：

```javascript
const cache1 = new SimpleClientSideCache();
const client1 = redis.createClient({
  socket: { host: 'redis1.example.com', port: 6379 },
  RESP: 3,
  clientSideCache: cache1
});

const cache2 = new SimpleClientSideCache();
const client2 = redis.createClient({
  socket: { host: 'redis2.example.com', port: 6379 },
  RESP: 3,
  clientSideCache: cache2
});
```

### Q4: 缓存会占用多少内存？

**A:** 取决于你的数据。每个缓存条目包括：
- **键**: `lengths_keys` 格式字符串
- **值**: 完整的数据副本（structuredClone）
- **索引**: keyToCacheKeys 映射

示例计算：
```javascript
// 假设 1000 个键，每个值 1KB
// 缓存: ~1MB (数据)
// 索引: ~10-50KB (映射)
// 总计: ~1-1.5MB
```

监控内存：
```javascript
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('内存使用:', {
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    cacheSize: cache.size()
  });
}, 60000);
```

### Q5: 如何测试缓存是否工作？

**A:** 使用时间测量：

```javascript
// 第一次：应该较慢（网络 + Redis）
console.time('miss');
await client.get('test:key');
console.timeEnd('miss'); // ~1-5ms

// 第二次：应该非常快（本地内存）
console.time('hit');
await client.get('test:key');
console.timeEnd('hit'); // ~0.1-0.5ms
```

或检查缓存大小：
```javascript
const sizeBefore = cache.size();
await client.get('new:key');
const sizeAfter = cache.size();
console.log('缓存增长:', sizeAfter - sizeBefore); // 应该是 1
```

## 最佳实践

### 1. 适用场景选择

✅ **推荐使用：**
- 配置数据（很少变化）
- 用户信息（读多写少）
- 商品目录（高并发读取）
- API 响应缓存

❌ **不推荐：**
- 实时数据（股票价格）
- 写入频繁的计数器
- 需要强一致性的场景

### 2. 生产环境模板

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const redis = require('redis');

class RedisService {
  constructor(config) {
    this.cache = new SimpleClientSideCache();
    this.client = redis.createClient({
      socket: { 
        host: config.host, 
        port: config.port,
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      },
      RESP: 3,
      clientSideCache: this.cache
    });

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    // 监控失效
    this.cache.on('invalidate', (key) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('缓存失效:', key ? key.toString() : 'ALL');
      }
    });

    // 错误处理
    this.client.on('error', (err) => {
      console.error('Redis 错误:', err);
      this.cache.clear();
    });

    // 连接状态
    this.client.on('reconnecting', () => {
      console.log('重新连接中...');
      this.cache.clear();  // 重连时清空以避免过期数据
    });
  }

  async connect() {
    await this.client.connect();
    console.log('Redis 已连接（带客户端缓存）');
  }

  async disconnect() {
    this.cache.clear();
    await this.client.quit();
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, options) {
    return this.client.set(key, value, options);
  }

  getCacheStats() {
    return {
      size: this.cache.size(),
      stats: this.cache.stats()
    };
  }
}

// 使用
const redisService = new RedisService({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379
});

await redisService.connect();

// 应用逻辑
const userData = await redisService.get('user:1001');
```

### 3. 测试建议

```javascript
// 单元测试示例
describe('Redis 缓存服务', () => {
  let redisService;

  beforeEach(async () => {
    redisService = new RedisService({ host: 'localhost', port: 6379 });
    await redisService.connect();
  });

  afterEach(async () => {
    await redisService.disconnect();
  });

  it('应该缓存读取的数据', async () => {
    await redisService.set('test:key', 'value');
    
    const before = redisService.getCacheStats().size;
    await redisService.get('test:key');
    const after = redisService.getCacheStats().size;
    
    expect(after).toBe(before + 1);
  });

  it('应该在写入后失效缓存', async () => {
    await redisService.get('test:key');
    const sizeBefore = redisService.getCacheStats().size;
    
    await redisService.set('test:key', 'new-value');
    await new Promise(r => setTimeout(r, 50));
    
    const sizeAfter = redisService.getCacheStats().size;
    expect(sizeAfter).toBeLessThan(sizeBefore);
  });
});
```

### 4. 监控和告警

```javascript
// 集成监控系统（如 Prometheus）
function setupMetrics(cache) {
  const cacheSize = new promClient.Gauge({
    name: 'redis_cache_size',
    help: 'Redis 客户端缓存条目数量'
  });

  const invalidations = new promClient.Counter({
    name: 'redis_cache_invalidations_total',
    help: 'Redis 缓存失效总次数',
    labelNames: ['type']
  });

  // 定期更新指标
  setInterval(() => {
    cacheSize.set(cache.size());
  }, 10000);

  // 跟踪失效
  cache.on('invalidate', (key) => {
    invalidations.inc({ 
      type: key === null ? 'global' : 'specific' 
    });
  });
}
```

## 总结

SimpleClientSideCache 提供了一个极简但功能完整的 Redis 客户端缓存解决方案：

- ✅ **简单**: 80 行核心代码，易于理解和调试
- ✅ **自动**: 透明的缓存和失效，无需修改业务逻辑
- ✅ **可靠**: 完善的测试覆盖和边缘情况处理
- ✅ **高效**: 内存缓存，亚毫秒级访问延迟

适合读多写少的场景，能够显著降低 Redis 服务器负载和网络延迟。

更多信息请参考：
- [README.md](README.md) - 项目概览
- [SIMPLE-CACHE.md](docs/SIMPLE-CACHE.md) - 实现细节
- [测试代码](test/) - 使用示例
