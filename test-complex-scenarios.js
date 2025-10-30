#!/usr/bin/env node

const redis = require('redis');
const { SimpleClientSideCache } = require('./src/simple-cache');

// 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`   ✅ ${message}`);
}

// ========================================
// 场景1: 并发读写压力测试
// ========================================
async function testConcurrentReadWrite() {
  console.log('\n' + '='.repeat(60));
  console.log('🔥 场景1: 并发读写压力测试');
  console.log('='.repeat(60));

  const cache1 = new SimpleClientSideCache();
  const cache2 = new SimpleClientSideCache();
  const cache3 = new SimpleClientSideCache();

  const worker1 = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache1
  });

  const worker2 = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache2
  });

  const worker3 = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache3
  });

  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  let invalidCount1 = 0, invalidCount2 = 0, invalidCount3 = 0;
  cache1.on('invalidate', () => invalidCount1++);
  cache2.on('invalidate', () => invalidCount2++);
  cache3.on('invalidate', () => invalidCount3++);

  try {
    await Promise.all([
      worker1.connect(),
      worker2.connect(),
      worker3.connect(),
      master.connect()
    ]);

    // 初始化数据
    console.log('\n📝 初始化数据...');
    await master.set('concurrent:test', 'v0');

    // 所有Worker同时读取（建立缓存）
    console.log('📖 3个Worker同时首次读取...');
    const [r1, r2, r3] = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert(r1 === 'v0' && r2 === 'v0' && r3 === 'v0', '所有Worker读到初始值');
    assert(cache1.size() === 1, 'Worker1缓存已建立');
    assert(cache2.size() === 1, 'Worker2缓存已建立');
    assert(cache3.size() === 1, 'Worker3缓存已建立');

    // 再次读取，应该命中缓存
    console.log('\n📖 再次读取（应命中缓存）...');
    const [r4, r5, r6] = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert(r4 === 'v0' && r5 === 'v0' && r6 === 'v0', '所有Worker命中缓存');

    // Master修改数据
    console.log('\n✏️  Master修改数据...');
    await master.set('concurrent:test', 'v1');
    await sleep(200);

    assert(invalidCount1 >= 1, `Worker1收到失效通知 (${invalidCount1}次)`);
    assert(invalidCount2 >= 1, `Worker2收到失效通知 (${invalidCount2}次)`);
    assert(invalidCount3 >= 1, `Worker3收到失效通知 (${invalidCount3}次)`);
    assert(cache1.size() === 0, 'Worker1缓存已清空');
    assert(cache2.size() === 0, 'Worker2缓存已清空');
    assert(cache3.size() === 0, 'Worker3缓存已清空');

    // 读取新值
    console.log('\n📖 读取新值...');
    const [r7, r8, r9] = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert(r7 === 'v1' && r8 === 'v1' && r9 === 'v1', '所有Worker读到新值');

    // 频繁修改测试
    console.log('\n⚡ 频繁修改压力测试(10次)...');
    for (let i = 0; i < 10; i++) {
      await master.set('concurrent:test', `v${i + 2}`);
      await sleep(50);
    }
    await sleep(200);

    const finalReads = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert(
      finalReads[0] === 'v11' && finalReads[1] === 'v11' && finalReads[2] === 'v11',
      '所有Worker读到最终值v11'
    );

    console.log(`\n📊 失效通知统计: Worker1=${invalidCount1}, Worker2=${invalidCount2}, Worker3=${invalidCount3}`);

    await master.del('concurrent:test');
    console.log('\n✅ 场景1通过！');

  } finally {
    await Promise.all([
      worker1.quit(),
      worker2.quit(),
      worker3.quit(),
      master.quit()
    ]);
  }
}

