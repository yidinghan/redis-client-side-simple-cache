# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-10-31

### Added
- Custom Map class support via `CacheMapClass` and `KeyMapClass` options
- Type validation: classes must extend native Map
- 8 new tests for custom Map functionality
- Example file with LRUMap, LimitedMap, MonitoredMap implementations

### Changed
- Constructor accepts `options = { enableStat, CacheMapClass, KeyMapClass }`
- Updated documentation (README.md, USAGE.md)

### Notes
- Backward compatible (defaults to native Map)
- All 29 tests passing

## [0.2.0] - 2025-10-31

### Added
- Optional statistics support via `enableStat` constructor option
- Track hit/miss, load success/failure, load time, evictions
- Zero-overhead closure pattern (1.14ns/op when disabled, 642% faster than if-check)
- Comprehensive test suite for statistics (`test/test-stats.js`)
- Performance benchmark script (`scripts/bench-stat-methods.js`)

### Changed
- Constructor now accepts `options = { enableStat: boolean }`
- `stats()` returns actual values when enabled, zeros when disabled

### Notes
- Fully backward compatible (stats disabled by default)
- Line count: 127 → 172 lines (+45)

## [0.1.0] - 2025-10-31

### 🎉 Initial Release

A minimal Redis client-side cache implementation (~126 lines) with RESP3 protocol support.

### ✨ Features

- **Core Implementation**
  - Simple client-side cache extending `ClientSideCacheProvider` from node-redis v4+
  - Local Map-based caching with automatic invalidation
  - Structured cloning to prevent reference sharing issues
  - Event-driven invalidation notifications
  - Support for GET, MGET, and batch operations

- **Cache Invalidation**
  - Key-specific invalidation (SET, DEL triggers)
  - Global invalidation (FLUSHDB trigger with `key=null`)
  - Precise invalidation tracking via `keyToCacheKeys` reverse index
  - Handles multi-key commands (MGET) correctly

- **Data Structure**
  - `cache`: Map storing cacheKey → value
  - `keyToCacheKeys`: Map storing Redis key → Set of cacheKeys for efficient invalidation
  - Cache key format: `${lengths}_${keys}` ensures uniqueness

### 🧪 Testing

- **Comprehensive Test Coverage (100%)**
  - 6 complex test scenarios covering:
    - Concurrent read/write operations (3 workers)
    - Batch operations (MGET) with granular invalidation
    - Multiple data types (String, Hash, JSON)
    - Special characters (中文, emoji, null, empty, large payloads)
    - Edge cases (null values, "0", 1MB data)
    - Memory leak detection (1000 iterations)

- **CI/CD Integration**
  - GitHub Actions workflow for automated testing
  - Supports Node.js 18, 20, 22, 24

### 📊 Performance

- **Benchmarks Included**
  - GET performance: 315x throughput improvement (4.4K → 1.39M ops/s)
  - Average latency: 99.7% reduction (0.227ms → 0.001ms)
  - 100K operations: 22.68s → 0.07s
  - Benchmarks for hot keys (5 keys), large scale (100K keys, 1M ops)

### 📚 Documentation

- Comprehensive README with quick start guide (Chinese + English)
- Detailed usage guide (`docs/USAGE.md`)
- Implementation details (`docs/SIMPLE-CACHE.md`)
- Design rationale for keyToCacheKeys (`docs/WHY-KEYTOCACHEKEYS.md`)
- Performance benchmark documentation

### 🔧 API

- `new SimpleClientSideCache()` - Constructor
- `size()` - Get cache entry count
- `stats()` - Get cache statistics
- `clear()` - Clear all cache entries
- `on('invalidate', callback)` - Listen for invalidation events
- `handleCache()` - Core caching logic (internal)
- `trackingOn()` - Enable Redis tracking (internal)
- `invalidate(key)` - Handle invalidation notifications (internal)

### 📦 Package Configuration

- CommonJS module with ESM-compatible exports
- Peer dependency: `redis ^4.0.0 || ^5.0.0`
- Node.js >= 18 required
- ISC License

### 🎯 Use Cases

**Recommended for:**
- Read-heavy workloads (10:1+ read/write ratio)
- Hot data access patterns
- Configuration data, user profiles, product catalogs
- Minimal code footprint requirements

**Not recommended for:**
- Write-heavy or balanced read/write patterns
- Strong consistency requirements
- Need for TTL, LRU/FIFO eviction policies
- Memory-constrained environments

### 📝 Notes

- No TTL-based expiration (by design)
- No size limits or eviction policies (simplicity over features)
- No hit/miss statistics tracking (stats() returns zeros)
- No Promise deduplication
- Requires Redis 6.0+ with RESP3 support

[0.1.0]: https://github.com/yidinghan/redis-client-side-simple-cache/releases/tag/v0.1.0
