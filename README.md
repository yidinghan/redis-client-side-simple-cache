# Redis Client-Side Caching Demo

这是一个演示 Redis 6+ **客户端缓存（Client-Side Caching）** 功能的项目，展示了读写分离架构。

## 架构设计

```
┌─────────────┐                    ┌──────────────┐
│   Master    │ ──── writes ────▶  │    Redis     │
│  (写入者)    │                    │  localhost   │
└─────────────┘                    │    :6379     │
                                   └──────────────┘
                                         │
                                         │ invalidation
                                         │ notifications
                                         ▼
                                   ┌──────────────┐
                                   │   Worker     │
                                   │  (只读+缓存)  │
                                   │              │
                                   │ Local Cache: │
                                   │  ┌─────────┐ │
                                   │  │ Memory  │ │
                                   │  └─────────┘ │
                                   └──────────────┘
```

### 核心特性

1. **Worker (只读进程)**
   - 使用 RESP3 协议连接 Redis
   - 启用客户端缓存，数据存储在本地内存
   - 监听 Redis 的缓存失效通知
   - 自动同步缓存更新

2. **Master (写入进程)**
   - 负责所有写操作
   - 写入数据时，Redis 自动通知 Worker 失效相关缓存
   - 支持交互式和自动模式

## 安装依赖

```bash
npm install
```

## 使用方法

### 快速演示

运行完整的演示脚本（单进程展示所有功能）：
```bash
npm run demo
```

### 方式 1: 推荐 - 双终端演示

**终端 1 - 启动 Worker (只读)**
```bash
npm run worker
```

Worker 会：
- 每 3 秒读取一次数据
- 首次读取从 Redis 获取并缓存到本地
- 后续读取直接从本地缓存获取（极快）
- 当 Master 写入时，自动更新本地缓存

**终端 2 - 启动 Master (写入)**

交互式模式：
```bash
npm run master
```

然后输入命令：
```
master> set user:1000:name Bob
master> set user:1000:email bob@example.com
master> incr counter
master> auto          # 开启自动更新模式
master> stop          # 停止自动更新
master> quit          # 退出
```

或自动演示模式：
```bash
node src/master.js auto
```

### 方式 2: 单独运行

```bash
# 只运行 worker
node src/worker.js

# 只运行 master (交互式)
node src/master.js

# 只运行 master (自动模式)
node src/master.js auto
```

## 观察要点

### 1. 缓存命中率

Worker 首次读取时：
```
[Worker 1] ⚠️  Local cache MISS for "user:1000:name", fetching from Redis...
[Worker 1] 💾 Cached "user:1000:name": Alice
```

后续读取时：
```
[Worker 1] 🎯 Local cache HIT for "user:1000:name": Alice
```

### 2. 缓存失效通知

当 Master 修改数据时，Worker 会收到通知：
```
[Master] ✍️  Written "user:1000:name" = "Bob"

[Worker 1] 🔄 Cache invalidated for keys: [ 'user:1000:name' ]
[Worker 1] 🗑️  Removed from local cache: user:1000:name
```

### 3. 自动重新缓存

失效后，下次读取会自动从 Redis 获取新值并重新缓存：
```
[Worker 1] ⚠️  Local cache MISS for "user:1000:name", fetching from Redis...
[Worker 1] 💾 Cached "user:1000:name": Bob
```

### 4. 性能统计

Worker 会显示缓存统计：
```
[Worker 1] 📊 Statistics:
  Cache Hits: 15
  Cache Misses: 3
  Hit Rate: 83.33%
  Local Cache Size: 3 keys
```

## 技术细节

### Client-Side Caching 工作原理

1. **RESP3 协议**: Worker 使用 RESP3 协议连接，这是 Redis 6.0+ 的新协议
2. **CLIENT TRACKING ON**: 显式启用客户端跟踪功能
3. **Tracking**: Redis 跟踪客户端访问了哪些 key
4. **Invalidation**: 当 key 被修改时，Redis 推送失效消息给客户端
5. **本地缓存**: 客户端维护本地内存缓存，收到失效消息时清除对应 key

### 代码关键点

**Worker 端启用缓存**:
```javascript
const { createClient, BasicClientSideCache } = require('redis');

// 创建缓存实例
const cache = new BasicClientSideCache({
  ttl: 60000,        // 60秒 TTL
  maxEntries: 1000,  // 最多 1000 个条目
  evictPolicy: 'LRU', // LRU 淘汰策略
  recordStats: true  // 记录统计
});

// 创建客户端
const client = createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,  // 启用 RESP3 协议
  clientSideCache: cache  // 传入缓存实例
});

await client.connect();

// 监听失效事件（注意：监听 cache 对象，不是 client）
cache.on('invalidate', (keys) => {
  const keyStr = keys instanceof Buffer ? keys.toString() : String(keys);
  console.log('缓存失效:', keyStr);
});
```

**使用缓存**:
```javascript
// 直接使用普通的 get 方法，缓存自动工作
const value = await client.get('mykey');

// 查看缓存统计
const stats = cache.stats();
console.log(`命中率: ${(stats.hitRate() * 100).toFixed(2)}%`);
console.log(`缓存大小: ${cache.size()} keys`);
```

### 性能优势

- **读取延迟**: 本地缓存 < 1ms，Redis 网络往返 ~1-5ms
- **减少网络**: 大幅减少与 Redis 的网络交互
- **降低 Redis 负载**: 热点数据不需要重复查询 Redis

### 适用场景

✅ **适合**:
- 读多写少的场景
- 热点数据访问
- 配置数据、用户信息等变化不频繁的数据

❌ **不适合**:
- 写入频繁的数据
- 需要强一致性的场景
- 缓存失效会带来严重问题的场景

## Redis 配置要求

确保 Redis 版本 >= 6.0，并且支持 client-side caching。

测试 Redis 版本：
```bash
redis-cli -p 6379 INFO server | grep redis_version
```

## 故障排查

### 连接失败
检查 Redis 是否运行：
```bash
redis-cli -p 6379 PING
```

或使用提供的测试脚本：
```bash
npm test
```

### 缓存失效通知未收到
确保使用的是 node-redis v4+ 并且启用了 RESP3 协议。

### 端口问题
默认连接 `localhost:6379`，如需修改，编辑 `src/worker.js` 和 `src/master.js` 中的连接配置。

## License

ISC
