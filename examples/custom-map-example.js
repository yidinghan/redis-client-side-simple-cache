#!/usr/bin/env node

const { SimpleClientSideCache } = require('../src/simple-cache');
const redis = require('redis');

/**
 * 示例：使用自定义 LRU Map 限制缓存大小
 */

// LRU Map 实现
class LRUMap extends Map {
  constructor(maxSize = 1000) {
    super();
    this.maxSize = maxSize;
  }

  get(key) {
    const value = super.get(key);
    if (value !== undefined) {
      // 重新插入以更新顺序（最近使用的移到末尾）
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  set(key, value) {
    // 如果键已存在，先删除以更新顺序
    if (super.has(key)) {
      super.delete(key);
    }
    
    // 达到上限时删除最旧的条目（第一个）
    if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      console.log(`🗑️  LRU淘汰: ${firstKey}`);
      super.delete(firstKey);
    }
    
    return super.set(key, value);
  }
}

// 带大小限制的 Map
class LimitedMap extends Map {
  constructor(maxSize = 100) {
    super();
    this.maxSize = maxSize;
  }

  set(key, value) {
    if (this.size >= this.maxSize) {
      const firstKey = this.keys().next().value;
      console.log(`📦 大小限制淘汰: ${firstKey}`);
      this.delete(firstKey);
    }
    return super.set(key, value);
  }
}

// 带监控的 Map
class MonitoredMap extends Map {
  constructor() {
    super();
    this.metrics = {
      sets: 0,
      gets: 0,
      deletes: 0,
      clears: 0
    };
  }

  get(key) {
    this.metrics.gets++;
    return super.get(key);
  }

  set(key, value) {
    this.metrics.sets++;
    return super.set(key, value);
  }

  delete(key) {
    this.metrics.deletes++;
    return super.delete(key);
  }

  clear() {
    this.metrics.clears++;
    return super.clear();
  }

  has(key) {
    return super.has(key);
  }

  getMetrics() {
    return { ...this.metrics, size: this.size };
  }
}

async function example1_LRUCache() {
  console.log('\n=== 示例 1: LRU 缓存（最大 5 条） ===\n');
  
  const cache = new SimpleClientSideCache({ 
    CacheMapClass: class extends LRUMap {
      constructor() { super(5); }
    },
    enableStat: true
  });

  const client = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  await client.connect();

  // 写入 10 个键，缓存只能保存 5 个
  console.log('📝 写入 10 个键...');
  for (let i = 1; i <= 10; i++) {
    await client.set(`lru:key${i}`, `value${i}`);
    await client.get(`lru:key${i}`);
    console.log(`   缓存大小: ${cache.size()}`);
  }

  console.log(`\n✅ 最终缓存大小: ${cache.size()} (预期 5)`);
  console.log('📊 统计:', cache.stats());

  // 清理
  for (let i = 1; i <= 10; i++) {
    await client.del(`lru:key${i}`);
  }
  await client.quit();
}

async function example2_MonitoredCache() {
  console.log('\n=== 示例 2: 带监控的缓存 ===\n');
  
  const cache = new SimpleClientSideCache({ 
    CacheMapClass: MonitoredMap,
    KeyMapClass: MonitoredMap
  });

  const client = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  await client.connect();

  console.log('📝 执行一些操作...');
  await client.set('mon:key1', 'value1');
  await client.get('mon:key1'); // miss
  await client.get('mon:key1'); // hit
  await client.get('mon:key1'); // hit
  await client.set('mon:key1', 'newvalue'); // invalidate

  console.log('\n📊 Cache Map 指标:', cache.cache.getMetrics());
  console.log('📊 KeyMap 指标:', cache.keyToCacheKeys.getMetrics());

  await client.del('mon:key1');
  await client.quit();
}

async function example3_MixedMaps() {
  console.log('\n=== 示例 3: 混合使用不同 Map 类 ===\n');
  
  // 缓存用 LRU，键映射用普通 Map
  const cache = new SimpleClientSideCache({ 
    CacheMapClass: class extends LRUMap {
      constructor() { super(3); }
    },
    KeyMapClass: Map
  });

  const client = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  await client.connect();

  console.log('📝 写入 5 个键，缓存限制 3 个...');
  for (let i = 1; i <= 5; i++) {
    await client.set(`mix:key${i}`, `value${i}`);
    await client.get(`mix:key${i}`);
  }

  console.log(`\n✅ Cache Map 类型: ${cache.cache.constructor.name}`);
  console.log(`✅ KeyMap 类型: ${cache.keyToCacheKeys.constructor.name}`);
  console.log(`📦 缓存大小: ${cache.size()} (限制 3)`);
  console.log(`📦 键映射大小: ${cache.keyToCacheKeys.size}`);

  for (let i = 1; i <= 5; i++) {
    await client.del(`mix:key${i}`);
  }
  await client.quit();
}

async function main() {
  console.log('🚀 自定义 Map 类示例\n');
  
  try {
    await example1_LRUCache();
    await example2_MonitoredCache();
    await example3_MixedMaps();
    
    console.log('\n✨ 所有示例完成!\n');
  } catch (err) {
    console.error('❌ 错误:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { LRUMap, LimitedMap, MonitoredMap };
