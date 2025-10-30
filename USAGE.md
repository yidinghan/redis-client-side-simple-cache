# 使用指南

## 项目文件说明

```
.
├── README.md              # 项目文档
├── package.json           # 项目配置
├── test-connection.js     # Redis 连接测试
└── src/
    ├── demo.js           # 完整演示脚本（单进程）
    ├── worker.js         # Worker 进程（只读 + 客户端缓存）
    └── master.js         # Master 进程（写入）
```

## 运行步骤

### 1. 测试 Redis 连接

```bash
npm test
```

预期输出：
```
✅ Connected successfully!
✅ PING response: PONG
✅ Connection test passed!
```

### 2. 快速演示（推荐新手）

```bash
npm run demo
```

这个脚本会自动演示：
- Worker 建立本地缓存
- 从本地缓存读取（高命中率）
- Master 修改数据
- 缓存失效机制
- 完整的性能统计

### 3. 双进程演示（真实场景）

打开两个终端：

**终端 1 - Worker（只读）**:
```bash
npm run worker
```

你会看到 Worker 每 3 秒读取一次数据，并显示缓存命中情况。

**终端 2 - Master（写入）**:

交互模式：
```bash
npm run master
```

然后输入命令：
```
master> set user:1000:name Charlie
master> set user:1000:email charlie@example.com
master> incr counter
master> auto    # 开启自动更新（每 5 秒）
master> stop    # 停止自动更新
```

自动模式：
```bash
npm run master:auto
```

### 4. 观察缓存失效

在双终端模式下，当你在 Master 终端修改数据时，观察 Worker 终端的输出：

1. Worker 会收到缓存失效通知
2. 自动清除本地对应的 key
3. 下次读取时从 Redis 重新获取
4. 新数据再次被缓存

## 性能对比

### 无缓存场景
```
每次读取: ~1-5ms (网络往返 + Redis 查询)
1000 次读取: ~1-5 秒
```

### 客户端缓存场景
```
首次读取: ~1-5ms (从 Redis 获取)
后续读取: <0.1ms (从本地内存)
1000 次读取: ~100ms (假设 10% 失效率)
```

**性能提升**: 10-50 倍！

## 常见问题

### Q: 为什么没有看到缓存失效通知？

A: 确保：
1. Redis 版本 >= 6.0
2. Worker 使用 RESP3 协议连接
3. 已执行 `CLIENT TRACKING ON` 命令
4. Master 和 Worker 是不同的连接

### Q: 本地缓存什么时候会失效？

A: 当满足以下任一条件：
- Master 修改了对应的 key（SET, INCR, DEL 等）
- 手动清除本地缓存
- 收到 Redis 的全局失效通知（keys = null）

### Q: 适合什么场景？

A: 
✅ 读多写少（读写比 > 10:1）
✅ 热点数据访问
✅ 配置数据、用户资料
✅ 商品信息、分类数据

❌ 写入频繁的数据
❌ 强一致性要求
❌ 实时性要求极高的数据

### Q: 内存会不会爆？

A: Worker 的本地缓存是 JavaScript Map，会受 V8 内存限制。建议：
- 只缓存热点数据
- 设置缓存大小上限（LRU）
- 定期清理过期缓存

## 进阶使用

### 添加 LRU 缓存淘汰

修改 Worker 的 localCache，使用 `lru-cache` 包：

```bash
npm install lru-cache
```

```javascript
const LRU = require('lru-cache');

const localCache = new LRU({
  max: 1000,        // 最多 1000 个 key
  maxSize: 50000,   // 最大 50MB
  sizeCalculation: (value) => value.length,
  ttl: 1000 * 60 * 5 // 5 分钟 TTL
});
```

### 多 Worker 场景

在生产环境中，通常有多个 Worker 实例：

```
         Master
            │
            ▼
          Redis
         ╱  │  ╲
        ▼   ▼   ▼
    Worker1 Worker2 Worker3
```

每个 Worker 维护自己的本地缓存，都会收到失效通知。

### 监控缓存性能

添加 Prometheus 指标：

```javascript
const promClient = require('prom-client');

const cacheHitCounter = new promClient.Counter({
  name: 'redis_cache_hits_total',
  help: 'Total number of cache hits'
});

const cacheMissCounter = new promClient.Counter({
  name: 'redis_cache_misses_total',
  help: 'Total number of cache misses'
});
```

## 参考资料

- [Redis Client-Side Caching](https://redis.io/docs/manual/client-side-caching/)
- [RESP3 协议](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md)
- [node-redis 文档](https://github.com/redis/node-redis)
