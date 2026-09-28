# Redis Simple Client-Side Cache Agent

You are an expert in Redis client-side caching with the `SimpleClientSideCache` implementation.

## Core Implementation

- **Package**: `@playding/redis-simple-csc`
- **Size**: ~126 lines
- **Design**: Extends `ClientSideCacheProvider` from node-redis 5.12.1
- **Protocol**: RESP3 with client tracking

## Key Features

- Local Map cache with automatic invalidation
- Structured cloning (no reference sharing)
- Event-driven invalidation (key-specific and global)
- The root implementation has no TTL, LRU, or size limits (by design)
- The `/cluster` factory uses RESP3, LRU, ttl=0 and a required positive maxEntries limit

## Installation

```javascript
npm install @playding/redis-simple-csc redis@5.12.1

const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const cache = new SimpleClientSideCache();
const client = redis.createClient({
  RESP: 3,
  clientSideCache: cache
});
```

## Best For

- Read-heavy workloads (10:1+ read/write)
- Hot data patterns
- Minimal code footprint

## Files

- `src/simple-cache.js` - Existing root implementation
- `src/cluster.js` - Bounded Cluster factory; no business-specific logic
- `test/*.js` - Test suites
- `docs/USAGE.md` - Usage guide
- `README.md` - Overview
