#!/usr/bin/env node

/**
 * Postinstall script for Electron Workspaces
 *
 * This script handles:
 * 1. Electron installation cleanup
 * 2. Native module rebuilding for Electron
 * 3. Icon generation (if available)
 *
 * Unlike the inline postinstall command, this script provides better error handling
 * and logging to help diagnose issues during installation.
 *
 * Usage:
 *   node postinstall.js [--verbose]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || process.env.VERBOSE === 'true';

// Logging utilities
const log = {
  info: (msg) => console.log(msg),
  verbose: (msg) => verbose && console.log(`  ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  success: (msg) => console.log(`✅ ${msg}`),
};

log.info('🔧 Running postinstall tasks...');

// Step 1: Clean up Electron installation
try {
  const electronDir = path.join(rootDir, 'node_modules', 'electron');
  if (fs.existsSync(electronDir)) {
    log.info('📦 Cleaning up Electron installation...');
    log.verbose('Cleaning up Electron installation...');
    const electronDistDir = path.join(electronDir, 'dist');
    if (fs.existsSync(electronDistDir)) {
      fs.rmSync(electronDistDir, { recursive: true, force: true });
      log.verbose('Removed electron dist directory');
    }

    const electronInstallScript = path.join(electronDir, 'install.js');
    if (fs.existsSync(electronInstallScript)) {
      execSync('node install.js', {
        cwd: electronDir,
        stdio: verbose ? 'inherit' : 'ignore',
      });
    }
    log.success('Electron cleanup complete');
  }
} catch (error) {
  log.warn(`Electron cleanup failed (non-critical): ${error.message}`);
}

// Step 2: Rebuild native modules for Electron
try {
  log.info('🔨 Rebuilding native modules for Electron...');

  // Check which native modules need rebuilding
  const modulesToRebuild = [];
  const nativeModules = ['node-pty'];

  for (const module of nativeModules) {
    const modulePath = path.join(rootDir, 'node_modules', module);
    if (fs.existsSync(modulePath)) {
      modulesToRebuild.push(module);
    }
  }

  if (modulesToRebuild.length > 0) {
    log.verbose(`Found native modules: ${modulesToRebuild.join(', ')}`);

    // Use @electron/rebuild with specific modules
    const rebuildCmd = `npx @electron/rebuild -f -o ${modulesToRebuild.join(',')}`;
    log.verbose(`Running: ${rebuildCmd}`);

    execSync(rebuildCmd, {
      cwd: rootDir,
      stdio: verbose ? 'inherit' : 'ignore',
      timeout: 300000, // 5 minutes timeout
    });

    log.success('Native modules rebuilt successfully');
  } else {
    log.verbose('No native modules found to rebuild');
  }
} catch (error) {
  log.error(`Native module rebuild failed: ${error.message}`);

  if (verbose) {
    // Provide helpful troubleshooting information
    log.info('\n🔍 Troubleshooting tips:');
    log.info('1. Make sure you have build tools installed:');
    log.info('   - macOS: xcode-select --install');
    log.info('   - Windows: npm install -g windows-build-tools');
    log.info('   - Linux: sudo apt-get install build-essential');
    log.info('2. Try running manually: npx @electron/rebuild -f -o node-pty');
    log.info('3. Check that Python is available in your PATH');
  }

  // Don't exit with error - let the installation continue
  log.warn('Continuing installation despite rebuild failure...');
}

// Step 3: Patch Electron app name for macOS development
if (process.platform === 'darwin') {
  try {
    log.info('🏷️  Patching Electron app name for macOS...');
    execSync('node scripts/patch-electron-name.js', {
      cwd: rootDir,
      stdio: verbose ? 'inherit' : 'ignore',
    });
  } catch (error) {
    log.warn(`Electron name patch failed (non-critical): ${error.message}`);
  }
}

log.info('🎉 Postinstall tasks completed!');

// Verify that critical native modules are working
async function verifyModules() {
  try {
    log.info('🔍 Verifying native modules...');

    // Test node-pty
    try {
      await import('node-pty');
      log.success('node-pty is working');
    } catch (error) {
      log.warn(`node-pty verification failed: ${error.message}`);
    }

  } catch (error) {
    log.warn(`Module verification failed: ${error.message}`);
  }
}

// Run verification
verifyModules().catch(error => {
  log.warn(`Module verification error: ${error.message}`);
});
