# @playding/redis-simple-csc

**Read this in other languages**: [English](docs/readmes/README.en.md) | [简体中文](README.md)

[![Run Tests](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml/badge.svg)](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@playding/redis-simple-csc.svg)](https://www.npmjs.com/package/@playding/redis-simple-csc)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.19.0-brightgreen)](https://nodejs.org/)

一个极简的 Redis 客户端缓存实现，核心代码仅 ~80 行，支持 RESP3 协议。继承自 `node-redis` 5.12.1 的 `ClientSideCacheProvider`，提供本地 Map 缓存、GET/SET 操作和自动失效处理。

## ✨ 核心特性

- 🎯 **极简设计**：核心实现仅 ~80 行代码
- ⚡ **高性能**：内存缓存，访问延迟小于 1 毫秒
- 🔄 **自动失效**：支持特定键和全局（FLUSHDB）缓存失效
- 🛡️ **结构化克隆**：返回深拷贝，避免引用共享问题
- 📡 **事件驱动**：为所有缓存变更发出 `invalidate` 事件
- 🧪 **完善测试**：6 个综合测试场景，覆盖边缘情况和内存泄漏检测
- 🔌 **简单集成**：与 `node-redis` 5.12.1 无缝配合

## 📦 安装

```bash
npm install @playding/redis-simple-csc redis@5.12.1
```

0.4.0 保留原根入口 API，但运行环境收窄为 Node.js >=18.19.0、`redis@5.12.1`。
升级包前先升级运行环境；尚未迁移的项目继续使用原有锁定版本。
原根入口的 provider 与调用方 Redis client 应使用同一份 `@redis/client`。

## 🚀 快速开始

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const redis = require('redis');

// 创建缓存实例
const cache = new SimpleClientSideCache();

// 创建 Redis 客户端并启用 RESP3 协议
const client = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,  // 客户端缓存必需
  clientSideCache: cache
});

await client.connect();

// 监听失效事件
cache.on('invalidate', (key) => {
  console.log('缓存失效:', key === null ? '全部' : key.toString());
});

// 正常使用 - 缓存自动工作
const value = await client.get('mykey');  // 从 Redis 获取并缓存
const value2 = await client.get('mykey'); // 缓存命中 - 立即返回

// 写入时自动失效缓存
await client.set('mykey', 'newvalue');    // 触发失效
const value3 = await client.get('mykey'); // 获取最新数据

console.log('缓存大小:', cache.size());
console.log('缓存统计:', cache.stats());

// 启用统计功能示例
const cacheWithStats = new SimpleClientSideCache({ enableStat: true });
const client2 = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,
  clientSideCache: cacheWithStats
});

await client2.connect();
await client2.get('key1'); // miss
await client2.get('key1'); // hit

console.log(cacheWithStats.stats());
// {
//   hitCount: 1,
//   missCount: 1,
//   loadSuccessCount: 1,
//   loadFailureCount: 0,
//   totalLoadTime: 0.5,
//   evictionCount: 0
// }
```

## Redis Cluster 有界缓存

这个入口提供 **Redis Cluster 上的有界热点缓存**。Cluster 连接由 `node-redis`
提供；本包增加容量约束，并让淘汰同步回收反向引用，避免只限制主缓存却保留旧引用。

| 行为 | 根入口 `SimpleClientSideCache` | `/cluster` 的 `createCachedCluster` |
|---|---|---|
| 接入方式 | 创建 provider，由调用方传给 `createClient` | 同时创建 Cluster client 和匹配的 pooled provider |
| 容量与淘汰 | 默认无界，可注入自定义 Map；两张 Map 没有联动淘汰 | 必填 `maxEntries`，内建 LRU，淘汰同步清理反向引用 |
| 失效后的在途读取 | 完成后仍可能重新写入缓存 | 旧响应可以返回调用方，但不能重新填入缓存 |
| 连接生命周期 | 已有 `onError` / `onClose` 清缓存 | 复用 node-redis 的 Cluster 生命周期，包括拓扑重发现清理 |

独立入口保留原 API 和自定义 Map 扩展，同时满足 Cluster 对 pooled provider 的要求。
当前新增的容量能力只通过 `/cluster` 提供；原根入口实现不变。

```javascript
const { createCachedCluster } = require('@playding/redis-simple-csc/cluster');

const { client, cache } = createCachedCluster({
  clusterOptions: {
    rootNodes: [{ url: 'redis://127.0.0.1:16379' }]
  },
  cacheOptions: { maxEntries: 10000 }
});