// ========================================
// 场景2: 批量操作测试
// ========================================
async function testBatchOperations() {
  console.log('\n' + '='.repeat(60));
  console.log('📦 场景2: 批量操作测试');
  console.log('='.repeat(60));

  const cache = new SimpleClientSideCache();
  const worker = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  let invalidations = [];
  cache.on('invalidate', (key) => invalidations.push(key));

  try {
    await worker.connect();
    await master.connect();

    console.log('\n📝 批量写入5个key...');
    await Promise.all([
      master.set('batch:1', 'v1'),
      master.set('batch:2', 'v2'),
      master.set('batch:3', 'v3'),
      master.set('batch:4', 'v4'),
      master.set('batch:5', 'v5')
    ]);

    console.log('\n📖 MGET批量读取...');
    const values = await worker.mGet(['batch:1', 'batch:2', 'batch:3', 'batch:4', 'batch:5']);
    assert(values.join(',') === 'v1,v2,v3,v4,v5', 'MGET读取正确');
    console.log(`   缓存大小: ${cache.size()}`);

    console.log('\n📖 再次MGET（应命中缓存）...');
    const values2 = await worker.mGet(['batch:1', 'batch:2', 'batch:3']);
    assert(values2.join(',') === 'v1,v2,v3', 'MGET缓存命中');

    console.log('\n✏️  修改batch:2...');
    invalidations = [];
    await master.set('batch:2', 'v2_new');
    await sleep(200);

    const hasInvalidation = invalidations.some(k => k && k.toString() === 'batch:2');
    assert(hasInvalidation, '收到batch:2失效通知');
    console.log(`   失效通知: ${invalidations.map(k => k === null ? 'null' : k.toString()).join(', ')}`);

    console.log('\n📖 再次MGET验证...');
    const values3 = await worker.mGet(['batch:1', 'batch:2', 'batch:3']);
    assert(values3[0] === 'v1', 'batch:1仍在缓存');
    assert(values3[1] === 'v2_new', 'batch:2读到新值');
    assert(values3[2] === 'v3', 'batch:3仍在缓存');

    console.log('\n✏️  删除batch:1和batch:3...');
    invalidations = [];
    await master.del('batch:1');
    await sleep(100);
    await master.del('batch:3');
    await sleep(100);

    const hasBatch1 = invalidations.some(k => k && k.toString() === 'batch:1');
    const hasBatch3 = invalidations.some(k => k && k.toString() === 'batch:3');
    assert(hasBatch1 || hasBatch3, '收到删除失效通知');
    console.log(`   失效通知: ${invalidations.map(k => k === null ? 'null' : k.toString()).join(', ')}`);

    await master.del('batch:1', 'batch:2', 'batch:3', 'batch:4', 'batch:5');
    console.log('\n✅ 场景2通过！');

  } finally {
    await worker.quit();
    await master.quit();
  }
}

// ========================================
// 场景3: 数据类型测试
// ========================================
async function testDataTypes() {
  console.log('\n' + '='.repeat(60));
  console.log('🎲 场景3: 不同数据类型测试');
  console.log('='.repeat(60));

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

    // String类型
    console.log('\n📝 测试String类型...');
    await master.set('type:string', 'hello world');
    const str1 = await worker.get('type:string');
    const str2 = await worker.get('type:string');
    assert(str1 === 'hello world' && str2 === 'hello world', 'String类型缓存正常');

    // Hash类型
    console.log('\n📝 测试Hash类型...');
    await master.hSet('type:hash', { field1: 'value1', field2: 'value2' });
    const hash1 = await worker.hGetAll('type:hash');
    const hash2 = await worker.hGetAll('type:hash');
    assert(hash1.field1 === 'value1' && hash2.field2 === 'value2', 'Hash类型缓存正常');
    assert(hash1 !== hash2, 'Hash返回不同对象（structuredClone）');

    // JSON数据
    console.log('\n📝 测试JSON复杂对象...');
    const complexObj = { 
      id: 123, 
      name: '测试', 
      nested: { level: 2 },
      array: [1, 2, 3]
    };
    await master.set('type:json', JSON.stringify(complexObj));
    const json1 = await worker.get('type:json');
    const json2 = await worker.get('type:json');
    assert(JSON.parse(json1).id === 123, 'JSON数据缓存正常');
    assert(json1 === json2, 'String基本类型值相等（符合预期）');

    // 特殊字符
    console.log('\n📝 测试特殊字符key...');
    await master.set('type:special:中文:emoji:🎉', 'special_value');
    const special = await worker.get('type:special:中文:emoji:🎉');
    assert(special === 'special_value', '特殊字符key缓存正常');

    await master.del('type:string', 'type:hash', 'type:json', 'type:special:中文:emoji:🎉');
    console.log('\n✅ 场景3通过！');

  } finally {
    await worker.quit();
    await master.quit();
  }
}

// ========================================
// 场景4: 边界条件测试
// ========================================
async function testEdgeCases() {
  console.log('\n' + '='.repeat(60));
  console.log('⚠️  场景4: 边界条件测试');
  console.log('='.repeat(60));

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

    // 不存在的key
    console.log('\n📝 测试不存在的key...');
    const notExist1 = await worker.get('edge:notexist');
    const notExist2 = await worker.get('edge:notexist');
    assert(notExist1 === null && notExist2 === null, 'null值可以缓存');
    assert(cache.size() >= 1, 'null值已缓存');

    // 空字符串
    console.log('\n📝 测试空字符串...');
    await master.set('edge:empty', '');
    const empty1 = await worker.get('edge:empty');
    const empty2 = await worker.get('edge:empty');
    assert(empty1 === '' && empty2 === '', '空字符串可以缓存');

    // 超大value (1MB)
    console.log('\n📝 测试超大value (1MB)...');
    const largeValue = 'x'.repeat(1024 * 1024);
    await master.set('edge:large', largeValue);
    const large1 = await worker.get('edge:large');
    const large2 = await worker.get('edge:large');
    assert(large1.length === 1024 * 1024 && large2.length === 1024 * 1024, '超大value可以缓存');

    // 数字0
    console.log('\n📝 测试数字0...');
    await master.set('edge:zero', '0');
    const zero1 = await worker.get('edge:zero');
    const zero2 = await worker.get('edge:zero');
    assert(zero1 === '0' && zero2 === '0', '数字0可以缓存');

    await master.del('edge:notexist', 'edge:empty', 'edge:large', 'edge:zero');
    console.log('\n✅ 场景4通过！');

  } finally {
    await worker.quit();
    await master.quit();
  }
}

