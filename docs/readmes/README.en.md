# redis-simple-client-side-cache

[![Run Tests](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml/badge.svg)](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/redis-simple-client-side-cache.svg)](https://www.npmjs.com/package/redis-simple-client-side-cache)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

A minimalist Redis client-side cache implementation with ~80 lines of core code, supporting RESP3 protocol. Extends `ClientSideCacheProvider` from `node-redis` v4+, providing local Map caching, GET/SET operations, and automatic invalidation handling.

## ✨ Core Features

- 🎯 **Minimalist Design**: Only ~80 lines of core implementation
- ⚡ **High Performance**: In-memory cache with <1ms access latency
- 🔄 **Auto Invalidation**: Supports key-specific and global (FLUSHDB) cache invalidation
- 🛡️ **Structured Cloning**: Returns deep copies to avoid reference sharing issues
- 📡 **Event-Driven**: Emits `invalidate` events for all cache changes
- 🧪 **Comprehensive Tests**: 6 test scenarios covering edge cases and memory leak detection
- 🔌 **Simple Integration**: Works seamlessly with `node-redis` v4+

## 📦 Installation

```bash
npm install redis-simple-client-side-cache redis
```

## 🚀 Quick Start

```javascript
const { SimpleClientSideCache } = require('redis-simple-client-side-cache');
const redis = require('redis');

// Create cache instance
const cache = new SimpleClientSideCache();

// Create Redis client with RESP3 protocol enabled
const client = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,  // Required for client-side caching
  clientSideCache: cache
});

await client.connect();

// Listen for invalidation events
cache.on('invalidate', (key) => {
  console.log('Cache invalidated:', key === null ? 'ALL' : key.toString());
});

// Normal usage - caching works automatically
const value = await client.get('mykey');  // Fetches from Redis and caches
const value2 = await client.get('mykey'); // Cache hit - instant return

// Automatic invalidation on write
await client.set('mykey', 'newvalue');    // Triggers invalidation
const value3 = await client.get('mykey'); // Fetches latest data

console.log('Cache size:', cache.size());
console.log('Cache stats:', cache.stats());
```

## 🚀 Performance Benchmarks

In hot key scenarios (5 keys repeatedly read), client-side caching dramatically improves performance:

| Metric | Without Cache | With Cache | Improvement |
|--------|---------------|------------|-------------|
| **Throughput** | 4,409 ops/s | 1,388,889 ops/s | **315x** |
| **Avg Latency** | 0.227ms | 0.001ms | **99.7%↓** |
| **Time per Round** (100K ops) | 22.68s | 0.07s | Save 22.61s |

> Benchmark config: 3 rounds × 100,000 operations, 5 hot keys, 1KB payload  
> Run benchmark: `node scripts/bench-get-performance.js`

**Key Findings**:
- 🚀 Cache hit latency drops from 0.227ms to 0.001ms
- ⚡ Handles 1.3M+ read operations per second (vs 4K without cache)
- 💾 Best for read-heavy scenarios with 10:1+ read/write ratio

## 📚 API Reference

### SimpleClientSideCache

#### Constructor
```javascript
new SimpleClientSideCache()
```
No configuration needed - works out of the box.

#### Methods

- **`size()`**: Returns the number of cached entries
- **`stats()`**: Returns cache statistics object
- **`clear()`**: Clears all cache entries
- **`on('invalidate', callback)`**: Listen for cache invalidation events

#### Events

- **`invalidate`**: Triggered when cache is invalidated
  - `key`: The invalidated Redis key (Buffer) or `null` for global flush

## 🎯 Use Cases

### ✅ Best Fit For:
- Read-heavy workloads (10:1+ read/write ratio)
- Hot data access patterns
- Configuration data, user profiles, product catalogs
- Applications needing minimal code footprint
- Developers who want full control and understanding of the cache

### ❌ Not Suitable For:
- Write-heavy or evenly distributed read/write patterns
- Strong consistency requirements
- Need for TTL expiration or LRU/FIFO eviction policies
- Memory-constrained environments without manual cache management

## 🏗️ Architecture

Based on Redis RESP3 protocol client-side caching:

```
┌─────────────┐                    ┌──────────────┐
│   Writer    │ ──── SET/DEL ───▶  │    Redis     │
│  Process    │                    │   Server     │
└─────────────┘                    └──────────────┘
                                         │
                                         │ Invalidation
                                         │ Notification
                                         ▼
                                   ┌──────────────┐
                                   │   Reader     │
                                   │   Process    │
                                   │              │
                                   │ Local Cache: │
                                   │  ┌─────────┐ │
                                   │  │   Map   │ │
                                   │  └─────────┘ │
                                   └──────────────┘
```

### How It Works:

1. **RESP3 Protocol**: Client enables tracking using RESP3
2. **CLIENT TRACKING ON**: Redis tracks which keys the client accessed
3. **Local Caching**: First GET stores data in local Map
4. **Invalidation Notification**: When key changes, Redis pushes invalidation message
5. **Automatic Refresh**: Next GET fetches latest data and re-caches

## 📖 Documentation

- [USAGE.md](../USAGE.md) - Detailed usage guide
- [SIMPLE-CACHE.md](../SIMPLE-CACHE.md) - Implementation details
- [CHANGELOG.md](../../CHANGELOG.md) - Version history

## 🔧 Requirements

- Node.js >= 18
- Redis >= 6.0 (with RESP3 and client-side caching support)
- `redis` package v4.0.0 or v5.0.0+

## 📄 License

ISC License - see [LICENSE](../../LICENSE) file for details.

## 🙏 Acknowledgments

Built on top of [node-redis](https://github.com/redis/node-redis) v4+.
