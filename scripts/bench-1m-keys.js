const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

const REDIS_PORT = 16379;
const TOTAL_KEYS = 1000000;
const OPERATIONS = 100000;

async function setupKeys(client) {
  console.log(`\n[Setup] Preparing ${TOTAL_KEYS.toLocaleString()} keys...`);
  const startTime = Date.now();
  
  const batchSize = 10000;
  for (let i = 0; i < TOTAL_KEYS; i += batchSize) {
    const pipeline = client.multi();
    for (let j = 0; j < batchSize && (i + j) < TOTAL_KEYS; j++) {
      pipeline.set(`key:${i + j}`, `value:${i + j}`);
    }
    await pipeline.exec();
    
    if ((i + batchSize) % 100000 === 0) {
      process.stdout.write(`\r[Setup] Progress: ${((i + batchSize) / TOTAL_KEYS * 100).toFixed(1)}%`);
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`\n[Setup] Completed in ${(duration / 1000).toFixed(2)}s`);
}

async function benchmarkWithCache() {
  console.log('\n=== Benchmark: WITH Client-Side Cache ===');
  
  const cache = new SimpleClientSideCache();
  const client = redis.createClient({
    socket: { host: 'localhost', port: REDIS_PORT },
    RESP: 3,
    clientSideCache: cache
  });
  
  await client.connect();
  
  // Warm-up phase
  console.log('[Warmup] Running 10k operations...');
  for (let i = 0; i < 10000; i++) {
    const keyId = Math.floor(Math.random() * TOTAL_KEYS);
    await client.get(`key:${keyId}`);
  }
  console.log(`[Warmup] Cache size: ${cache.size()}`);
  
  // Benchmark phase
  console.log(`[Benchmark] Running ${OPERATIONS.toLocaleString()} GET operations...`);
  const startTime = Date.now();
  
  for (let i = 0; i < OPERATIONS; i++) {
    const keyId = Math.floor(Math.random() * TOTAL_KEYS);
    await client.get(`key:${keyId}`);
    
    if ((i + 1) % 10000 === 0) {
      process.stdout.write(`\r[Benchmark] Progress: ${((i + 1) / OPERATIONS * 100).toFixed(1)}%`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = (OPERATIONS / duration * 1000).toFixed(0);
  
  console.log(`\n[Results] Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`[Results] Throughput: ${Number(opsPerSec).toLocaleString()} ops/sec`);
  console.log(`[Results] Cache size: ${cache.size().toLocaleString()}`);
  console.log(`[Results] Avg latency: ${(duration / OPERATIONS).toFixed(2)}ms`);
  
  await client.quit();
  
  return { duration, opsPerSec: Number(opsPerSec) };
}

async function benchmarkWithoutCache() {
  console.log('\n=== Benchmark: WITHOUT Client-Side Cache ===');
  
  const client = redis.createClient({
    socket: { host: 'localhost', port: REDIS_PORT },
    RESP: 3
  });
  
  await client.connect();
  
  console.log(`[Benchmark] Running ${OPERATIONS.toLocaleString()} GET operations...`);
  const startTime = Date.now();
  
  for (let i = 0; i < OPERATIONS; i++) {
    const keyId = Math.floor(Math.random() * TOTAL_KEYS);
    await client.get(`key:${keyId}`);
    
    if ((i + 1) % 10000 === 0) {
      process.stdout.write(`\r[Benchmark] Progress: ${((i + 1) / OPERATIONS * 100).toFixed(1)}%`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = (OPERATIONS / duration * 1000).toFixed(0);
  
  console.log(`\n[Results] Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`[Results] Throughput: ${Number(opsPerSec).toLocaleString()} ops/sec`);
  console.log(`[Results] Avg latency: ${(duration / OPERATIONS).toFixed(2)}ms`);
  
  await client.quit();
  
  return { duration, opsPerSec: Number(opsPerSec) };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Redis Client-Side Cache Benchmark - 1M Keys      ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`Total Keys: ${TOTAL_KEYS.toLocaleString()}`);
  console.log(`Operations: ${OPERATIONS.toLocaleString()}`);
  console.log(`Redis Port: ${REDIS_PORT}`);
  
  // Setup keys
  const setupClient = redis.createClient({
    socket: { host: 'localhost', port: REDIS_PORT },
    RESP: 3
  });
  await setupClient.connect();
  await setupKeys(setupClient);
  await setupClient.quit();
  
  // Run benchmarks
  const withoutCacheResult = await benchmarkWithoutCache();
  const withCacheResult = await benchmarkWithCache();
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║                    SUMMARY                         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`WITHOUT Cache: ${withoutCacheResult.opsPerSec.toLocaleString()} ops/sec`);
  console.log(`WITH Cache:    ${withCacheResult.opsPerSec.toLocaleString()} ops/sec`);
  
  const speedup = (withCacheResult.opsPerSec / withoutCacheResult.opsPerSec).toFixed(2);
  console.log(`\nSpeedup: ${speedup}x faster with client-side cache`);
  
  const improvement = ((withCacheResult.opsPerSec - withoutCacheResult.opsPerSec) / withoutCacheResult.opsPerSec * 100).toFixed(1);
  console.log(`Improvement: ${improvement}% performance gain`);
}

main().catch(console.error);
