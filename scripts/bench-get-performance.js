#!/usr/bin/env node
/**
 * Benchmark: GET performance comparison
 * Compares single Redis instance with and without client-side caching
 */

const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

// Benchmark configuration
const CONFIG = {
  host: 'localhost',
  port: 6379,
  warmupIterations: 1000,
  benchmarkIterations: 100000,
  rounds: 3,
  keys: ['key1', 'key2', 'key3', 'key4', 'key5'], // Hot keys for cache testing
  payloadSize: 1024, // 1KB payload
};

// Generate test data
const testValue = 'x'.repeat(CONFIG.payloadSize);

// Utility functions
function formatNumber(num) {
  return num.toLocaleString('en-US');
}

function formatDuration(ms) {
  return ms.toFixed(2) + 'ms';
}

function formatOpsPerSec(ops, durationMs) {
  return formatNumber(Math.round((ops / durationMs) * 1000));
}

// Benchmark runner
async function runBenchmark(client, name, iterations) {
  const keys = CONFIG.keys;
  const startTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const key = keys[i % keys.length]; // Rotate through hot keys
    await client.get(key);
  }
  
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  return {
    name,
    iterations,
    duration,
    opsPerSec: (iterations / duration) * 1000,
    avgLatency: duration / iterations,
  };
}

// Setup test data
async function setupTestData(client) {
  console.log('Setting up test data...');
  for (const key of CONFIG.keys) {
    await client.set(key, testValue);
  }
  console.log(`✓ Created ${CONFIG.keys.length} keys with ${CONFIG.payloadSize} byte payload\n`);
}

