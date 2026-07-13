#!/usr/bin/env node
/**
 * Cross-platform script to kill Electron processes
 */

import { execSync } from 'child_process';
import { platform } from 'os';

try {
  if (platform() === 'win32') {
    // Windows: Use taskkill to find and kill electron processes
    try {
      execSync('taskkill /F /IM electron.exe', { stdio: 'inherit' });
      console.log('✓ Killed Electron processes');
    } catch (err) {
      // taskkill returns error if no process found, which is fine
      console.log('No Electron processes found');
    }
  } else {
    // Unix-like: Use pkill
    try {
      execSync("pkill -9 -f 'electron.*dist/main/index.js'", { stdio: 'inherit' });
      console.log('✓ Killed Electron processes');
    } catch (err) {
      // pkill returns error if no process found, which is fine
      console.log('No Electron processes found');
    }
  }
} catch (err) {
  console.error('Error killing Electron:', err.message);
  process.exit(0); // Don't fail the script
}

