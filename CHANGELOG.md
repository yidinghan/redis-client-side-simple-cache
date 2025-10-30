# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-30

### Added
- Initial release of SimpleClientSideCache
- Minimal ~80-line implementation extending ClientSideCacheProvider
- Support for Redis RESP3 protocol client-side caching
- Key-specific and global (FLUSHDB) invalidation handling
- Structured cloning to prevent reference sharing issues
- Event emission for cache invalidation
- Comprehensive test suite with 6 test scenarios:
  - Concurrent read/write operations
  - Batch operations (MGET)
  - Multiple data types (String, Hash, JSON)
  - Edge cases (null, empty, large values, special characters)
  - Invalidation scenarios (SET, DEL, FLUSHDB)
  - Memory leak detection
- Complete documentation (README, USAGE, SIMPLE-CACHE)
- GitHub Actions CI/CD with Node.js 18, 20, 22, 24
- MIT License

[1.0.0]: https://github.com/yidinghan/redis-client-side-simple-cache/releases/tag/v1.0.0
