const { test, describe } = require('node:test');
const assert = require('node:assert');
const redis = require('redis');
const { SimpleClientSideCache } = require('../src/simple-cache');

// 工具函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Complex Scenarios', () => {

test('场景1: 并发读写压力测试', async (t) => {
  t.diagnostic('🔥 并发读写压力测试');

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
    assert.strictEqual(r1, 'v0');
    assert.strictEqual(r2, 'v0');
    assert.strictEqual(r3, 'v0');
    assert.strictEqual(cache1.size(), 1);
    assert.strictEqual(cache2.size(), 1);
    assert.strictEqual(cache3.size(), 1);

    // 再次读取，应该命中缓存
    t.diagnostic('📖 再次读取（应命中缓存）...');
    const [r4, r5, r6] = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert.strictEqual(r4, 'v0');
    assert.strictEqual(r5, 'v0');
    assert.strictEqual(r6, 'v0');

    // Master修改数据
    t.diagnostic('✏️  Master修改数据...');
    await master.set('concurrent:test', 'v1');
    await sleep(200);

    assert.ok(invalidCount1 >= 1, `Worker1收到失效通知 (${invalidCount1}次)`);
    assert.ok(invalidCount2 >= 1, `Worker2收到失效通知 (${invalidCount2}次)`);
    assert.ok(invalidCount3 >= 1, `Worker3收到失效通知 (${invalidCount3}次)`);
    assert.strictEqual(cache1.size(), 0);
    assert.strictEqual(cache2.size(), 0);
    assert.strictEqual(cache3.size(), 0);

    // 读取新值
    t.diagnostic('📖 读取新值...');
    const [r7, r8, r9] = await Promise.all([
      worker1.get('concurrent:test'),
      worker2.get('concurrent:test'),
      worker3.get('concurrent:test')
    ]);
    assert.strictEqual(r7, 'v1');
    assert.strictEqual(r8, 'v1');
    assert.strictEqual(r9, 'v1');

    // 频繁修改测试
    t.diagnostic('⚡ 频繁修改压力测试(10次)...');
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
    assert.strictEqual(finalReads[0], 'v11');
    assert.strictEqual(finalReads[1], 'v11');
    assert.strictEqual(finalReads[2], 'v11');

    t.diagnostic(`📊 失效通知统计: Worker1=${invalidCount1}, Worker2=${invalidCount2}, Worker3=${invalidCount3}`);

    await master.del('concurrent:test');

  } finally {
    await Promise.all([
      worker1.quit(),
      worker2.quit(),
      worker3.quit(),
      master.quit()
    ]);
  }
});

test('场景2: 批量操作测试', async (t) => {
  t.diagnostic('📦 批量操作测试');

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

    t.diagnostic('📖 MGET批量读取...');
    const values = await worker.mGet(['batch:1', 'batch:2', 'batch:3', 'batch:4', 'batch:5']);
    assert.strictEqual(values.join(','), 'v1,v2,v3,v4,v5');
    t.diagnostic(`缓存大小: ${cache.size()}`);

    t.diagnostic('📖 再次MGET（应命中缓存）...');
    const values2 = await worker.mGet(['batch:1', 'batch:2', 'batch:3']);
    assert.strictEqual(values2.join(','), 'v1,v2,v3');

    t.diagnostic('✏️  修改batch:2...');
    invalidations = [];
    await master.set('batch:2', 'v2_new');
    await sleep(200);

    const hasInvalidation = invalidations.some(k => k && k.toString() === 'batch:2');
    assert.ok(hasInvalidation, '收到batch:2失效通知');
    t.diagnostic(`失效通知: ${invalidations.map(k => k === null ? 'null' : k.toString()).join(', ')}`);

    t.diagnostic('📖 再次MGET验证...');
    const values3 = await worker.mGet(['batch:1', 'batch:2', 'batch:3']);
    assert.strictEqual(values3[0], 'v1');
    assert.strictEqual(values3[1], 'v2_new');
    assert.strictEqual(values3[2], 'v3');

    t.diagnostic('✏️  删除batch:1和batch:3...');
    invalidations = [];
    await master.del('batch:1');
    await sleep(100);
    await master.del('batch:3');
    await sleep(100);

    const hasBatch1 = invalidations.some(k => k && k.toString() === 'batch:1');
    const hasBatch3 = invalidations.some(k => k && k.toString() === 'batch:3');
    assert.ok(hasBatch1 || hasBatch3, '收到删除失效通知');
    t.diagnostic(`失效通知: ${invalidations.map(k => k === null ? 'null' : k.toString()).join(', ')}`);

    await master.del('batch:1', 'batch:2', 'batch:3', 'batch:4', 'batch:5');

  } finally {
    await worker.quit();
    await master.quit();
  }
});

test('场景3: 不同数据类型测试', async (t) => {
  t.diagnostic('🎲 不同数据类型测试');

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
    t.diagnostic('📝 测试String类型...');
    await master.set('type:string', 'hello world');
    const str1 = await worker.get('type:string');
    const str2 = await worker.get('type:string');
    assert.strictEqual(str1, 'hello world');
    assert.strictEqual(str2, 'hello world');

    // Hash类型
    t.diagnostic('📝 测试Hash类型...');
    await master.hSet('type:hash', { field1: 'value1', field2: 'value2' });
    const hash1 = await worker.hGetAll('type:hash');
    const hash2 = await worker.hGetAll('type:hash');
    assert.strictEqual(hash1.field1, 'value1');
    assert.strictEqual(hash2.field2, 'value2');
    assert.notStrictEqual(hash1, hash2);

    // JSON数据
    t.diagnostic('📝 测试JSON复杂对象...');
    const complexObj = { 
      id: 123, 
      name: '测试', 
      nested: { level: 2 },
      array: [1, 2, 3]
    };
    await master.set('type:json', JSON.stringify(complexObj));
    const json1 = await worker.get('type:json');
    const json2 = await worker.get('type:json');
    assert.strictEqual(JSON.parse(json1).id, 123);
    assert.strictEqual(json1, json2);

    // 特殊字符
    t.diagnostic('📝 测试特殊字符key...');
    await master.set('type:special:中文:emoji:🎉', 'special_value');
    const special = await worker.get('type:special:中文:emoji:🎉');
    assert.strictEqual(special, 'special_value');

    await master.del('type:string', 'type:hash', 'type:json', 'type:special:中文:emoji:🎉');

  } finally {
    await worker.quit();
    await master.quit();
  }
});

