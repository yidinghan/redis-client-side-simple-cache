#!/usr/bin/env node

const { createClient, BasicClientSideCache } = require('redis');

async function properCacheTest() {
  console.log('=== 正确使用 node-redis Client-Side Cache ===\n');

  // 创建缓存实例
  const cache = new BasicClientSideCache({
    ttl: 60000,  // 60秒 TTL
    maxEntries: 1000,  // 最多1000个条目
    evictPolicy: 'LRU',  // LRU淘汰策略
    recordStats: true  // 记录统计
  });

  // 创建带缓存的 Worker (使用 RESP3)
  const worker = createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,  // 使用 RESP3
    clientSideCache: cache  // 启用缓存
  });

  // 监听缓存失效事件  
  cache.on('invalidate', (keys) => {
    console.log('🔔 [Cache] 失效通知:', keys);
  });

  const master = createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  try {
    await worker.connect();
    await master.connect();
    console.log('✅ 已连接\n');

    console.log('1️⃣  Master 初始化数据...');
    await master.set('cache:user:1', 'Alice');
    await master.set('cache:user:2', 'Bob');
    console.log('   完成\n');

    console.log('2️⃣  Worker 首次读取（从 Redis）...');
    const v1 = await worker.get('cache:user:1');
    const v2 = await worker.get('cache:user:2');
    console.log(`   user:1 = ${v1}, user:2 = ${v2}`);
    console.log(`   缓存统计:`, cache.stats());
    console.log();

    console.log('3️⃣  Worker 再次读取（从本地缓存）...');
    const v3 = await worker.get('cache:user:1');
    const v4 = await worker.get('cache:user:2');
    console.log(`   user:1 = ${v3}, user:2 = ${v4}`);
    console.log(`   缓存统计:`, cache.stats());
    console.log();

    console.log('4️⃣  Master 修改数据...');
    await master.set('cache:user:1', 'Charlie');
    console.log('   等待失效通知...');
    await new Promise(r => setTimeout(r, 200));

    console.log('\n5️⃣  Worker 读取修改后的数据...');
    const v5 = await worker.get('cache:user:1');
    const v6 = await worker.get('cache:user:2');  // 这个应该还在缓存中
    console.log(`   user:1 = ${v5} (应该是新值), user:2 = ${v6} (缓存命中)`);
    console.log(`   缓存统计:`, cache.stats());
    console.log();

    // 清理
    await master.del('cache:user:1', 'cache:user:2');

    console.log('✅ 测试完成!\n');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  } finally {
    await worker.quit();
    await master.quit();
  }
}

properCacheTest();
