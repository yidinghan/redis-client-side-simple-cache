# redis-simple-client-side-cache

**Read this in other languages**: [English](docs/readmes/README.en.md) | [简体中文](README.md)

[![Run Tests](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml/badge.svg)](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@playding/redis-simple-csc.svg)](https://www.npmjs.com/package/@playding/redis-simple-csc)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

一个极简的 Redis 客户端缓存实现，核心代码仅 ~80 行，支持 RESP3 协议。继承自 `node-redis` v4+ 的 `ClientSideCacheProvider`，提供本地 Map 缓存、GET/SET 操作和自动失效处理。

## ✨ 核心特性

- 🎯 **极简设计**：核心实现仅 ~80 行代码
- ⚡ **高性能**：内存缓存，访问延迟小于 1 毫秒
- 🔄 **自动失效**：支持特定键和全局（FLUSHDB）缓存失效
- 🛡️ **结构化克隆**：返回深拷贝，避免引用共享问题
- 📡 **事件驱动**：为所有缓存变更发出 `invalidate` 事件
- 🧪 **完善测试**：6 个综合测试场景，覆盖边缘情况和内存泄漏检测
- 🔌 **简单集成**：与 `node-redis` v4+ 无缝配合

## 📦 安装

```bash
npm install @playding/redis-simple-csc redis
```

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
```

## 🚀 性能基准测试

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
new SimpleClientSideCache()
```
无需配置 - 开箱即用。

#### 方法

- **`size()`**: 返回缓存条目数量
- **`stats()`**: 返回缓存统计对象
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

- Node.js >= 18
- Redis >= 6.0（支持 RESP3 和客户端缓存）
- `redis` 包 v4.0.0 或 v5.0.0+

## 📄 许可证

ISC 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

基于 [node-redis](https://github.com/redis/node-redis) v4+ 构建。
