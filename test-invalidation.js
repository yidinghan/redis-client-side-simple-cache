#!/usr/bin/env node

/**
 * 测试缓存失效通知是否工作
 */

const redis = require('redis');

async function testInvalidation() {
  console.log('=== 测试 Redis Client-Side Caching 失效通知 ===\n');

  // 创建两个独立的连接
  const worker = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3
  });

  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  let invalidationReceived = false;

  // 监听失效事件
  worker.on('invalidate', (keys) => {
    invalidationReceived = true;
    console.log('🔔 [Worker] 收到失效通知!');
    console.log('   失效的 keys:', keys);
  });

  try {
    console.log('1️⃣  连接到 Redis...');
    await worker.connect();
    await master.connect();
    console.log('   ✅ 已连接\n');

    console.log('2️⃣  启用 Worker 的客户端跟踪...');
    const trackingResult = await worker.sendCommand(['CLIENT', 'TRACKING', 'ON']);
    console.log('   结果:', trackingResult);
    
    // 检查跟踪状态
    const info = await worker.sendCommand(['CLIENT', 'TRACKINGINFO']);
    console.log('   跟踪信息:', info);
    console.log();

    console.log('3️⃣  Master 写入初始值...');
    await master.set('test:key', 'initial_value');
    console.log('   ✅ 写入完成\n');

    console.log('4️⃣  Worker 读取数据（建立跟踪）...');
    const value1 = await worker.sendCommand(['GET', 'test:key']);
    console.log('   读取到:', value1);
    
    // 再次检查跟踪状态
    const info2 = await worker.sendCommand(['CLIENT', 'TRACKINGINFO']);
    console.log('   当前跟踪的 keys 数量:', info2);
    console.log();

    console.log('5️⃣  等待 500ms...');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('6️⃣  Master 修改数据（应该触发失效通知）...');
    await master.set('test:key', 'new_value');
    console.log('   ✅ 修改完成\n');

    console.log('7️⃣  等待失效通知...');
    await new Promise(resolve => setTimeout(resolve, 500));

    if (invalidationReceived) {
      console.log('✅ 成功：收到了失效通知！\n');
    } else {
      console.log('❌ 失败：没有收到失效通知\n');
      console.log('可能的原因:');
      console.log('  1. Redis 版本 < 6.0');
      console.log('  2. CLIENT TRACKING 未正确启用');
      console.log('  3. node-redis 版本问题');
      console.log('  4. RESP3 协议未启用\n');
    }

    // 验证数据是否真的改变了
    console.log('8️⃣  再次读取验证...');
    const value2 = await worker.sendCommand(['GET', 'test:key']);
    console.log('   当前值:', value2);

    // 清理测试数据
    await master.del('test:key');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error);
  } finally {
    await worker.quit();
    await master.quit();
  }
}

testInvalidation();
