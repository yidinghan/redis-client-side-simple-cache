#!/usr/bin/env node

/**
 * 4M Keys Evaluation Script
 * 评估 SimpleClientSideCache 在 400 万 key 场景下的表现
 * 
 * 测试维度:
 * 1. 内存使用量 - 不同缓存命中率下的内存占用
 * 2. 性能影响 - GET/SET 操作的延迟和吞吐量
 * 3. 失效处理 - 大批量失效时的性能
 * 4. GC 压力 - 垃圾回收影响
 */

const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

// ==================== 配置 ====================
const CONFIG = {
  REDIS_PORT: 16379,
  REDIS_HOST: 'localhost',
  
  // Redis 总 key 数量
  TOTAL_REDIS_KEYS: 4_000_000,
  
  // 测试场景
  SCENARIOS: [
    { name: '10% Cache Hit', cacheRatio: 0.1, operations: 100_000 },
    { name: '30% Cache Hit', cacheRatio: 0.3, operations: 100_000 },
    { name: '50% Cache Hit', cacheRatio: 0.5, operations: 100_000 },
    { name: '80% Cache Hit', cacheRatio: 0.8, operations: 100_000 },
  ],
  
  // Key/Value 设置
  VALUE_SIZE: 100, // bytes
  SETUP_BATCH_SIZE: 10_000,
};

// ==================== 工具函数 ====================

/**
 * 格式化内存大小
 */
function formatMemory(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 获取当前进程内存使用情况
 */
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  };
}

/**
 * 计算内存增量
 */
function calculateMemoryDelta(before, after) {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
  };
}

/**
 * 打印内存使用情况
 */
function printMemoryUsage(label, usage) {
  console.log(`\n${label}:`);
  console.log(`  RSS:          ${formatMemory(usage.rss)}`);
  console.log(`  Heap Total:   ${formatMemory(usage.heapTotal)}`);
  console.log(`  Heap Used:    ${formatMemory(usage.heapUsed)}`);
  console.log(`  External:     ${formatMemory(usage.external)}`);
}

/**
 * 生成随机字符串
 */
function randomString(length) {
  return 'x'.repeat(length);
}

/**
 * 强制执行 GC (需要 --expose-gc)
 */
function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

// ==================== Redis 数据准备 ====================

/**
 * 批量设置 Redis keys
 */
async function setupRedisKeys(client, totalKeys) {
  console.log(`\n[Setup] 准备 ${totalKeys.toLocaleString()} 个 Redis keys...`);
  console.log(`[Setup] Value 大小: ${CONFIG.VALUE_SIZE} bytes`);
  
  const startTime = Date.now();
  const value = randomString(CONFIG.VALUE_SIZE);
  
  let completed = 0;
  
  for (let i = 0; i < totalKeys; i += CONFIG.SETUP_BATCH_SIZE) {
    const pipeline = client.multi();
    const batchEnd = Math.min(i + CONFIG.SETUP_BATCH_SIZE, totalKeys);
    
    for (let j = i; j < batchEnd; j++) {
      pipeline.set(`key:${j}`, value);
    }
    
    await pipeline.exec();
    completed = batchEnd;
    
    if (completed % 100_000 === 0 || completed === totalKeys) {
      const progress = (completed / totalKeys * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`\r[Setup] 进度: ${progress}% (${completed.toLocaleString()}/${totalKeys.toLocaleString()}) - ${elapsed}s`);
    }
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n[Setup] 完成! 耗时: ${duration.toFixed(2)}s`);
  console.log(`[Setup] 写入速率: ${(totalKeys / duration).toFixed(0)} keys/sec`);
}

// ==================== 基准测试 ====================

/**
 * 测试场景: 无缓存
 */
async function benchmarkNoCache(totalKeys, operations) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 基准测试: 无客户端缓存');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  forceGC();
  const memBefore = getMemoryUsage();
  
  const client = redis.createClient({
    socket: { host: CONFIG.REDIS_HOST, port: CONFIG.REDIS_PORT },
  });
  
  await client.connect();
  
  console.log(`\n[Benchmark] 执行 ${operations.toLocaleString()} 次随机 GET 操作...`);
  const startTime = Date.now();
  const latencies = [];
  
  for (let i = 0; i < operations; i++) {
    const keyId = Math.floor(Math.random() * totalKeys);
    const opStart = process.hrtime.bigint();
    await client.get(`key:${keyId}`);
    const opEnd = process.hrtime.bigint();
    latencies.push(Number(opEnd - opStart) / 1e6);
    
    if ((i + 1) % 10_000 === 0) {
      process.stdout.write(`\r[Benchmark] 进度: ${((i + 1) / operations * 100).toFixed(1)}%`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = Math.floor(operations / duration * 1000);
  
  await client.quit();
  
  forceGC();
  const memAfter = getMemoryUsage();
  const memDelta = calculateMemoryDelta(memBefore, memAfter);
  
  // 计算延迟统计
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  console.log('\n\n[结果]');
  console.log(`  总耗时:       ${(duration / 1000).toFixed(2)}s`);
  console.log(`  吞吐量:       ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`  平均延迟:     ${avg.toFixed(3)}ms`);
  console.log(`  P50 延迟:     ${p50.toFixed(3)}ms`);
  console.log(`  P95 延迟:     ${p95.toFixed(3)}ms`);
  console.log(`  P99 延迟:     ${p99.toFixed(3)}ms`);
  
  printMemoryUsage('[内存增量]', memDelta);
  
  return {
    duration,
    opsPerSec,
    latency: { avg, p50, p95, p99 },
    memory: memDelta
  };
}

