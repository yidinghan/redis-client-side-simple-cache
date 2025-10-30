#!/usr/bin/env node

/**
 * 使用原生 Redis 协议测试缓存失效
 * 绕过 node-redis 可能的 bug
 */

const net = require('net');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function rawRedisTest() {
  console.log('=== 使用原生协议测试缓存失效 ===\n');

  let receivedInvalidation = false;

  // Worker 连接 (RESP3)
  const worker = net.createConnection({ port: 6379, host: 'localhost' });
  
  worker.on('data', (data) => {
    const str = data.toString();
    console.log('[Worker 收到]:', str.slice(0, 200));
    
    // 检测失效消息 (RESP3 push message格式)
    if (str.includes('invalidate') || str.includes('test:raw')) {
      receivedInvalidation = true;
      console.log('🔔 检测到失效通知!\n');
    }
  });

  // Master 连接
  const master = net.createConnection({ port: 6379, host: 'localhost' });
  
  master.on('data', (data) => {
    console.log('[Master 收到]:', data.toString().slice(0, 100));
  });

  await delay(500);

  console.log('1. 切换 Worker 到 RESP3...');
  worker.write('*2\r\n$5\r\nHELLO\r\n$1\r\n3\r\n');
  await delay(500);

  console.log('\n2. 启用 CLIENT TRACKING...');
  worker.write('*3\r\n$6\r\nCLIENT\r\n$8\r\nTRACKING\r\n$2\r\nON\r\n');
  await delay(300);

  console.log('\n3. Worker 读取 key...');
  worker.write('*2\r\n$3\r\nGET\r\n$8\r\ntest:raw\r\n');
  await delay(300);

  console.log('\n4. Master 设置初始值...');
  master.write('*3\r\n$3\r\nSET\r\n$8\r\ntest:raw\r\n$7\r\ninitial\r\n');
  await delay(300);

  console.log('\n5. Worker 再次读取...');
  worker.write('*2\r\n$3\r\nGET\r\n$8\r\ntest:raw\r\n');
  await delay(500);

  console.log('\n6. Master 修改值（应触发失效）...');
  master.write('*3\r\n$3\r\nSET\r\n$8\r\ntest:raw\r\n$11\r\nnew_value_x\r\n');
  await delay(1000);

  if (receivedInvalidation) {
    console.log('✅ 成功：收到了原生失效通知！');
  } else {
    console.log('❌ 失败：未收到原生失效通知');
  }

  // 清理
  master.write('*2\r\n$3\r\nDEL\r\n$8\r\ntest:raw\r\n');
  await delay(200);
  
  worker.end();
  master.end();
}

rawRedisTest().catch(console.error);