client.on('error', console.error);
await client.connect();
const members = await client.sMembers('example:key');
console.log(cache.size(), cache.stats());
await client.close();
```

factory 返回尚未连接的客户端；调用方负责连接和关闭。`maxEntries` 必须是正安全整数，
包含空结果及未完成读取。使用 RESP3、LRU、`ttl=0` 和 ordinary tracking；淘汰同步
回收反向引用。连接关闭、错误或拓扑重发现会清缓存，失效前的在途读取不会重新填入。
`cacheOptions.recordStats` 可沿用 node-redis 的统计开关。
示例容量不代表生产推荐值；条目数上限不是进程内存字节上限。失效前的在途请求
仍可能向调用方返回旧响应，但该响应不能重新填入缓存。

本地可用 `bash scripts/test-cluster-env.sh up` 启动隔离的三主节点 Cluster，
用 `bash scripts/test-cluster-env.sh down` 清理。默认使用 Docker，可设置
`CONTAINER_ENGINE=podman` 和 `REDIS_IMAGE`；完整 suite 还需要独立的 `localhost:6379`。

真实 Cluster 验证使用独立测试实例；旧 suite 会清空 `localhost:6379` 的测试数据库：

```bash
REDIS_CLUSTER_URLS=redis://127.0.0.1:16379,redis://127.0.0.1:16380,redis://127.0.0.1:16381 npm test
```

仅验证新子路径可运行 `npm run test:cluster`，同样需要上述环境变量。

## 🚀 性能基准测试

以下历史结果来自根入口 `SimpleClientSideCache` 与单节点 Redis，不代表 `/cluster` 的性能。

在热点键场景下（5个键重复读取），客户端缓存显著提升性能：

| 指标 | 无缓存 | 有缓存 | 提升 |
|------|--------|--------|------|
| **吞吐量** | 4,409 ops/s | 1,388,889 ops/s | **315x** |
| **平均延迟** | 0.227ms | 0.001ms | **99.7%↓** |
| **单轮耗时** (100K ops) | 22.68s | 0.07s | 节省 22.61s |

> 基准测试配置：3轮 × 100,000次操作，5个热点键，1KB负载  
> 运行测试：`node scripts/bench-get-performance.js`

**关键发现**：
- 🚀 缓存命中时延迟从 0.227ms 降至 0.001ms
- ⚡ 每秒可处理 130万+ 次读操作（vs 无缓存的 4千次）
- 💾 适用于读多写少场景，10:1+ 读写比时收益最大

## 📚 API 参考

### SimpleClientSideCache

#### 构造函数
```javascript
new SimpleClientSideCache(options)
```

**参数:**
- `options` (Object, 可选)
  - `enableStat` (Boolean): 启用统计功能，默认 `false`
  - `CacheMapClass` (Function): 自定义 Map 类用于缓存存储（必须继承自 native Map），默认 `Map`
  - `KeyMapClass` (Function): 自定义 Map 类用于键到缓存键的映射（必须继承自 native Map），默认 `Map`

**示例:**
```javascript
// 默认 - 使用原生 Map
const cache = new SimpleClientSideCache();

// 启用统计
const cache = new SimpleClientSideCache({ enableStat: true });

// 使用自定义 Map 类
class LRUMap extends Map {
  // ... 自定义实现
}

const cache = new SimpleClientSideCache({ 
  CacheMapClass: LRUMap,
  KeyMapClass: LRUMap 
});
```

#### 方法

- **`size()`**: 返回缓存条目数量
- **`stats()`**: 返回缓存统计对象 (启用统计时返回实际值，否则返回零值)
  - `hitCount`: 缓存命中次数
  - `missCount`: 缓存未命中次数
  - `loadSuccessCount`: 成功加载次数
  - `loadFailureCount`: 加载失败次数
  - `totalLoadTime`: 总加载时间 (毫秒)
  - `evictionCount`: 缓存驱逐次数
- **`clear()`**: 清除所有缓存条目
- **`on('invalidate', callback)`**: 监听缓存失效事件

#### 事件

- **`invalidate`**: 缓存失效时触发
  - `key`: 失效的 Redis 键（Buffer）或全局清空时为 `null`

## 🎯 适用场景

### ✅ 最适合：
- 读多写少的工作负载（读写比 10:1+）
- 热点数据访问模式
- 配置数据、用户信息、商品目录
- 需要极简代码的应用
- 希望完全掌控和理解缓存机制的开发者

### ❌ 不推荐：
- 写入频繁或读写均衡的场景
- 需要强一致性保证
- 需要 TTL 过期或 LRU/FIFO 淘汰策略
- 内存受限且无法手动管理缓存的环境

## 🏗️ 架构设计

基于 Redis RESP3 协议的客户端缓存：

```
┌─────────────┐                    ┌──────────────┐
│  写入进程    │ ──── SET/DEL ───▶  │    Redis     │
│   Writer    │                    │   Server     │
└─────────────┘                    └──────────────┘
                                         │
                                         │ 失效通知
                                         │ invalidation
                                         ▼
                                   ┌──────────────┐
                                   │  读取进程    │
                                   │   Reader     │
                                   │              │
                                   │ 本地缓存:    │
                                   │  ┌─────────┐ │
                                   │  │   Map   │ │
                                   │  └─────────┘ │
                                   └──────────────┘
```

### 工作原理：

1. **RESP3 协议**：客户端使用 RESP3 启用跟踪
2. **CLIENT TRACKING ON**：Redis 跟踪客户端访问了哪些键
3. **本地缓存**：首次 GET 将数据存储在本地 Map 中
4. **失效通知**：当键变更时，Redis 推送失效消息
5. **自动刷新**：下次 GET 获取最新数据并重新缓存

## 📖 文档

- [USAGE.md](docs/USAGE.md) - 详细使用指南
- [SIMPLE-CACHE.md](docs/SIMPLE-CACHE.md) - 实现细节
- [CHANGELOG.md](CHANGELOG.md) - 版本历史

## 🔧 依赖要求

- Node.js >= 18.19.0
- Redis >= 6.0（支持 RESP3 和客户端缓存）
- `redis` 包 5.12.1

## 📄 许可证

ISC 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

基于 [node-redis](https://github.com/redis/node-redis) 5.12.1 构建。
