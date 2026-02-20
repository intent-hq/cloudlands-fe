#!/usr/bin/env node

/**
 * Post-build script to rename mcp-stdio-server.js to .cjs
 * This ensures it's treated as CommonJS regardless of package.json type
 */

import { renameSync, existsSync, unlinkSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const sourceFile = join(projectRoot, 'dist/main/mcp-stdio-server.js');
const targetFile = join(projectRoot, 'dist/main/mcp-stdio-server.cjs');

// Also handle the declaration files
const sourceDts = join(projectRoot, 'dist/main/mcp-stdio-server.d.ts');
const targetDts = join(projectRoot, 'dist/main/mcp-stdio-server.d.cts');

const sourceMap = join(projectRoot, 'dist/main/mcp-stdio-server.js.map');
const targetMap = join(projectRoot, 'dist/main/mcp-stdio-server.cjs.map');

const sourceDtsMap = join(projectRoot, 'dist/main/mcp-stdio-server.d.ts.map');
const targetDtsMap = join(projectRoot, 'dist/main/mcp-stdio-server.d.cts.map');

/**
 * Rename a file with retry logic for Windows file locking issues
 * Falls back to copy+delete if rename fails
 */
function safeRename(source, target, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Try to delete target if it exists
      if (existsSync(target)) {
        unlinkSync(target);
      }
      renameSync(source, target);
      return true;
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
        if (i < maxRetries - 1) {
          // Wait a bit and retry
          const delay = 100 * (i + 1);
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
          continue;
        }
        // Last attempt: try copy + delete
        try {
          copyFileSync(source, target);
          unlinkSync(source);
          return true;
        } catch (copyErr) {
          throw err; // Throw original error
        }
      }
      throw err;
    }
  }
  return false;
}

console.log('Renaming MCP server files to .cjs extension...');

// Rename main file
if (existsSync(sourceFile)) {
  safeRename(sourceFile, targetFile);
  console.log('✓ Renamed mcp-stdio-server.js to mcp-stdio-server.cjs');
} else {
  console.error('✗ Source file not found:', sourceFile);
  process.exit(1);
}

// Rename declaration file if it exists
if (existsSync(sourceDts)) {
  safeRename(sourceDts, targetDts);
  console.log('✓ Renamed mcp-stdio-server.d.ts to mcp-stdio-server.d.cts');
}

// Rename source map if it exists
if (existsSync(sourceMap)) {
  safeRename(sourceMap, targetMap);
  console.log('✓ Renamed mcp-stdio-server.js.map to mcp-stdio-server.cjs.map');
}

// Rename declaration map if it exists
if (existsSync(sourceDtsMap)) {
  safeRename(sourceDtsMap, targetDtsMap);
  console.log('✓ Renamed mcp-stdio-server.d.ts.map to mcp-stdio-server.d.cts.map');
}

console.log('✅ MCP server files renamed successfully');
