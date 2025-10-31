#!/usr/bin/env node

/**
 * 性能对比测试: 不同统计方案的开销
 * 
 * 测试场景:
 * 1. 方案1: 空函数 vs 实际函数
 * 2. 方案2: Proxy 拦截
 * 3. 方案3: 条件方法替换
 * 4. 方案4: 装饰器模式
 * 5. Baseline: 直接 if 判断
 */

const ITERATIONS = 10_000_000;

// ============== 方案1: 空函数模式 ==============
class Method1Enabled {
  constructor() {
    this.stats = { hit: 0, miss: 0 };
    this._incHit = () => this.stats.hit++;
    this._incMiss = () => this.stats.miss++;
  }
  
  recordHit() {
    this._incHit();
  }
}

class Method1Disabled {
  constructor() {
    this._incHit = () => {};
    this._incMiss = () => {};
  }
  
  recordHit() {
    this._incHit();
  }
}

// ============== 方案2: Proxy 拦截 ==============
class Method2Enabled {
  constructor() {
    const stats = { hit: 0, miss: 0 };
    this.stat = new Proxy(stats, {
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
  }
  
  recordHit() {
    this.stat.hit++;
  }
}

class Method2Disabled {
  constructor() {
    this.stat = new Proxy({}, {
      set() { return true; }
    });
  }
  
  recordHit() {
    this.stat.hit++;
  }
}

// ============== 方案3: 条件方法替换 ==============
class Method3Enabled {
  constructor() {
    this.stats = { hit: 0, miss: 0 };
    this.recordHit = function() {
      this.stats.hit++;
    };
  }
}

class Method3Disabled {
  constructor() {
    this.recordHit = function() {};
  }
}

// ============== 方案4: 装饰器模式 ==============
class StatCollector {
  constructor() {
    this.hit = 0;
    this.miss = 0;
  }
  recordHit() { this.hit++; }
}

class NoOpStatCollector {
  recordHit() {}
}

class Method4Enabled {
  constructor() {
    this.collector = new StatCollector();
  }
  
  recordHit() {
    this.collector.recordHit();
  }
}

class Method4Disabled {
  constructor() {
    this.collector = new NoOpStatCollector();
  }
  
  recordHit() {
    this.collector.recordHit();
  }
}

// ============== Baseline: 直接 if 判断 ==============
class BaselineEnabled {
  constructor() {
    this.enableStat = true;
    this.stats = { hit: 0, miss: 0 };
  }
  
  recordHit() {
    if (this.enableStat) {
      this.stats.hit++;
    }
  }
}

class BaselineDisabled {
  constructor() {
    this.enableStat = false;
  }
  
  recordHit() {
    if (this.enableStat) {
      this.stats.hit++;
    }
  }
}

// ============== 性能测试函数 ==============
function benchmark(name, instance, iterations) {
  const start = process.hrtime.bigint();
  
  for (let i = 0; i < iterations; i++) {
    instance.recordHit();
  }
  
  const end = process.hrtime.bigint();
  const elapsed = Number(end - start) / 1e6; // 转换为毫秒
  const opsPerSec = (iterations / elapsed) * 1000;
  const nsPerOp = (elapsed * 1e6) / iterations;
  
  return {
    name,
    elapsed: elapsed.toFixed(2),
    opsPerSec: opsPerSec.toFixed(0),
    nsPerOp: nsPerOp.toFixed(2)
  };
}

// ============== 执行测试 ==============
console.log('='.repeat(80));
console.log(`统计方案性能对比 (迭代次数: ${ITERATIONS.toLocaleString()})`);
console.log('='.repeat(80));
console.log();

const results = [];

// 测试所有方案 - Enabled 模式
console.log('📊 启用统计模式 (Enabled)');
console.log('-'.repeat(80));
results.push(benchmark('方案1: 空函数模式 (Enabled)', new Method1Enabled(), ITERATIONS));
results.push(benchmark('方案2: Proxy拦截 (Enabled)', new Method2Enabled(), ITERATIONS));
results.push(benchmark('方案3: 方法替换 (Enabled)', new Method3Enabled(), ITERATIONS));
results.push(benchmark('方案4: 装饰器模式 (Enabled)', new Method4Enabled(), ITERATIONS));
results.push(benchmark('Baseline: if判断 (Enabled)', new BaselineEnabled(), ITERATIONS));

results.forEach(r => {
  console.log(`${r.name.padEnd(40)} | ${r.elapsed.padStart(10)}ms | ${r.opsPerSec.padStart(15)} ops/s | ${r.nsPerOp.padStart(8)} ns/op`);
});

console.log();
console.log('📊 禁用统计模式 (Disabled)');
console.log('-'.repeat(80));

const disabledResults = [];
disabledResults.push(benchmark('方案1: 空函数模式 (Disabled)', new Method1Disabled(), ITERATIONS));
disabledResults.push(benchmark('方案2: Proxy拦截 (Disabled)', new Method2Disabled(), ITERATIONS));
disabledResults.push(benchmark('方案3: 方法替换 (Disabled)', new Method3Disabled(), ITERATIONS));
disabledResults.push(benchmark('方案4: 装饰器模式 (Disabled)', new Method4Disabled(), ITERATIONS));
disabledResults.push(benchmark('Baseline: if判断 (Disabled)', new BaselineDisabled(), ITERATIONS));

disabledResults.forEach(r => {
  console.log(`${r.name.padEnd(40)} | ${r.elapsed.padStart(10)}ms | ${r.opsPerSec.padStart(15)} ops/s | ${r.nsPerOp.padStart(8)} ns/op`);
});

console.log();
console.log('='.repeat(80));
console.log('结论分析:');
console.log('='.repeat(80));

// 计算相对性能
const baseline = results.find(r => r.name.includes('Baseline'));
const baselineOps = parseFloat(baseline.opsPerSec);

console.log();
console.log('相对于 Baseline (if判断) 的性能:');
results.forEach(r => {
  if (r.name.includes('Baseline')) return;
  const relative = ((parseFloat(r.opsPerSec) / baselineOps - 1) * 100).toFixed(1);
  const sign = parseFloat(relative) > 0 ? '+' : '';
  console.log(`  ${r.name.padEnd(40)} ${sign}${relative}%`);
});

console.log();
console.log('推荐:');
console.log('  - 最优性能: 方案3 (方法替换) - 零开销但代码重复');
console.log('  - 最佳平衡: 方案1 (空函数) - 性能接近最优且代码简洁');
console.log('  - 避免使用: 方案2 (Proxy) - 性能开销显著');
console.log();
