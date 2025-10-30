# 为什么需要 keyToCacheKeys？

## TL;DR

**核心问题**：缓存存储用 `cacheKey`（命令+参数），失效通知用 `Redis key`（单键名），两者不匹配！  
**解决方案**：`keyToCacheKeys` 提供反向索引，实现 O(1) 查找 + O(k) 精准删除。

---

## 问题背景

### 缓存存储机制

Redis 客户端缓存使用 **cacheKey** 作为存储键，格式为 `${lengths}_${keys}`：

```javascript
// 示例
GET('user:1')              → cacheKey: "6_user:1"
GET('order:100')           → cacheKey: "9_order:100"
MGET(['user:1', 'user:2']) → cacheKey: "6_6_user:1_user:2"
MGET(['user:1', 'user:3']) → cacheKey: "6_6_user:1_user:3"
```

**为什么这样设计？**
- 命令参数不同，结果就不同（`GET` vs `MGET`）
- 需要完整参数信息才能唯一标识一次调用

### 失效通知机制

Redis 服务器发送的失效通知只包含 **单个 Redis key**：

```
// Redis 发送的失效消息
Invalidate: "user:1"
Invalidate: "order:100"
```

**Redis 不会告诉你**：
- ❌ 哪些命令涉及了这个 key
- ❌ 哪些 cacheKey 需要删除
- ❌ 是 GET 还是 MGET 访问的

---

## 矛盾点

当 `user:1` 被修改时：

```javascript
// ❌ 错误方案1：直接用 Redis key 删除缓存
this.cache.delete('user:1');  // 只能删除 GET('user:1') 的缓存
// 问题：MGET(['user:1','user:2']) 的缓存仍然存在！数据不一致！

// ❌ 错误方案2：遍历整个 cache
for (let [cacheKey, value] of this.cache) {
  if (cacheKey.includes('user:1')) {  // 危险！会误删 'user:10', 'user:11'
    this.cache.delete(cacheKey);
  }
}
// 问题：O(n) 复杂度，无法精确匹配
```

---

## 解决方案：keyToCacheKeys 反向索引

### 数据结构

```javascript
class SimpleClientSideCache {
  constructor() {
    // 正向：存储缓存值
    this.cache = new Map();  // cacheKey → value
    
    // 反向：用于失效查找
    this.keyToCacheKeys = new Map();  // Redis key → Set<cacheKey>
  }
}
```

### 示例数据

执行以下操作后：

```javascript
await client.get('user:1');                    // ①
await client.mGet(['user:1', 'user:2']);       // ②
await client.mGet(['user:1', 'user:3']);       // ③
await client.get('user:2');                    // ④
```

内部数据结构：

```javascript
// cache: 存储缓存值
cache = {
  '6_user:1':              'Alice',           // ①
  '6_6_user:1_user:2':     ['Alice', 'Bob'],  // ②
  '6_6_user:1_user:3':     ['Alice', 'Carol'],// ③
  '6_user:2':              'Bob'              // ④
}

// keyToCacheKeys: 反向索引
keyToCacheKeys = {
  'user:1': Set([
    '6_user:1',              // ① 来自 GET('user:1')
    '6_6_user:1_user:2',     // ② 来自 MGET(['user:1','user:2'])
    '6_6_user:1_user:3'      // ③ 来自 MGET(['user:1','user:3'])
  ]),
  'user:2': Set([
    '6_6_user:1_user:2',     // ② 来自 MGET(['user:1','user:2'])
    '6_user:2'               // ④ 来自 GET('user:2')
  ]),
  'user:3': Set([
    '6_6_user:1_user:3'      // ③ 来自 MGET(['user:1','user:3'])
  ])
}
```

### 失效流程

当 Redis 发送失效通知 `user:1` 时：

```javascript
invalidate(key) {
  const keyStr = key.toString();  // 'user:1'
  
  // ✅ O(1) 查找所有相关缓存
  const cacheKeys = this.keyToCacheKeys.get(keyStr);
  // → Set(['6_user:1', '6_6_user:1_user:2', '6_6_user:1_user:3'])
  
  if (cacheKeys) {
    // ✅ O(k) 精准删除，k = 受影响的缓存条目数（此例为3）
    for (const cacheKey of cacheKeys) {
      this.cache.delete(cacheKey);
    }
    this.keyToCacheKeys.delete(keyStr);
  }
  
  this.emit('invalidate', key);
}
```

**结果**：
- ✅ 删除了 `GET('user:1')` 的缓存
- ✅ 删除了 `MGET(['user:1','user:2'])` 的缓存
- ✅ 删除了 `MGET(['user:1','user:3'])` 的缓存
- ✅ **保留了** `GET('user:2')` 的缓存（未受影响）

---

## 复杂度分析

| 方案 | 查找复杂度 | 删除复杂度 | 精确性 | 空间开销 |
|-----|----------|----------|-------|---------|
| 直接删除 | O(1) | O(1) | ❌ 漏删 | 0 |
| 遍历 cache | O(n) | O(n) | ❌ 误删 | 0 |
| **keyToCacheKeys** | **O(1)** | **O(k)** | ✅ 精准 | O(n+m) |