/**
 * 测试场景: 有缓存
 */
async function benchmarkWithCache(totalKeys, operations, cacheRatio, scenarioName) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 测试场景: ${scenarioName}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  forceGC();
  const memBefore = getMemoryUsage();
  
  const cache = new SimpleClientSideCache({ enableStat: true });
  const client = redis.createClient({
    socket: { host: CONFIG.REDIS_HOST, port: CONFIG.REDIS_PORT },
    RESP: 3,
    clientSideCache: cache
  });
  
  await client.connect();
  
  // Warmup: 根据 cacheRatio 预热缓存
  const hotKeyCount = Math.floor(totalKeys * cacheRatio);
  console.log(`\n[Warmup] 预热 ${hotKeyCount.toLocaleString()} 个热点 keys (${(cacheRatio * 100).toFixed(0)}%)...`);
  
  const warmupStart = Date.now();
  for (let i = 0; i < hotKeyCount; i++) {
    await client.get(`key:${i}`);
    
    if ((i + 1) % 10_000 === 0 || i === hotKeyCount - 1) {
      process.stdout.write(`\r[Warmup] 进度: ${((i + 1) / hotKeyCount * 100).toFixed(1)}%`);
    }
  }
  const warmupDuration = (Date.now() - warmupStart) / 1000;
  
  forceGC();
  const memAfterWarmup = getMemoryUsage();
  const warmupMemDelta = calculateMemoryDelta(memBefore, memAfterWarmup);
  
  console.log(`\n[Warmup] 完成! 耗时: ${warmupDuration.toFixed(2)}s`);
  console.log(`[Warmup] 缓存大小: ${cache.size().toLocaleString()} entries`);
  printMemoryUsage('[Warmup 内存增量]', warmupMemDelta);
  
  // 估算单个缓存条目的平均内存占用
  const avgMemoryPerEntry = warmupMemDelta.heapUsed / cache.size();
  console.log(`\n[估算] 单条目平均内存: ${formatMemory(avgMemoryPerEntry)}`);
  console.log(`[估算] ${totalKeys.toLocaleString()} 条目总内存: ${formatMemory(avgMemoryPerEntry * totalKeys)}`);
  
  // Benchmark: 随机访问热点 keys
  console.log(`\n[Benchmark] 执行 ${operations.toLocaleString()} 次随机 GET 操作 (聚焦热点)...`);
  const startTime = Date.now();
  const latencies = [];
  
  for (let i = 0; i < operations; i++) {
    // 80% 访问热点, 20% 访问冷数据
    const keyId = Math.random() < 0.8 
      ? Math.floor(Math.random() * hotKeyCount)
      : hotKeyCount + Math.floor(Math.random() * (totalKeys - hotKeyCount));
    
    const opStart = process.hrtime.bigint();
    await client.get(`key:${keyId}`);
    const opEnd = process.hrtime.bigint();
    latencies.push(Number(opEnd - opStart) / 1e6);
    
    if ((i + 1) % 10_000 === 0) {
      process.stdout.write(`\r[Benchmark] 进度: ${((i + 1) / operations * 100).toFixed(1)}%`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = Math.floor(operations / duration * 1000);
  
  const stats = cache.stats();
  
  await client.quit();
  
  forceGC();
  const memAfter = getMemoryUsage();
  const totalMemDelta = calculateMemoryDelta(memBefore, memAfter);
  
  // 计算延迟统计
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  const hitRate = (stats.hitCount / (stats.hitCount + stats.missCount) * 100).toFixed(1);
  
  console.log('\n\n[结果]');
  console.log(`  总耗时:       ${(duration / 1000).toFixed(2)}s`);
  console.log(`  吞吐量:       ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`  平均延迟:     ${avg.toFixed(3)}ms`);
  console.log(`  P50 延迟:     ${p50.toFixed(3)}ms`);
  console.log(`  P95 延迟:     ${p95.toFixed(3)}ms`);
  console.log(`  P99 延迟:     ${p99.toFixed(3)}ms`);
  
  console.log('\n[缓存统计]');
  console.log(`  缓存大小:     ${cache.size().toLocaleString()} entries`);
  console.log(`  命中次数:     ${stats.hitCount.toLocaleString()}`);
  console.log(`  未命中次数:   ${stats.missCount.toLocaleString()}`);
  console.log(`  命中率:       ${hitRate}%`);
  console.log(`  失效次数:     ${stats.evictionCount.toLocaleString()}`);
  
  printMemoryUsage('[总内存增量]', totalMemDelta);
  
  return {
    duration,
    opsPerSec,
    latency: { avg, p50, p95, p99 },
    cache: {
      size: cache.size(),
      hitRate: parseFloat(hitRate),
      stats
    },
    memory: totalMemDelta,
    warmupMemory: warmupMemDelta,
    avgMemoryPerEntry
  };
}

/**
 * 测试大批量失效性能
 */
async function benchmarkInvalidation(totalKeys) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 失效性能测试');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const cache = new SimpleClientSideCache({ enableStat: true });
  const client = redis.createClient({
    socket: { host: CONFIG.REDIS_HOST, port: CONFIG.REDIS_PORT },
    RESP: 3,
    clientSideCache: cache
  });
  
  await client.connect();
  
  // 预热 10% 的 keys
  const warmupCount = Math.floor(totalKeys * 0.1);
  console.log(`\n[Setup] 预热 ${warmupCount.toLocaleString()} 个 keys...`);
  
  for (let i = 0; i < warmupCount; i++) {
    await client.get(`key:${i}`);
    if ((i + 1) % 10_000 === 0 || i === warmupCount - 1) {
      process.stdout.write(`\r[Setup] 进度: ${((i + 1) / warmupCount * 100).toFixed(1)}%`);
    }
  }
  
  console.log(`\n[Setup] 缓存大小: ${cache.size().toLocaleString()} entries`);
  
  // 测试批量失效
  const invalidateCount = Math.min(10_000, warmupCount);
  console.log(`\n[Test] 批量失效 ${invalidateCount.toLocaleString()} 个 keys...`);
  
  const startTime = process.hrtime.bigint();
  
  const pipeline = client.multi();
  for (let i = 0; i < invalidateCount; i++) {
    pipeline.set(`key:${i}`, `updated:${i}`);
  }
  await pipeline.exec();
  
  // 等待失效通知处理完成
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const endTime = process.hrtime.bigint();
  const duration = Number(endTime - startTime) / 1e6;
  
  const stats = cache.stats();
  
  console.log('\n[结果]');
  console.log(`  失效处理耗时: ${duration.toFixed(2)}ms`);
  console.log(`  平均每个:     ${(duration / invalidateCount).toFixed(3)}ms`);
  console.log(`  失效后大小:   ${cache.size().toLocaleString()} entries`);
  console.log(`  总失效次数:   ${stats.evictionCount.toLocaleString()}`);
  
  await client.quit();
  
  return {
    invalidateCount,
    duration,
    avgPerKey: duration / invalidateCount,
    evictionCount: stats.evictionCount
  };
}

// ==================== 主函数 ====================

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SimpleClientSideCache - 400万 Key 压力评估              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n配置:`);
  console.log(`  Redis Keys:   ${CONFIG.TOTAL_REDIS_KEYS.toLocaleString()}`);
  console.log(`  Value 大小:   ${CONFIG.VALUE_SIZE} bytes`);
  console.log(`  Redis 地址:   ${CONFIG.REDIS_HOST}:${CONFIG.REDIS_PORT}`);
  console.log(`  Node 版本:    ${process.version}`);
  console.log(`  启动参数:     ${process.execArgv.join(' ') || '(none)'}`);
  
  if (!global.gc) {
    console.log('\n⚠️  警告: 未启用 --expose-gc, GC 控制将被忽略');
    console.log('   建议使用: node --expose-gc scripts/bench-4m-evaluation.js');
  }
  
  // Step 1: 准备 Redis 数据
  console.log('\n\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ Step 1: 准备 Redis 数据                                      │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  
  const setupClient = redis.createClient({
    socket: { host: CONFIG.REDIS_HOST, port: CONFIG.REDIS_PORT },
  });
  await setupClient.connect();
  await setupRedisKeys(setupClient, CONFIG.TOTAL_REDIS_KEYS);
  await setupClient.quit();
  
  // Step 2: 无缓存基准测试
  console.log('\n\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ Step 2: 无缓存基准测试                                        │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  
  const noCacheResult = await benchmarkNoCache(
    CONFIG.TOTAL_REDIS_KEYS,
    CONFIG.SCENARIOS[0].operations
  );
  
  // Step 3: 不同缓存命中率场景测试
  console.log('\n\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ Step 3: 缓存性能测试 (多场景)                                 │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  
  const cacheResults = [];
  for (const scenario of CONFIG.SCENARIOS) {
    const result = await benchmarkWithCache(
      CONFIG.TOTAL_REDIS_KEYS,
      scenario.operations,
      scenario.cacheRatio,
      scenario.name
    );
    cacheResults.push({ ...scenario, ...result });
    
    // 场景间等待，让 GC 回收
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Step 4: 失效性能测试
  console.log('\n\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ Step 4: 失效性能测试                                          │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  
  const invalidationResult = await benchmarkInvalidation(CONFIG.TOTAL_REDIS_KEYS);
  
  // ==================== 汇总报告 ====================
  
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                        📊 汇总报告                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1️⃣  性能对比 (吞吐量)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  无缓存基准:   ${noCacheResult.opsPerSec.toLocaleString()} ops/sec`);
  
  for (const result of cacheResults) {
    const speedup = (result.opsPerSec / noCacheResult.opsPerSec).toFixed(2);
    const improvement = ((result.opsPerSec - noCacheResult.opsPerSec) / noCacheResult.opsPerSec * 100).toFixed(1);
    console.log(`  ${result.name.padEnd(16)}: ${result.opsPerSec.toLocaleString().padStart(7)} ops/sec (${speedup}x, +${improvement}%)`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2️⃣  延迟对比 (P95)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  无缓存基准:   ${noCacheResult.latency.p95.toFixed(3)}ms`);
  
  for (const result of cacheResults) {
    const reduction = ((noCacheResult.latency.p95 - result.latency.p95) / noCacheResult.latency.p95 * 100).toFixed(1);
    console.log(`  ${result.name.padEnd(16)}: ${result.latency.p95.toFixed(3)}ms (-${reduction}%)`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3️⃣  内存使用分析');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  for (const result of cacheResults) {
    console.log(`\n  ${result.name}:`);
    console.log(`    缓存条目数:       ${result.cache.size.toLocaleString()}`);
    console.log(`    总内存增量:       ${formatMemory(result.warmupMemory.heapUsed)}`);
    console.log(`    单条目平均:       ${formatMemory(result.avgMemoryPerEntry)}`);
    
    const projected4M = result.avgMemoryPerEntry * CONFIG.TOTAL_REDIS_KEYS;
    console.log(`    预估 400万条目:   ${formatMemory(projected4M)}`);
    
    const canHandle = projected4M < 8 * 1024 * 1024 * 1024; // 8GB
    console.log(`    可行性评估:       ${canHandle ? '✅ 可行 (< 8GB)' : '⚠️  需要大内存'}`);
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4️⃣  失效性能');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  批量失效数量:     ${invalidationResult.invalidateCount.toLocaleString()}`);
  console.log(`  总耗时:           ${invalidationResult.duration.toFixed(2)}ms`);
  console.log(`  单个平均:         ${invalidationResult.avgPerKey.toFixed(4)}ms`);
  console.log(`  处理能力:         ${(invalidationResult.invalidateCount / invalidationResult.duration * 1000).toFixed(0)} invalidations/sec`);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('5️⃣  综合评估');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const bestResult = cacheResults.reduce((best, curr) => 
    curr.cache.hitRate > best.cache.hitRate ? curr : best
  );
  
  const avgMemPerEntry = cacheResults.reduce((sum, r) => sum + r.avgMemoryPerEntry, 0) / cacheResults.length;
  const projected4M = avgMemPerEntry * CONFIG.TOTAL_REDIS_KEYS;
  
  console.log(`\n  ✨ 最佳场景: ${bestResult.name}`);
  console.log(`     - 吞吐量提升: ${((bestResult.opsPerSec / noCacheResult.opsPerSec - 1) * 100).toFixed(1)}%`);
  console.log(`     - 延迟降低:   ${((1 - bestResult.latency.p95 / noCacheResult.latency.p95) * 100).toFixed(1)}%`);
  console.log(`     - 命中率:     ${bestResult.cache.hitRate}%`);
  
  console.log(`\n  💾 内存评估 (400万条目):`);
  console.log(`     - 预估内存:   ${formatMemory(projected4M)}`);
  console.log(`     - 单条目:     ${formatMemory(avgMemPerEntry)}`);
  
  if (projected4M < 2 * 1024 * 1024 * 1024) {
    console.log(`     - 评级:       ✅ 优秀 (< 2GB)`);
  } else if (projected4M < 4 * 1024 * 1024 * 1024) {
    console.log(`     - 评级:       ✅ 良好 (< 4GB)`);
  } else if (projected4M < 8 * 1024 * 1024 * 1024) {
    console.log(`     - 评级:       ⚠️  可接受 (< 8GB)`);
  } else {
    console.log(`     - 评级:       ❌ 内存压力大 (> 8GB)`);
  }
  
  console.log(`\n  🎯 推荐场景:`);
  console.log(`     - 读写比例:   10:1 或更高`);
  console.log(`     - 热点数据:   ${(CONFIG.TOTAL_REDIS_KEYS * 0.1).toLocaleString()} - ${(CONFIG.TOTAL_REDIS_KEYS * 0.3).toLocaleString()} keys`);
  console.log(`     - 内存预留:   ${formatMemory(projected4M * 0.3)} (建议)`);
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // 保存结果到文件
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
  const resultFile = `scripts/bench-4m-results-${timestamp}.json`;
  
  const fullResults = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    nodeVersion: process.version,
    noCache: noCacheResult,
    withCache: cacheResults,
    invalidation: invalidationResult,
    summary: {
      avgMemoryPerEntry: avgMemPerEntry,
      projected4M: projected4M,
      projected4MFormatted: formatMemory(projected4M),
      bestScenario: bestResult.name,
      maxSpeedup: Math.max(...cacheResults.map(r => r.opsPerSec / noCacheResult.opsPerSec))
    }
  };
  
  const fs = require('fs');
  fs.writeFileSync(resultFile, JSON.stringify(fullResults, null, 2));
  console.log(`\n📄 详细结果已保存到: ${resultFile}\n`);
}

// ==================== 执行 ====================

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ 错误:', error);
    process.exit(1);
  });
}

module.exports = { main };