test('场景4: 边界条件测试', async (t) => {
  t.diagnostic('⚠️  边界条件测试');

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
    t.diagnostic('📝 测试不存在的key...');
    const notExist1 = await worker.get('edge:notexist');
    const notExist2 = await worker.get('edge:notexist');
    assert.strictEqual(notExist1, null);
    assert.strictEqual(notExist2, null);
    assert.ok(cache.size() >= 1);

    // 空字符串
    t.diagnostic('📝 测试空字符串...');
    await master.set('edge:empty', '');
    const empty1 = await worker.get('edge:empty');
    const empty2 = await worker.get('edge:empty');
    assert.strictEqual(empty1, '');
    assert.strictEqual(empty2, '');

    // 超大value (1MB)
    t.diagnostic('📝 测试超大value (1MB)...');
    const largeValue = 'x'.repeat(1024 * 1024);
    await master.set('edge:large', largeValue);
    const large1 = await worker.get('edge:large');
    const large2 = await worker.get('edge:large');
    assert.strictEqual(large1.length, 1024 * 1024);
    assert.strictEqual(large2.length, 1024 * 1024);

    // 数字0
    t.diagnostic('📝 测试数字0...');
    await master.set('edge:zero', '0');
    const zero1 = await worker.get('edge:zero');
    const zero2 = await worker.get('edge:zero');
    assert.strictEqual(zero1, '0');
    assert.strictEqual(zero2, '0');

    await master.del('edge:notexist', 'edge:empty', 'edge:large', 'edge:zero');

  } finally {
    await worker.quit();
    await master.quit();
  }
});

test('场景5: 失效场景全覆盖', async (t) => {
  t.diagnostic('🔔 失效场景全覆盖');

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
  });

  try {
    await worker.connect();
    await master.connect();

    // SET触发失效
    t.diagnostic('📝 测试SET触发失效...');
    await master.set('inv:set', 'v1');
    await worker.get('inv:set');
    invalidations = [];
    await master.set('inv:set', 'v2');
    await sleep(200);
    const hasSet = invalidations.some(k => k && k.toString() === 'inv:set');
    assert.ok(hasSet, 'SET触发失效');

    // DEL触发失效
    t.diagnostic('📝 测试DEL触发失效...');
    await master.set('inv:del', 'v1');
    await worker.get('inv:del');
    invalidations = [];
    await master.del('inv:del');
    await sleep(200);
    const hasDel = invalidations.some(k => k && k.toString() === 'inv:del');
    assert.ok(hasDel, 'DEL触发失效');

    // FLUSHDB触发全部失效
    t.diagnostic('📝 测试FLUSHDB触发全部失效...');
    await master.set('inv:flush1', 'v1');
    await master.set('inv:flush2', 'v2');
    await worker.get('inv:flush1');
    await worker.get('inv:flush2');
    const sizeBefore = cache.size();
    t.diagnostic(`失效前缓存大小: ${sizeBefore}`);
    
    invalidations = [];
    await master.flushDb();
    await sleep(200);
    
    assert.ok(invalidations.includes(null), 'FLUSHDB触发null失效');
    assert.strictEqual(cache.size(), 0);
    t.diagnostic(`失效后缓存大小: ${cache.size()}`);

  } finally {
    await worker.quit();
    await master.quit();
  }
});

test('场景6: 内存泄漏检测', async (t) => {
  t.diagnostic('🔍 内存泄漏检测');

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

    t.diagnostic('📊 持续读写1000次循环...');
    
    for (let i = 0; i < 1000; i++) {
      const key = `leak:${i % 100}`;
      
      await master.set(key, `value_${i}`);
      await worker.get(key);
      
      if (i % 10 === 0) {
        await master.set(key, `updated_${i}`);
        await sleep(10);
      }
      
      if (i % 100 === 0) {
        t.diagnostic(`第${i}次 - 缓存大小: ${cache.size()}, keyToCacheKeys大小: ${cache.keyToCacheKeys.size}`);
      }
    }

    const finalCacheSize = cache.size();
    const finalKeyMappingSize = cache.keyToCacheKeys.size;

    t.diagnostic('📊 最终统计:');
    t.diagnostic(`缓存条目: ${finalCacheSize}`);
    t.diagnostic(`Key映射: ${finalKeyMappingSize}`);

    assert.ok(finalCacheSize <= 100, `缓存大小合理 (${finalCacheSize} <= 100)`);
    assert.ok(finalKeyMappingSize <= 100, `Key映射大小合理 (${finalKeyMappingSize} <= 100)`);

    // 清理测试
    t.diagnostic('🧹 测试clear()清理...');
    cache.clear();
    assert.strictEqual(cache.size(), 0);
    assert.strictEqual(cache.keyToCacheKeys.size, 0);

    // 清理Redis
    for (let i = 0; i < 100; i++) {
      await master.del(`leak:${i}`);
    }

  } finally {
    await worker.quit();
    await master.quit();
  }
});

});
