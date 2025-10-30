#!/usr/bin/env node

/**
 * 完整演示脚本 - 在单个进程中展示 Client-Side Caching
 * 这个脚本演示了缓存失效的完整流程
 */

const redis = require('redis');

async function completeDemo() {
  console.log('=== Redis Client-Side Caching 完整演示 ===\n');

  // 创建缓存实例
  const cache = new redis.BasicClientSideCache({
    ttl: 60000,  // 60秒 TTL
    maxEntries: 1000,  // 最多1000个条目
    evictPolicy: 'LRU',  // LRU淘汰策略
    recordStats: true  // 记录统计
  });

  // 创建 Worker 客户端 (使用 RESP3 + 客户端缓存)
  const worker = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  // 创建 Master 客户端 (普通连接)
  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  // 监听缓存失效事件
  cache.on('invalidate', (keys) => {
    const keyStr = keys instanceof Buffer ? keys.toString() : String(keys);
    console.log('🔄 [Worker] 收到缓存失效通知:', keyStr);
  });

  try {
    await worker.connect();
    await master.connect();
    console.log('✅ Worker 和 Master 已连接\n');

    console.log('--- 步骤 1: 初始化数据 ---\n');
    await master.set('user:name', 'Alice');
    console.log('✍️  [Master] 写入 "user:name" = "Alice"');
    await master.set('user:email', 'alice@example.com');
    console.log('✍️  [Master] 写入 "user:email" = "alice@example.com"');
    await master.set('counter', '100');
    console.log('✍️  [Master] 写入 "counter" = "100"\n');

    console.log('--- 步骤 2: Worker 首次读取 (建立缓存) ---\n');
    const v1 = await worker.get('user:name');
    console.log(`⚠️  [Worker] 本地缓存未命中 "user:name", 从 Redis 获取: ${v1}`);
    const v2 = await worker.get('user:email');
    console.log(`⚠️  [Worker] 本地缓存未命中 "user:email", 从 Redis 获取: ${v2}`);
    const v3 = await worker.get('counter');
    console.log(`⚠️  [Worker] 本地缓存未命中 "counter", 从 Redis 获取: ${v3}\n`);

    console.log('--- 步骤 3: Worker 再次读取 (从本地缓存) ---\n');
    const v4 = await worker.get('user:name');
    console.log(`🎯 [Worker] 本地缓存命中 "user:name": ${v4}`);
    const v5 = await worker.get('user:email');
    console.log(`🎯 [Worker] 本地缓存命中 "user:email": ${v5}`);
    const v6 = await worker.get('counter');
    console.log(`🎯 [Worker] 本地缓存命中 "counter": ${v6}\n`);

    const stats1 = cache.stats();
    console.log(`📊 当前统计: 命中 ${stats1.hitCount}, 未命中 ${stats1.missCount}, 命中率 ${(stats1.hitRate()*100).toFixed(1)}%\n`);

    console.log('--- 步骤 4: Master 修改数据 (触发失效通知) ---\n');
    await master.set('user:name', 'Bob');
    console.log('✍️  [Master] 写入 "user:name" = "Bob"\n');
    
    // 等待失效消息传递
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('--- 步骤 5: Worker 读取更新后的数据 ---\n');
    const v7 = await worker.get('user:name'); // 应该从 Redis 重新获取
    console.log(`⚠️  [Worker] 缓存已失效, 从 Redis 重新获取 "user:name": ${v7}`);
    const v8 = await worker.get('user:email'); // 仍然从本地缓存
    console.log(`🎯 [Worker] 本地缓存命中 "user:email": ${v8}`);
    const v9 = await worker.get('counter'); // 仍然从本地缓存
    console.log(`🎯 [Worker] 本地缓存命中 "counter": ${v9}\n`);

    console.log('--- 步骤 6: Worker 再次读取 (新数据已缓存) ---\n');
    const v10 = await worker.get('user:name'); // 从本地缓存获取新值
    console.log(`🎯 [Worker] 本地缓存命中 "user:name": ${v10} (新值已缓存)\n`);

    console.log('--- 步骤 7: Master 增加计数器 ---\n');
    const newCounter = await master.incr('counter');
    console.log(`✍️  [Master] 计数器增加到 ${newCounter}\n`);
    
    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('--- 步骤 8: Worker 读取新的计数器值 ---\n');
    const v11 = await worker.get('counter');
    console.log(`⚠️  [Worker] 缓存已失效, 从 Redis 重新获取 "counter": ${v11}\n`);

    const stats2 = cache.stats();
    console.log('=== 最终统计 ===');
    console.log(`总读取次数: ${stats2.requestCount()}`);
    console.log(`本地缓存命中: ${stats2.hitCount}`);
    console.log(`Redis 访问: ${stats2.missCount}`);
    console.log(`命中率: ${(stats2.hitRate()*100).toFixed(1)}%`);
    console.log(`缓存大小: ${cache.size()} keys\n`);

    console.log('✅ 演示完成！\n');
    console.log('💡 要点总结:');
    console.log('   1. Worker 使用 RESP3 协议 + BasicClientSideCache');
    console.log('   2. 首次读取时缓存到本地内存');
    console.log('   3. 后续读取直接从本地获取（极快）');
    console.log('   4. Master 写入时，Redis 自动通知 Worker 失效');
    console.log('   5. Worker 收到通知后清除本地缓存');
    console.log('   6. 下次读取时重新从 Redis 获取并缓存\n');

    // 清理
    await master.del('user:name', 'user:email', 'counter');

  } catch (error) {
    console.error('❌ 错误:', error);
  } finally {
    await worker.quit();
    await master.quit();
  }
}

completeDemo();
