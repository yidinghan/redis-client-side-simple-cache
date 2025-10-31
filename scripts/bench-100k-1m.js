const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

const REDIS_PORT = process.env.REDIS_PORT || 6379;
const TOTAL_KEYS = 100_000;
const OPERATIONS = 1_000_000;
const READ_RATIO = 0.9; // 90% reads, 10% writes

async function setupKeys(client) {
  console.log(`\n[Setup] Preparing ${TOTAL_KEYS.toLocaleString()} keys...`);
  const startTime = Date.now();
  
  const batchSize = 5000;
  for (let i = 0; i < TOTAL_KEYS; i += batchSize) {
    const pipeline = client.multi();
    for (let j = 0; j < batchSize && (i + j) < TOTAL_KEYS; j++) {
      pipeline.set(`key:${i + j}`, `value:${i + j}`);
    }
    await pipeline.exec();
    
    if ((i + batchSize) % 20000 === 0 || (i + batchSize) >= TOTAL_KEYS) {
      process.stdout.write(`\r[Setup] Progress: ${Math.min((i + batchSize), TOTAL_KEYS).toLocaleString()} / ${TOTAL_KEYS.toLocaleString()}`);
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`\n[Setup] Completed in ${(duration / 1000).toFixed(2)}s (${Math.round(TOTAL_KEYS / (duration / 1000)).toLocaleString()} keys/sec)`);
}

async function benchmarkWithCache() {
  console.log('\n=== Benchmark: WITH Client-Side Cache ===');
  
  const cache = new SimpleClientSideCache();
  let invalidations = 0;
  cache.on('invalidate', () => invalidations++);
  
  const client = redis.createClient({
    socket: { host: 'localhost', port: REDIS_PORT },
    RESP: 3,
    clientSideCache: cache
  });
  
  await client.connect();
  await client.flushDb();
  await setupKeys(client);
  
  // Warm-up phase
  console.log('\n[Warmup] Reading all keys once...');
  const warmupStart = Date.now();
  for (let i = 0; i < TOTAL_KEYS; i++) {
    await client.get(`key:${i}`);
    if ((i + 1) % 20000 === 0 || (i + 1) === TOTAL_KEYS) {
      process.stdout.write(`\r[Warmup] Progress: ${(i + 1).toLocaleString()} / ${TOTAL_KEYS.toLocaleString()}`);
    }
  }
  const warmupDuration = Date.now() - warmupStart;
  console.log(`\n[Warmup] Completed in ${(warmupDuration / 1000).toFixed(2)}s, Cache size: ${cache.size().toLocaleString()}`);
  
  // Benchmark phase
  console.log(`\n[Benchmark] Running ${OPERATIONS.toLocaleString()} operations (${(READ_RATIO * 100)}% reads, ${((1 - READ_RATIO) * 100)}% writes)...`);
  const startTime = Date.now();
  
  let reads = 0;
  let writes = 0;
  
  for (let i = 0; i < OPERATIONS; i++) {
    const keyId = Math.floor(Math.random() * TOTAL_KEYS);
    const isRead = Math.random() < READ_RATIO;
    
    if (isRead) {
      await client.get(`key:${keyId}`);
      reads++;
    } else {
      await client.set(`key:${keyId}`, `updated:${i}`);
      writes++;
    }
    
    if ((i + 1) % 100000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const opsPerSec = Math.round((i + 1) / elapsed).toLocaleString();
      process.stdout.write(`\r[Benchmark] Progress: ${(i + 1).toLocaleString()} / ${OPERATIONS.toLocaleString()} (${opsPerSec} ops/sec)`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = Math.round(OPERATIONS / (duration / 1000));
  
  console.log(`\n[Results] Completed in ${(duration / 1000).toFixed(2)}s`);
  console.log(`[Results] Throughput: ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`[Results] Reads: ${reads.toLocaleString()}, Writes: ${writes.toLocaleString()}`);
  console.log(`[Results] Cache size: ${cache.size().toLocaleString()}`);
  console.log(`[Results] Invalidations: ${invalidations.toLocaleString()}`);
  
  await client.disconnect();
  
  return { duration, opsPerSec, cacheSize: cache.size(), invalidations };
}

async function benchmarkWithoutCache() {
  console.log('\n=== Benchmark: WITHOUT Client-Side Cache ===');
  
  const client = redis.createClient({
    socket: { host: 'localhost', port: REDIS_PORT }
  });
  
  await client.connect();
  await client.flushDb();
  await setupKeys(client);
  
  // Benchmark phase
  console.log(`\n[Benchmark] Running ${OPERATIONS.toLocaleString()} operations (${(READ_RATIO * 100)}% reads, ${((1 - READ_RATIO) * 100)}% writes)...`);
  const startTime = Date.now();
  
  let reads = 0;
  let writes = 0;
  
  for (let i = 0; i < OPERATIONS; i++) {
    const keyId = Math.floor(Math.random() * TOTAL_KEYS);
    const isRead = Math.random() < READ_RATIO;
    
    if (isRead) {
      await client.get(`key:${keyId}`);
      reads++;
    } else {
      await client.set(`key:${keyId}`, `updated:${i}`);
      writes++;
    }
    
    if ((i + 1) % 100000 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const opsPerSec = Math.round((i + 1) / elapsed).toLocaleString();
      process.stdout.write(`\r[Benchmark] Progress: ${(i + 1).toLocaleString()} / ${OPERATIONS.toLocaleString()} (${opsPerSec} ops/sec)`);
    }
  }
  
  const duration = Date.now() - startTime;
  const opsPerSec = Math.round(OPERATIONS / (duration / 1000));
  
  console.log(`\n[Results] Completed in ${(duration / 1000).toFixed(2)}s`);
  console.log(`[Results] Throughput: ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`[Results] Reads: ${reads.toLocaleString()}, Writes: ${writes.toLocaleString()}`);
  
  await client.disconnect();
  
  return { duration, opsPerSec };
}

async function main() {
  console.log('Redis Client-Side Cache Benchmark - 100K Keys, 1M Operations');
  console.log('===========================================================');
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Total Keys: ${TOTAL_KEYS.toLocaleString()}`);
  console.log(`Operations: ${OPERATIONS.toLocaleString()}`);
  console.log(`Read/Write Ratio: ${(READ_RATIO * 100)}% / ${((1 - READ_RATIO) * 100)}%`);
  
  const withoutCache = await benchmarkWithoutCache();
  const withCache = await benchmarkWithCache();
  
  console.log('\n=== Summary ===');
  console.log(`WITHOUT Cache: ${withoutCache.opsPerSec.toLocaleString()} ops/sec (${(withoutCache.duration / 1000).toFixed(2)}s)`);
  console.log(`WITH Cache:    ${withCache.opsPerSec.toLocaleString()} ops/sec (${(withCache.duration / 1000).toFixed(2)}s)`);
  console.log(`Cache Size:    ${withCache.cacheSize.toLocaleString()} keys`);
  console.log(`Invalidations: ${withCache.invalidations.toLocaleString()}`);
  console.log(`\nSpeedup:       ${(withCache.opsPerSec / withoutCache.opsPerSec).toFixed(2)}x`);
  console.log(`Improvement:   ${((withCache.opsPerSec - withoutCache.opsPerSec) / withoutCache.opsPerSec * 100).toFixed(1)}%`);
  
  const memUsage = process.memoryUsage();
  console.log(`\nMemory: RSS ${(memUsage.rss / 1024 / 1024).toFixed(0)}MB, Heap ${(memUsage.heapUsed / 1024 / 1024).toFixed(0)}MB`);
}

main().catch(console.error);
