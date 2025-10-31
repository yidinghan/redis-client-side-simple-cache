# SimpleClientSideCache - 400万 Key 压力评估报告

> 评估日期: 2025-10-31  
> 环境: Node.js v24.3.0, Redis 7 (Alpine), macOS (Podman)

## 📊 测试概况

**环境配置:**
- Redis Keys: 4,000,000
- Value 大小: 100 bytes  
- Node.js: v24.3.0
- 启动参数: --expose-gc
- 测试脚本: `scripts/bench-4m-evaluation.js`

## 🎯 核心发现

### 1. 内存使用评估

| 场景 | 缓存条目数 | 总内存增量 (Heap Used) | 单条目平均内存 | 400万条目预估 |
|------|-----------|---------------------|--------------|--------------|
| 10% Cache Hit | 400,000 | 159.44 MB | **418 bytes** | **1.56 GB** |
| 30% Cache Hit | 984,664 | 269.54 MB | **287 bytes** | **1.07 GB** |

**结论:** 
- ✅ **400万条目内存占用约 1.0-1.6 GB**
- ✅ **完全可行**，在 8GB 内存的服务器上绰绰有余
- ✅ 单条目平均内存 ~300-400 bytes (包含 key + value + 双向索引结构)

**内存组成分析:**
```
单条目 ~350 bytes ≈
  - Key (cache key): ~15 bytes  (e.g., "6_user:1")
  - Value (data):    ~100 bytes (structuredClone)
  - Key (Redis):     ~10 bytes  (e.g., "user:1")
  - Map overhead:    ~100 bytes (V8 内部结构)
  - Set overhead:    ~50 bytes  (反向索引)
  - 其他:            ~75 bytes  (对象头、指针等)
```

### 2. 性能影响

**无缓存基准:**
- 吞吐量: 4,432 ops/sec
- 平均延迟: 0.225ms
- P95 延迟: 0.283ms
- P99 延迟: 0.346ms

**10% 缓存命中 (40万 keys):**
- 吞吐量: 21,953 ops/sec (**4.95x** 提升 ⬆️ 395%)
- 平均延迟: 0.045ms (80% 降低)
- P95 延迟: 0.237ms (16% 降低)
- **实际命中率: 16.0%**

**30% 缓存命中 (98万 keys):**
- 吞吐量: 11,897 ops/sec (**2.68x** 提升 ⬆️ 168%)
- 平均延迟: 0.084ms (63% 降低)
- P95 延迟: 0.268ms (5% 降低)
- **实际命中率: 5.0%** (注: 测试访问模式为 80% 热点 + 20% 冷数据)

### 3. 性能特征

**优势:**
- ✅ 缓存命中时延迟极低 (**P50 = 0.002ms**, 几乎为 0)
- ✅ 显著提升吞吐量 (最高 **5x**)
- ✅ 内存占用合理且可预测 (线性增长)
- ✅ 失效机制高效 (Map + Set O(1) 删除)

**注意事项:**
- ⚠️ Warmup 时间较长
  - 10% (40万): 91 秒 (~4,400 keys/s)
  - 30% (98万): 277 秒 (~3,550 keys/s)
  - 50% (200万): 466 秒 (~4,290 keys/s)
  - 80% (320万): 预计 12-15 分钟
- ⚠️ 大量缓存可能触发更频繁的 GC (需监控)
- ⚠️ structuredClone 对大对象有性能开销

## 💡 推荐使用场景

### ✅ 理想场景:
1. **读写比例 10:1 或更高**
2. **明确的热点数据分布**
   - 20-30% 的 keys 占 80%+ 的访问 (符合 80/20 定律)
3. **Value 较小** (< 1KB)
4. **可用内存充足** (建议预留 2-4GB)
5. **读延迟敏感** (需要亚毫秒级响应)

### ⚠️ 需要谨慎的场景:
1. **均匀分布访问** → 命中率低，内存浪费
2. **频繁更新** → 失效开销大，缓存效果差
3. **Value 很大** (> 10KB) → 内存占用成倍增长
4. **内存受限** (< 2GB) → 无法缓存足够多的 keys

### ❌ 不适合的场景:
1. 写多读少 (写/读 > 0.5)
2. 访问完全随机 (无热点)
3. 超大 Value (> 100KB)

## 🎯 最佳实践建议

### 内存规划示例

```javascript
// 假设场景参数
const totalKeys = 4_000_000;
const cacheRatio = 0.2;  // 缓存 20% 热点数据
const avgMemoryPerEntry = 350;  // bytes (保守估计)

// 预估内存
const estimatedMemory = totalKeys * cacheRatio * avgMemoryPerEntry;
// = 4,000,000 * 0.2 * 350 = 280 MB

// 建议预留 2x 内存 (考虑 GC 和峰值)
const recommendedMemory = estimatedMemory * 2;  // = 560 MB
```

**不同缓存比例的内存需求:**

