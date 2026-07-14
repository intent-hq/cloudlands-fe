#!/usr/bin/env node

/**
 * Copy resources folder to dist directory for production build
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, '..', 'resources');
const DEST_DIR = path.join(__dirname, '..', 'dist', 'renderer', 'resources');

function copyRecursiveSync(src, dest, excludeDirs = []) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      // Skip excluded directories
      if (excludeDirs.includes(childItemName)) {
        return;
      }
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName),
        excludeDirs,
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Copying resources to dist/renderer/resources...');

try {
  // Skip if source directory doesn't exist
  if (!fs.existsSync(SOURCE_DIR)) {
    console.log('⏭️  No resources directory found, skipping copy');
    process.exit(0);
  }

  // Ensure destination directory exists
  if (!fs.existsSync(path.dirname(DEST_DIR))) {
    fs.mkdirSync(path.dirname(DEST_DIR), { recursive: true });
  }

  // Copy resources, excluding the sidecar directory
  // The sidecar binary is bundled via electron-builder's extraResources,
  // not via the renderer build output.
  copyRecursiveSync(SOURCE_DIR, DEST_DIR, ['sidecar']);

  console.log('✅ Resources copied successfully (excluded sidecar)');
} catch (error) {
  console.error('❌ Failed to copy resources:', error);
  process.exit(1);
}
