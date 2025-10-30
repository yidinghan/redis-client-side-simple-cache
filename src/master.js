const redis = require('redis');
const readline = require('readline');

// Master 进程 - 负责写入数据
class CacheMaster {
  constructor() {
    this.client = null;
    this.writeCount = 0;
  }

  async connect() {
    this.client = redis.createClient({
      socket: {
        host: 'localhost',
        port: 6379
      }
    });

    await this.client.connect();
    console.log('✅ Master connected to Redis');
  }

  async set(key, value) {
    await this.client.set(key, value);
    this.writeCount++;
    console.log(`[Master] ✍️  Written "${key}" = "${value}" (Write #${this.writeCount})`);
  }

  async incr(key) {
    const newValue = await this.client.incr(key);
    this.writeCount++;
    console.log(`[Master] ✍️  Incremented "${key}" to ${newValue} (Write #${this.writeCount})`);
    return newValue;
  }

  async del(key) {
    await this.client.del(key);
    this.writeCount++;
    console.log(`[Master] 🗑️  Deleted "${key}" (Write #${this.writeCount})`);
  }

  async disconnect() {
    await this.client.quit();
  }
}

// 交互式演示
async function interactiveDemo() {
  const master = new CacheMaster();
  
  try {
    await master.connect();
    
    console.log('\n=== Master Process - Write Operations ===\n');
    console.log('Commands:');
    console.log('  set <key> <value>  - Set a key-value pair');
    console.log('  incr <key>         - Increment a counter');
    console.log('  del <key>          - Delete a key');
    console.log('  auto               - Start auto-update mode');
    console.log('  quit               - Exit\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'master> '
    });

    let autoMode = null;

    rl.prompt();

    rl.on('line', async (line) => {
      const parts = line.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase();

      try {
        switch (command) {
          case 'set':
            if (parts.length < 3) {
              console.log('Usage: set <key> <value>');
            } else {
              const key = parts[1];
              const value = parts.slice(2).join(' ');
              await master.set(key, value);
            }
            break;

          case 'incr':
            if (parts.length < 2) {
              console.log('Usage: incr <key>');
            } else {
              await master.incr(parts[1]);
            }
            break;

          case 'del':
            if (parts.length < 2) {
              console.log('Usage: del <key>');
            } else {
              await master.del(parts[1]);
            }
            break;

          case 'auto':
            if (autoMode) {
              console.log('Auto mode already running. Type "stop" to stop it.');
            } else {
              console.log('🤖 Starting auto-update mode (updating every 5 seconds)...');
              console.log('   Type "stop" to stop auto mode\n');
              
              let counter = 0;
              autoMode = setInterval(async () => {
                try {
                  counter++;
                  await master.set('user:1000:name', `User_${counter}`);
                  await master.set('user:1000:email', `user${counter}@example.com`);
                  await master.incr('counter');
                  console.log(`🔄 Auto-update cycle #${counter} completed\n`);
                } catch (error) {
                  console.error('Error in auto mode:', error.message);
                }
              }, 5000);
            }
            break;

          case 'stop':
            if (autoMode) {
              clearInterval(autoMode);
              autoMode = null;
              console.log('🛑 Auto mode stopped\n');
            } else {
              console.log('Auto mode is not running.');
            }
            break;

          case 'quit':
          case 'exit':
            if (autoMode) {
              clearInterval(autoMode);
            }
            console.log('\n👋 Goodbye!');
            await master.disconnect();
            process.exit(0);
            break;

          case '':
            break;

          default:
            console.log(`Unknown command: ${command}`);
            console.log('Type "set", "incr", "del", "auto", or "quit"');
        }
      } catch (error) {
        console.error('Error:', error.message);
      }

      rl.prompt();
    });

    rl.on('close', async () => {
      if (autoMode) {
        clearInterval(autoMode);
      }
      console.log('\n👋 Goodbye!');
      await master.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error:', error);
    await master.disconnect();
    process.exit(1);
  }
}

// 自动演示模式
async function autoDemo() {
  const master = new CacheMaster();
  
  try {
    await master.connect();
    
    console.log('\n=== Auto Demo Mode ===\n');
    console.log('Initializing data...\n');
    
    // 初始化数据
    await master.set('user:1000:name', 'Alice');
    await master.set('user:1000:email', 'alice@example.com');
    await master.set('counter', '0');
    
    console.log('\nStarting periodic updates every 8 seconds...');
    console.log('Press Ctrl+C to stop.\n');
    
    let cycle = 0;
    const updateInterval = setInterval(async () => {
      try {
        cycle++;
        console.log(`\n--- Update Cycle #${cycle} ---`);
        await master.set('user:1000:name', `User_${cycle}`);
        await master.set('user:1000:email', `user${cycle}@example.com`);
        await master.incr('counter');
      } catch (error) {
        console.error('Error during update:', error.message);
      }
    }, 8000);

    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down master...');
      clearInterval(updateInterval);
      console.log(`Total writes: ${master.writeCount}`);
      await master.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error:', error);
    await master.disconnect();
    process.exit(1);
  }
}

// 根据命令行参数选择模式
if (require.main === module) {
  const mode = process.argv[2];
  
  if (mode === 'auto') {
    autoDemo();
  } else {
    interactiveDemo();
  }
}

module.exports = CacheMaster;
