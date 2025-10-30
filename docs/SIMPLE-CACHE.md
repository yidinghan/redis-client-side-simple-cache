# SimpleClientSideCache

极简的 Redis 客户端缓存实现，直接继承 `ClientSideCacheProvider`。

## 特性

✅ **只有你需要的功能**：
- 本地 Map 缓存
- GET 未命中时从服务端拉取并缓存
- 远端 invalid 时删除本地缓存

❌ **没有不需要的复杂功能**：
- 无 TTL 过期
- 无 maxEntries 限制
- 无 LRU/FIFO 淘汰策略
- 无统计信息
- 无 Promise 缓存
- 无任何嵌套逻辑

## 实现方式

直接继承 `@redis/client/dist/lib/client/cache` 中的 `ClientSideCacheProvider`，实现最小接口：

```javascript
class SimpleClientSideCache extends ClientSideCacheProvider {
  // 核心方法
  async handleCache(client, parser, fn, transformReply, typeMapping)
  trackingOn()
  invalidate(key)
  clear()
  
  // 必需方法
  stats()
  onError()
  onClose()
}
```

## 使用示例

```javascript
const redis = require('redis');
const { SimpleClientSideCache } = require('./src/simple-cache');

const cache = new SimpleClientSideCache();

const worker = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,
  clientSideCache: cache  // 传入自定义缓存
});

await worker.connect();

// 正常使用，缓存自动工作
const value = await worker.get('key');  // 第一次从 Redis 获取并缓存
const value2 = await worker.get('key'); // 第二次从本地缓存获取

// 监听失效事件
cache.on('invalidate', (key) => {
  console.log('Key invalidated:', key);
});
```

## 核心代码

总共约 80 行代码，核心逻辑：

1. **缓存命中**：直接从 `Map` 返回
2. **缓存未命中**：执行 Redis 命令，存入 `Map`，记录 key 映射
3. **失效处理**：根据 key 找到对应的 cacheKey，从 `Map` 中删除

## 设计哲学

SimpleClientSideCache 专注于**极简和可控**：
- 只提供最核心的缓存功能
- 代码量控制在 80 行左右，便于理解和维护
- 没有复杂的淘汰策略、TTL 管理等功能
- 适合对缓存有完全掌控需求的场景
