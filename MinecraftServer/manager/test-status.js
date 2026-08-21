#!/usr/bin/env node
/**
 * Quick test of server status detection functions
 * Run with: node test-status.js
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_ROOT = path.resolve(__dirname, '../');
const SERVER_PID_PATH = path.join(__dirname, '.server.pid');

console.log('Testing server status detection...\n');

// Test 1: Check if port is listening
console.log('Test 1: Checking if port 25565 is listening...');
exec(`netstat -ano | findstr :25565`, (err, stdout) => {
  if (err) {
    console.log('  ✗ netstat failed:', err.message);
  } else if (!stdout) {
    console.log('  ✗ No output from netstat');
  } else {
    console.log('  ✓ Port 25565 is listening:');
    const lines = stdout.split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.log('    ', line.trim());
      const parts = line.trim().split(/\s+/);
      if (parts.length > 0) {
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid) && pid > 0) {
          console.log(`    Extracted PID: ${pid}`);
        }
      }
    });
  }

  // Test 2: Check if java processes exist in server folder
  console.log('\nTest 2: Searching for java.exe processes...');
  exec(`wmic process where "name='java.exe'" get processid,commandline /format:csv`, (err, stdout) => {
    if (err) {
      console.log('  ✗ wmic failed:', err.message);
    } else if (!stdout) {
      console.log('  ✗ No java processes found');
    } else {
      console.log('  ✓ Java processes found:');
      const lines = stdout.split('\n').filter(l => l.trim());
      lines.forEach(line => {
        if (line.includes(SERVER_ROOT)) {
          console.log('    ✓ Found java in server root');
          const parts = line.split(',');
          if (parts.length >= 2) {
            const pid = parseInt(parts[1].trim(), 10);
            if (!isNaN(pid) && pid > 0) {
              console.log(`    PID: ${pid}`);
            }
          }
        }
      });
    }

    // Test 3: Check current PID file
    console.log('\nTest 3: Checking .server.pid file...');
    if (fs.existsSync(SERVER_PID_PATH)) {
      const pid = parseInt(fs.readFileSync(SERVER_PID_PATH, 'utf8').trim(), 10);
      console.log(`  ✓ .server.pid exists with PID: ${pid}`);
    } else {
      console.log('  ✗ .server.pid does not exist');
    }

    console.log('\nDone!');
  });
});
