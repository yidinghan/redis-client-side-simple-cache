#!/usr/bin/env node

const redis = require('redis');

async function testConnection() {
  const client = redis.createClient({
    socket: {
      host: 'localhost',
      port: 6379
    }
  });

  try {
    console.log('Connecting to Redis at localhost:6379...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const pong = await client.ping();
    console.log('✅ PING response:', pong);
    
    await client.quit();
    console.log('✅ Connection test passed!\n');
    console.log('You can now run the demo:');
    console.log('  Terminal 1: npm run worker');
    console.log('  Terminal 2: npm run master');
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('\nPlease ensure:');
    console.error('  1. Redis is running on localhost:6379');
    console.error('  2. Redis version >= 6.0 (for client-side caching)');
    process.exit(1);
  }
}

testConnection();
