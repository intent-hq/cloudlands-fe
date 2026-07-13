/**
 * Global Setup for E2E Tests
 *
 * Prepares the test environment before running any tests
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const TEST_DIRS = [
  '.test-workspaces',
  '.test-workspaces-multi',
  '.test-workspaces-error',
  '.test-workspaces-perf',
  'e2e-reports',
];

async function globalSetup() {
  console.log('🚀 Starting E2E test global setup...');

  // Clean up any leftover test directories
  for (const dir of TEST_DIRS) {
    const fullPath = path.join(process.cwd(), dir);
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      console.log(`  ✓ Cleaned up ${dir}`);
    } catch (e) {
      // Directory might not exist
    }
  }

  // Create fresh test directories
  for (const dir of TEST_DIRS) {
    const fullPath = path.join(process.cwd(), dir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`  ✓ Created ${dir}`);
    } catch (e) {
      console.error(`  ✗ Failed to create ${dir}:`, e);
    }
  }

  // Build the application if needed
  if (process.env.BUILD_BEFORE_TEST === 'true') {
    console.log('📦 Building application...');
    await new Promise<void>((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build'], {
        stdio: 'inherit',
        shell: true,
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('  ✓ Build completed successfully');
          resolve();
        } else {
          reject(new Error(`Build failed with code ${code}`));
        }
      });

      buildProcess.on('error', (err) => {
        reject(err);
      });
    });
  }

  // Check if Electron binary exists
  const electronPath = path.join(process.cwd(), 'node_modules/.bin/electron');
  try {
    await fs.access(electronPath);
    console.log('  ✓ Electron binary found');
  } catch (e) {
    console.error('  ✗ Electron binary not found. Run npm install first.');
    throw new Error('Electron binary not found');
  }

  // Check if main process entry exists
  const mainPath = path.join(process.cwd(), 'dist/main/index.js');
  try {
    await fs.access(mainPath);
    console.log('  ✓ Main process entry found');
  } catch (e) {
    console.error('  ✗ Main process entry not found. Run npm run build first.');
    throw new Error('Main process entry not found');
  }

  // Set up environment variables
  process.env.NODE_ENV = 'test';
  process.env.TESTING = 'true';
  process.env.E2E_TESTING = 'true';

  // Kill any existing Electron processes
  console.log('🧹 Cleaning up existing processes...');
  try {
    await killExistingProcesses();
    console.log('  ✓ Cleaned up existing processes');
  } catch (e) {
    console.warn('  ⚠ Could not clean up processes:', e);
  }

  console.log('✅ Global setup completed\n');
}

async function killExistingProcesses() {
  return new Promise<void>((resolve) => {
    const isWindows = process.platform === 'win32';
    const killProcess = isWindows
      ? spawn('taskkill', ['/F', '/IM', 'electron.exe'], {
          stdio: 'ignore',
          shell: true,
          windowsHide: true,
        })
      : spawn('pkill', ['-9', '-f', 'electron.*dist/main/index.js'], {
          stdio: 'ignore',
          shell: true,
        });

    killProcess.on('close', () => {
      // Wait a bit for processes to fully terminate
      setTimeout(resolve, 1000);
    });

    killProcess.on('error', () => {
      // Ignore errors (process might not exist)
      resolve();
    });
  });
}

export default globalSetup;
