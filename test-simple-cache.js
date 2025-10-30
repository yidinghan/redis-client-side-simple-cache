#!/usr/bin/env node

const redis = require('redis');
const { SimpleClientSideCache } = require('./src/simple-cache');

async function test() {
  console.log('=== Simple Client-Side Cache Test ===\n');

  const cache = new SimpleClientSideCache();

  const worker = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  try {
    await worker.connect();
    await master.connect();
    console.log('✅ Connected\n');

    cache.on('invalidate', (key) => {
      console.log(`🔔 Invalidated: ${key}`);
    });

    // Step 1: Master writes data
    console.log('--- Step 1: Master writes ---');
    await master.set('test:1', 'value1');
    await master.set('test:2', 'value2');
    console.log(`Cache size: ${cache.size()}\n`);

    // Step 2: Worker reads (cache miss, load from Redis)
    console.log('--- Step 2: Worker reads (miss) ---');
    const v1 = await worker.get('test:1');
    const v2 = await worker.get('test:2');
    console.log(`Got: test:1=${v1}, test:2=${v2}`);
    console.log(`Cache size: ${cache.size()}\n`);

    // Step 3: Worker reads again (cache hit)
    console.log('--- Step 3: Worker reads (hit) ---');
    const v1b = await worker.get('test:1');
    const v2b = await worker.get('test:2');
    console.log(`Got: test:1=${v1b}, test:2=${v2b}`);
    console.log(`Cache size: ${cache.size()}\n`);

    // Step 4: Master modifies data
    console.log('--- Step 4: Master modifies ---');
    await master.set('test:1', 'newvalue');
    await new Promise(r => setTimeout(r, 100));
    console.log(`Cache size: ${cache.size()}\n`);

    // Step 5: Worker reads modified data
    console.log('--- Step 5: Worker reads (after invalidation) ---');
    const v1c = await worker.get('test:1');
    const v2c = await worker.get('test:2');
    console.log(`Got: test:1=${v1c}, test:2=${v2c}`);
    console.log(`Cache size: ${cache.size()}\n`);

    // Cleanup
    await master.del('test:1', 'test:2');
    console.log('✅ Test completed');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await worker.quit();
    await master.quit();
  }
}

if (require.main === module) {
  test();
}

module.exports = { test };
