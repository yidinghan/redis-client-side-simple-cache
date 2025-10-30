#!/usr/bin/env node

/**
 * 使用 node-redis 内置的 Client-Side Cache
 */

const redis = require('redis');

async function testBuiltInCache() {
  console.log('=== 使用 node-redis 内置客户端缓存 ===\n');

  // 创建带缓存的 Worker
  const worker = await redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  })
    .on('error', err => console.log('Redis Client Error', err))
    .connect();

  // 启用客户端缓存
  await worker.enableAutoPipelining();
  
  // 创建 Master
  const master = await redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  })
    .on('error', err => console.log('Redis Client Error', err))
    .connect();

  try {
    console.log('✅ 已连接\n');

    console.log('1️⃣  Master 初始化数据...');
    await master.set('builtin:test', 'value1');
    console.log('   完成\n');

    console.log('2️⃣  Worker 首次读取...');
    const t1 = Date.now();
    const v1 = await worker.get('builtin:test');
    const d1 = Date.now() - t1;
    console.log(`   值: ${v1}, 耗时: ${d1}ms\n`);

    console.log('3️⃣  Worker 再次读取（应该很快）...');
    const t2 = Date.now();
    const v2 = await worker.get('builtin:test');
    const d2 = Date.now() - t2;
    console.log(`   值: ${v2}, 耗时: ${d2}ms\n`);

    console.log('4️⃣  Master 修改数据...');
    await master.set('builtin:test', 'value2');
    console.log('   完成\n');

    await new Promise(r => setTimeout(r, 100));

    console.log('5️⃣  Worker 读取新值...');
    const t3 = Date.now();
    const v3 = await worker.get('builtin:test');
    const d3 = Date.now() - t3;
    console.log(`   值: ${v3}, 耗时: ${d3}ms\n`);

    // 清理
    await master.del('builtin:test');

  } catch (error) {
    console.error('错误:', error);
  } finally {
    await worker.quit();
    await master.quit();
  }
}

testBuiltInCache();
