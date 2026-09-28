# @playding/redis-simple-csc

[![Run Tests](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml/badge.svg)](https://github.com/yidinghan/redis-client-side-simple-cache/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@playding/redis-simple-csc.svg)](https://www.npmjs.com/package/@playding/redis-simple-csc)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.19.0-brightgreen)](https://nodejs.org/)

A minimalist Redis client-side cache implementation with ~80 lines of core code, supporting RESP3 protocol. Extends `ClientSideCacheProvider` from `node-redis` 5.12.1, providing local Map caching, GET/SET operations, and automatic invalidation handling.

## ✨ Core Features

- 🎯 **Minimalist Design**: Only ~80 lines of core implementation
- ⚡ **High Performance**: In-memory cache with <1ms access latency
- 🔄 **Auto Invalidation**: Supports key-specific and global (FLUSHDB) cache invalidation
- 🛡️ **Structured Cloning**: Returns deep copies to avoid reference sharing issues
- 📡 **Event-Driven**: Emits `invalidate` events for all cache changes
- 🧪 **Comprehensive Tests**: 6 test scenarios covering edge cases and memory leak detection
- 🔌 **Simple Integration**: Works seamlessly with `node-redis` 5.12.1

## 📦 Installation

```bash
npm install @playding/redis-simple-csc redis@5.12.1
```

Version 0.4.0 preserves the root API but requires Node.js >=18.19.0 and `redis@5.12.1`.
Upgrade the runtime before upgrading this package; keep the previous locked version otherwise.
The root provider and the caller's Redis client must resolve the same `@redis/client` instance.

## 🚀 Quick Start

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
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

// Enable statistics example
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

## Redis Cluster cache

This entry point provides on-demand caching for Redis Cluster. node-redis handles the
Cluster connection and commands; this package maintains cached entries and reverse
references, removing both when an invalidation arrives.

| Behavior | Root `SimpleClientSideCache` | `/cluster` `createCachedCluster` |
|---|---|---|
| Integration | Provider passed by the caller to `createClient` | Creates the Cluster client and matching pooled provider together |
| Storage | Native Map by default, with custom Map injection | Native Map, without custom Map injection |
| Capacity and eviction | No entry limit or LRU by default | No entry limit or LRU |
| In-flight reads after invalidation | A completed response can refill the cache | A stale response may reach its caller but cannot refill the cache |
| Connection lifecycle | Already clears on `onError` / `onClose` | Reuses node-redis Cluster lifecycle handling, including topology rediscovery |

The separate entry point meets Cluster's pooled-provider requirement. The root API,
implementation and custom Map extension remain unchanged.

```javascript
const { createCachedCluster } = require('@playding/redis-simple-csc/cluster');

const { client, cache } = createCachedCluster({
  clusterOptions: {
    rootNodes: [{ url: 'redis://127.0.0.1:16379' }]
  }
});

client.on('error', console.error);
await client.connect();
const members = await client.sMembers('example:key');
console.log(cache.size(), cache.stats());
await client.close();
```

The factory returns a disconnected client; the caller owns its lifecycle. The cache
uses RESP3, `ttl=0` and ordinary tracking, and caches empty results too. Connection
errors, closure and topology rediscovery clear cached data. Invalidated in-flight
responses may still reach their caller but cannot refill the cache.
`cacheOptions.recordStats` follows node-redis. On-demand caching has no entry limit or
automatic eviction and does not guarantee bounded process memory.

Start an isolated three-primary Cluster with `bash scripts/test-cluster-env.sh up` and
remove it with `bash scripts/test-cluster-env.sh down`. Docker is the default; override
`CONTAINER_ENGINE=podman` or `REDIS_IMAGE` when needed. The full suite also needs a
dedicated standalone Redis at `localhost:6379`, whose database the legacy tests flush.

```bash
REDIS_CLUSTER_URLS=redis://127.0.0.1:16379,redis://127.0.0.1:16380,redis://127.0.0.1:16381 npm test
```

Use `npm run test:cluster` with the same environment to run only the Cluster suite.

## 🚀 Performance Benchmarks

These historical results use the root `SimpleClientSideCache` with standalone Redis;
they do not measure `/cluster` performance.

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
new SimpleClientSideCache(options)
```

**Parameters:**
- `options` (Object, optional)
  - `enableStat` (Boolean): Enable statistics tracking, default `false`
  - `CacheMapClass` (Function): Custom Map class for cache storage (must extend native Map), default `Map`
  - `KeyMapClass` (Function): Custom Map class for key-to-cacheKeys mapping (must extend native Map), default `Map`

**Examples:**
```javascript
// Default - native Map
const cache = new SimpleClientSideCache();

// Stats enabled
const cache = new SimpleClientSideCache({ enableStat: true });

// Custom Map class
class LRUMap extends Map {
  // ... custom implementation
}

const cache = new SimpleClientSideCache({ 
  CacheMapClass: LRUMap,
  KeyMapClass: LRUMap 
});
```

#### Methods

- **`size()`**: Returns the number of cached entries
- **`stats()`**: Returns cache statistics object (actual values when enabled, zeros when disabled)
  - `hitCount`: Number of cache hits
  - `missCount`: Number of cache misses
  - `loadSuccessCount`: Number of successful loads
  - `loadFailureCount`: Number of failed loads
  - `totalLoadTime`: Total load time in milliseconds
  - `evictionCount`: Number of cache evictions
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

- Node.js >= 18.19.0
- Redis >= 6.0 (with RESP3 and client-side caching support)
- `redis` package 5.12.1

## 📄 License

ISC License - see [LICENSE](../../LICENSE) file for details.

## 🙏 Acknowledgments

Built on top of [node-redis](https://github.com/redis/node-redis) 5.12.1.