| 缓存比例 | 缓存条目数 | 预估内存 | 推荐预留 |
|---------|-----------|---------|---------|
| 5%      | 200,000   | 70 MB   | 140 MB  |
| 10%     | 400,000   | 140 MB  | 280 MB  |
| 20%     | 800,000   | 280 MB  | 560 MB  |
| 30%     | 1,200,000 | 420 MB  | 840 MB  |
| 50%     | 2,000,000 | 700 MB  | 1.4 GB  |
| 100%    | 4,000,000 | 1.4 GB  | 2.8 GB  |

### 生产环境配置示例

```javascript
const { SimpleClientSideCache } = require('@playding/redis-simple-csc');
const redis = require('redis');

// 1. 创建缓存实例 (启用统计)
const cache = new SimpleClientSideCache({ 
  enableStat: true  // 生产环境建议启用,监控命中率
});

// 2. 创建 Redis 客户端
const client = redis.createClient({
  socket: { host: 'localhost', port: 6379 },
  RESP: 3,
  clientSideCache: cache
});

await client.connect();

// 3. 定期监控缓存状态
setInterval(() => {
  const stats = cache.stats();
  const hitRate = stats.hitCount / (stats.hitCount + stats.missCount);
  const cacheSize = cache.size();
  
  console.log('[Cache Stats]', {
    hitRate: `${(hitRate * 100).toFixed(1)}%`,
    cacheSize: cacheSize.toLocaleString(),
    hits: stats.hitCount.toLocaleString(),
    misses: stats.missCount.toLocaleString(),
    evictions: stats.evictionCount.toLocaleString()
  });
  
  // 告警: 命中率过低
  if (hitRate < 0.1 && cacheSize > 10000) {
    console.warn('⚠️  Low cache hit rate! Consider adjusting cache strategy.');
  }
  
  // 告警: 缓存过大
  if (cacheSize > 1_000_000) {
    console.warn('⚠️  Cache size exceeds 1M entries. Monitor memory usage.');
  }
}, 60000); // 每分钟检查一次

// 4. 优雅关闭
process.on('SIGTERM', async () => {
  const finalStats = cache.stats();
  console.log('[Final Stats]', finalStats);
  await client.quit();
  process.exit(0);
});
```

### 预热策略

```javascript
// 策略 1: 应用启动时预热热点数据
async function warmupCache(client, hotKeys) {
  console.log(`Warming up ${hotKeys.length} keys...`);
  const startTime = Date.now();
  
  // 批量读取 (利用 pipeline)
  const batchSize = 100;
  for (let i = 0; i < hotKeys.length; i += batchSize) {
    const batch = hotKeys.slice(i, i + batchSize);
    await Promise.all(batch.map(key => client.get(key)));
    
    if (i % 10000 === 0) {
      console.log(`Warmup progress: ${(i / hotKeys.length * 100).toFixed(1)}%`);
    }
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`Warmup completed in ${duration.toFixed(2)}s`);
}

// 策略 2: 懒加载 + 后台预热
async function backgroundWarmup(client, hotKeyGenerator) {
  // 让应用先启动，后台慢慢预热
  setTimeout(async () => {
    console.log('Starting background warmup...');
    const hotKeys = await hotKeyGenerator(); // 从业务逻辑获取热点 keys
    await warmupCache(client, hotKeys);
  }, 5000); // 延迟 5 秒启动
}
```

## 📈 总结

| 指标 | 评估结果 | 说明 |
|------|---------|------|
| **可行性** | ✅ **完全可行** | 内存和性能都在可接受范围 |
| **内存占用** | ✅ **1.0-1.6 GB** | 400万条目，线性可预测 |
| **性能提升** | ✅ **2-5x 吞吐量** | 取决于命中率 |
| **延迟改善** | ✅ **命中 < 0.01ms** | 几乎消除网络延迟 |
| **GC 压力** | ⚠️ **中等** | 大缓存需监控 |
| **推荐场景** | ✅ **读重 + 热点** | 符合 Pareto 原则 |

## 🚀 最终建议

**SimpleClientSideCache 完全能够应对 400万 key 的场景**，前提是:

### ✅ 必要条件:
1. **有明确的热点数据分布** (20-30% keys 占大部分访问)
2. **服务器有 2-4GB 可用内存**
3. **能接受初始 warmup 时间** (或分批预热)

### 📋 部署检查清单:
- [ ] 确认访问模式符合 80/20 定律
- [ ] 计算并预留足够内存 (使用上面的公式)
- [ ] 启用 `enableStat: true` 监控命中率
- [ ] 设置告警 (命中率 < 10% 或缓存过大)
- [ ] 规划 warmup 策略 (启动时 or 后台)
- [ ] 监控 GC 指标 (`node --expose-gc`)
- [ ] 压测验证实际命中率

### 🎯 优化建议:
1. **只缓存真正的热点** - 不要贪多，10-30% 就够
2. **监控并调整** - 根据实际命中率动态调整
3. **考虑分层缓存** - 超热数据用本地缓存，温数据用 Redis
4. **定期清理** - 如果内存紧张，可定期 `cache.clear()` 重建

---

**相关文档:**
- [使用指南](./USAGE.md)
- [性能测试](../scripts/bench-4m-evaluation.js)
- [API 文档](../README.md)