// Main benchmark
async function main() {
  console.log('='.repeat(70));
  console.log('Redis GET Performance Benchmark');
  console.log('Client-Side Caching vs No Caching');
  console.log('='.repeat(70));
  console.log(`Configuration:`);
  console.log(`  - Rounds: ${CONFIG.rounds}`);
  console.log(`  - Keys: ${CONFIG.keys.length} hot keys`);
  console.log(`  - Payload size: ${CONFIG.payloadSize} bytes`);
  console.log(`  - Warmup iterations: ${formatNumber(CONFIG.warmupIterations)}`);
  console.log(`  - Benchmark iterations: ${formatNumber(CONFIG.benchmarkIterations)} per round`);
  console.log('='.repeat(70));
  console.log();

  // ===== WITHOUT Client-Side Caching =====
  console.log('[ 1/2 ] Benchmarking WITHOUT client-side caching...');
  const clientNoCache = redis.createClient({
    socket: { host: CONFIG.host, port: CONFIG.port },
  });
  
  await clientNoCache.connect();
  await setupTestData(clientNoCache);
  
  // Warmup
  console.log(`  Warming up (${formatNumber(CONFIG.warmupIterations)} iterations)...`);
  await runBenchmark(clientNoCache, 'No Cache Warmup', CONFIG.warmupIterations);
  
  // Run multiple rounds
  const resultsNoCache = [];
  for (let round = 1; round <= CONFIG.rounds; round++) {
    console.log(`  Round ${round}/${CONFIG.rounds}: Running benchmark (${formatNumber(CONFIG.benchmarkIterations)} iterations)...`);
    const result = await runBenchmark(clientNoCache, `No Cache Round ${round}`, CONFIG.benchmarkIterations);
    resultsNoCache.push(result);
    console.log(`    -> ${formatOpsPerSec(result.iterations, result.duration)} ops/s, ${result.avgLatency.toFixed(3)}ms avg latency`);
  }
  
  await clientNoCache.quit();
  console.log('  ✓ Complete\n');

  // ===== WITH Client-Side Caching =====
  console.log('[ 2/2 ] Benchmarking WITH client-side caching...');
  const cache = new SimpleClientSideCache();
  const clientWithCache = redis.createClient({
    socket: { host: CONFIG.host, port: CONFIG.port },
    RESP: 3,
    clientSideCache: cache,
  });
  
  await clientWithCache.connect();
  await setupTestData(clientWithCache);
  
  // Warmup (populates cache)
  console.log(`  Warming up (${formatNumber(CONFIG.warmupIterations)} iterations)...`);
  await runBenchmark(clientWithCache, 'With Cache Warmup', CONFIG.warmupIterations);
  console.log(`  Cache populated: ${cache.size()} entries`);
  
  // Run multiple rounds
  const resultsWithCache = [];
  for (let round = 1; round <= CONFIG.rounds; round++) {
    console.log(`  Round ${round}/${CONFIG.rounds}: Running benchmark (${formatNumber(CONFIG.benchmarkIterations)} iterations)...`);
    const result = await runBenchmark(clientWithCache, `With Cache Round ${round}`, CONFIG.benchmarkIterations);
    resultsWithCache.push(result);
    console.log(`    -> ${formatOpsPerSec(result.iterations, result.duration)} ops/s, ${result.avgLatency.toFixed(3)}ms avg latency`);
  }
  
  await clientWithCache.quit();
  console.log('  ✓ Complete\n');

  // ===== Results =====
  console.log('='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log();
  
  // Calculate averages
  const avgNoCache = {
    duration: resultsNoCache.reduce((sum, r) => sum + r.duration, 0) / resultsNoCache.length,
    opsPerSec: resultsNoCache.reduce((sum, r) => sum + r.opsPerSec, 0) / resultsNoCache.length,
    avgLatency: resultsNoCache.reduce((sum, r) => sum + r.avgLatency, 0) / resultsNoCache.length,
  };
  
  const avgWithCache = {
    duration: resultsWithCache.reduce((sum, r) => sum + r.duration, 0) / resultsWithCache.length,
    opsPerSec: resultsWithCache.reduce((sum, r) => sum + r.opsPerSec, 0) / resultsWithCache.length,
    avgLatency: resultsWithCache.reduce((sum, r) => sum + r.avgLatency, 0) / resultsWithCache.length,
  };
  
  console.log(`WITHOUT Client-Side Caching (${CONFIG.rounds} rounds average):`);
  console.log(`  Avg time:        ${formatDuration(avgNoCache.duration)}`);
  console.log(`  Avg ops/sec:     ${formatOpsPerSec(CONFIG.benchmarkIterations, avgNoCache.duration)} ops/s`);
  console.log(`  Avg latency:     ${avgNoCache.avgLatency.toFixed(3)}ms`);
  console.log();
  
  console.log(`WITH Client-Side Caching (${CONFIG.rounds} rounds average):`);
  console.log(`  Avg time:        ${formatDuration(avgWithCache.duration)}`);
  console.log(`  Avg ops/sec:     ${formatOpsPerSec(CONFIG.benchmarkIterations, avgWithCache.duration)} ops/s`);
  console.log(`  Avg latency:     ${avgWithCache.avgLatency.toFixed(3)}ms`);
  console.log(`  Cache size:      ${cache.size()} entries`);
  console.log();
  
  // Calculate improvement
  const speedup = avgWithCache.opsPerSec / avgNoCache.opsPerSec;
  const latencyImprovement = ((avgNoCache.avgLatency - avgWithCache.avgLatency) / avgNoCache.avgLatency) * 100;
  
  console.log('PERFORMANCE IMPROVEMENT:');
  console.log(`  Speedup:         ${speedup.toFixed(2)}x faster`);
  console.log(`  Latency reduced: ${latencyImprovement.toFixed(1)}%`);
  console.log(`  Time saved:      ${formatDuration(avgNoCache.duration - avgWithCache.duration)} per round`);
  console.log();
  
  // Show all rounds
  console.log('DETAILED RESULTS BY ROUND:');
  console.log();
  console.log('Without Cache:');
  resultsNoCache.forEach((r, i) => {
    console.log(`  Round ${i + 1}: ${formatOpsPerSec(r.iterations, r.duration)} ops/s, ${r.avgLatency.toFixed(3)}ms latency, ${formatDuration(r.duration)} total`);
  });
  console.log();
  console.log('With Cache:');
  resultsWithCache.forEach((r, i) => {
    console.log(`  Round ${i + 1}: ${formatOpsPerSec(r.iterations, r.duration)} ops/s, ${r.avgLatency.toFixed(3)}ms latency, ${formatDuration(r.duration)} total`);
  });
  console.log();
  console.log('='.repeat(70));
}

// Run benchmark
main().catch(console.error);