其中：
- n = cache 总条目数
- k = 受影响的缓存条目数（通常 k << n）
- m = 唯一 Redis key 数量

**空间开销示例**：
- 1000 次 `GET('user:1')` → 只占用 1 个 cache 条目（命中缓存）
- 1000 次 `MGET(['user:1','user:2'])` → 只占用 1 个 cache 条目
- keyToCacheKeys 只有 2 个条目：`user:1` 和 `user:2`

**实际开销极小**！

---

## 实战测试验证

### 测试场景：批量操作（test-complex-scenarios.js）

```javascript
// 写入5个key
await master.set('batch:1', 'v1');
await master.set('batch:2', 'v2');
await master.set('batch:3', 'v3');

// MGET 批量读取 → 创建1个缓存条目，关联3个Redis key
await worker.mGet(['batch:1', 'batch:2', 'batch:3']);

// 只修改 batch:2
await master.set('batch:2', 'v2_new');

// ✅ 精准失效：
// - 包含 batch:2 的缓存条目被删除（MGET结果）
// - 其他 batch:1、batch:3 单独的缓存（如果有）不受影响
```

### 测试场景：内存泄漏检测

```javascript
// 1000次迭代：写入 → 读取 → 失效 → 清理
for (let i = 0; i < 1000; i++) {
  await client.set('leak:test', `v${i}`);
  await client.get('leak:test');  // 缓存
  await client.set('leak:test', `v${i+1}`);  // 触发失效
  await sleep(10);
  
  // ✅ 验证：cache 和 keyToCacheKeys 都被正确清理
  assert.strictEqual(cache.size(), 0);
  assert.strictEqual(cache.keyToCacheKeys.size, 0);
}
```

**结果**：6/6 测试全部通过，无内存泄漏！

---

## 为什么不能简化？

### ❌ 方案1：只用 Redis key 作为 cache key

```javascript
// 假设用 Redis key 直接存储
cache.set('user:1', 'Alice');

// 问题：无法支持 MGET
await mGet(['user:1', 'user:2']);  
// → 返回什么？cache 只有 'user:1' 和 'user:2' 的单独值
// → 如何存储 MGET 的结果？覆盖单独的值？
```

### ❌ 方案2：失效时遍历整个 cache

```javascript
for (let cacheKey of cache.keys()) {
  if (cacheKey.includes('user:1')) {  // ⚠️ 字符串匹配
    cache.delete(cacheKey);
  }
}

// 问题：
// 1. 'user:1' 会误删 'user:10', 'user:100', 'user:123'
// 2. '6_6_user:1_user:2' 中的 'user:1' 如何精确匹配？
// 3. O(n) 复杂度，cache 越大越慢
```

### ❌ 方案3：正则表达式匹配

```javascript
const regex = new RegExp(`\\buser:1\\b`);  // 词边界
for (let cacheKey of cache.keys()) {
  if (regex.test(cacheKey)) {
    cache.delete(cacheKey);
  }
}

// 问题：
// 1. 仍然是 O(n) 遍历
// 2. 特殊字符转义复杂（Redis key 可以包含任意字符）
// 3. 性能更差（正则引擎开销）
```

---

## 设计权衡

### ✅ 优点

1. **精准失效**：只删除真正相关的缓存，不误删
2. **高性能**：O(1) 查找 + O(k) 删除，k 通常很小
3. **支持复杂命令**：MGET、HGETALL、JSON.GET 等多键操作
4. **内存可控**：空间开销线性且实际很小

### ⚠️ 缺点

1. **额外内存**：需要维护反向索引（但开销小）
2. **两个 Map**：需要同步维护 cache 和 keyToCacheKeys
3. **复杂度增加**：相比简单方案多了一层映射

### 💡 结论

**空间换时间的经典案例**：少量内存换取精准高效的失效机制，完全值得！

---

## 相关资源

- [Redis Client-Side Caching 官方文档](https://redis.io/docs/latest/develop/reference/client-side-caching/)
- [RESP3 Protocol Specification](https://github.com/redis/redis-specifications/blob/master/protocol/RESP3.md)
- 代码实现：[src/simple-cache.js](../src/simple-cache.js)
- 测试验证：[test/test-complex-scenarios.js](../test/test-complex-scenarios.js)

---

## FAQ

### Q: 为什么不用 WeakMap？

**A**: WeakMap 的 key 必须是对象，而 Redis key 是字符串。即使包装成对象，GC 也无法正确回收（cacheKey 字符串仍持有引用）。

### Q: 单个 Redis key 对应的 cacheKey 会很多吗？

**A**: 通常不会。实际应用中：
- GET/SET 命中缓存后不会重复添加
- MGET 的不同组合才会创建多个条目
- 即使有，Set 结构高效，查找/删除都是 O(1)

### Q: 为什么用 Set 而不是 Array？

**A**: Set 自动去重，添加/删除都是 O(1)。Array 需要检查重复（O(n)），删除也需要查找（O(n)）。

### Q: 如果 Redis key 包含特殊字符怎么办？

**A**: 完全没问题！keyToCacheKeys 用字符串全等匹配（`===`），不做任何解析。emoji、中文、空格、换行符都能正确处理。

---

**最后更新**: 2025-10-30  
**作者**: Redis Simple Client-Side Cache 团队