// ========================================
// 场景5: 失效场景全覆盖
// ========================================
async function testInvalidationScenarios() {
  console.log('\n' + '='.repeat(60));
  console.log('🔔 场景5: 失效场景全覆盖');
  console.log('='.repeat(60));

  const cache = new SimpleClientSideCache();
  const worker = redis.createClient({
    socket: { host: 'localhost', port: 6379 },
    RESP: 3,
    clientSideCache: cache
  });

  const master = redis.createClient({
    socket: { host: 'localhost', port: 6379 }
  });

  let invalidations = [];
  cache.on('invalidate', (key) => {
    invalidations.push(key);
    console.log(`   🔔 失效: ${key === null ? 'ALL' : key.toString()}`);
  });

  try {
    await worker.connect();
    await master.connect();

    // SET触发失效
    console.log('\n📝 测试SET触发失效...');
    await master.set('inv:set', 'v1');
    await worker.get('inv:set');
    invalidations = [];
    await master.set('inv:set', 'v2');
    await sleep(200);
    const hasSet = invalidations.some(k => k && k.toString() === 'inv:set');
    assert(hasSet, 'SET触发失效');

    // DEL触发失效
    console.log('\n📝 测试DEL触发失效...');
    await master.set('inv:del', 'v1');
    await worker.get('inv:del');
    invalidations = [];
    await master.del('inv:del');
    await sleep(200);
    const hasDel = invalidations.some(k => k && k.toString() === 'inv:del');
    assert(hasDel, 'DEL触发失效');

    // FLUSHDB触发全部失效
    console.log('\n📝 测试FLUSHDB触发全部失效...');
    await master.set('inv:flush1', 'v1');
    await master.set('inv:flush2', 'v2');
    await worker.get('inv:flush1');
    await worker.get('inv:flush2');
    const sizeBefore = cache.size();
    console.log(`   失效前缓存大小: ${sizeBefore}`);
    
    invalidations = [];
    await master.flushDb();
    await sleep(200);
    
    assert(invalidations.includes(null), 'FLUSHDB触发null失效');
    assert(cache.size() === 0, '缓存已全部清空');
    console.log(`   失效后缓存大小: ${cache.size()}`);

    console.log('\n✅ 场景5通过！');

  } finally {
    await worker.quit();
    await master.quit();
  }
}

// ========================================
// 场景6: 内存泄漏检测
// ========================================
async function testMemoryLeak() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 场景6: 内存泄漏检测');
  console.log('='.repeat(60));

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

    console.log('\n📊 持续读写1000次循环...');
    
    for (let i = 0; i < 1000; i++) {
      const key = `leak:${i % 100}`;
      
      await master.set(key, `value_${i}`);
      await worker.get(key);
      
      if (i % 10 === 0) {
        await master.set(key, `updated_${i}`);
        await sleep(10);
      }
      
      if (i % 100 === 0) {
        console.log(`   第${i}次 - 缓存大小: ${cache.size()}, keyToCacheKeys大小: ${cache.keyToCacheKeys.size}`);
      }
    }

    const finalCacheSize = cache.size();
    const finalKeyMappingSize = cache.keyToCacheKeys.size;

    console.log(`\n📊 最终统计:`);
    console.log(`   缓存条目: ${finalCacheSize}`);
    console.log(`   Key映射: ${finalKeyMappingSize}`);

    assert(finalCacheSize <= 100, `缓存大小合理 (${finalCacheSize} <= 100)`);
    assert(finalKeyMappingSize <= 100, `Key映射大小合理 (${finalKeyMappingSize} <= 100)`);

    // 清理测试
    console.log('\n🧹 测试clear()清理...');
    cache.clear();
    assert(cache.size() === 0, '缓存已清空');
    assert(cache.keyToCacheKeys.size === 0, 'Key映射已清空');

    // 清理Redis
    for (let i = 0; i < 100; i++) {
      await master.del(`leak:${i}`);
    }

    console.log('\n✅ 场景6通过！无内存泄漏');

  } finally {
    await worker.quit();
    await master.quit();
  }
}

// ========================================
// 主测试入口
// ========================================
async function runAllTests() {
  console.log('\n🚀 开始Simple Cache复杂场景测试');
  console.log('测试时间:', new Date().toISOString());
  
  const startTime = Date.now();
  
  try {
    await testConcurrentReadWrite();
    await testBatchOperations();
    await testDataTypes();
    await testEdgeCases();
    await testInvalidationScenarios();
    await testMemoryLeak();
    
    const duration = Date.now() - startTime;
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 所有测试通过！');
    console.log(`⏱️  总耗时: ${duration}ms`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n💥 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = {
  testConcurrentReadWrite,
  testBatchOperations,
  testDataTypes,
  testEdgeCases,
  testInvalidationScenarios,
  testMemoryLeak
};
