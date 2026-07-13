#!/usr/bin/env node
/**
 * Build script for CDP MCP Server
 *
 * Compiles TypeScript to CommonJS and renames to .cjs to work with "type": "module" in package.json
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('Building CDP MCP Server...');

// Step 1: Compile TypeScript to CommonJS
console.log('Compiling TypeScript...');
try {
  execSync(
    'tsc cdp-mcp-server/server.ts --outDir cdp-mcp-server/dist --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck',
    { cwd: rootDir, stdio: 'inherit' },
  );
} catch (error) {
  console.error('TypeScript compilation failed');
  process.exit(1);
}

// Step 2: Rename .js to .cjs
console.log('Renaming .js to .cjs...');
const serverJsPath = path.join(rootDir, 'cdp-mcp-server/dist/server.js');
const serverCjsPath = path.join(rootDir, 'cdp-mcp-server/dist/server.cjs');

if (fs.existsSync(serverJsPath)) {
  fs.renameSync(serverJsPath, serverCjsPath);
  console.log('Renamed server.js to server.cjs');
} else {
  console.error('server.js not found after compilation');
  process.exit(1);
}

// Step 3: Copy cdp-helpers.js
console.log('Copying cdp-helpers.js...');
const helpersSourcePath = path.join(rootDir, 'cdp-mcp-server/cdp-helpers.js');
const helpersDestPath = path.join(rootDir, 'cdp-mcp-server/dist/cdp-helpers.js');

if (fs.existsSync(helpersSourcePath)) {
  fs.copyFileSync(helpersSourcePath, helpersDestPath);
  console.log('Copied cdp-helpers.js');
} else {
  console.error('cdp-helpers.js not found');
  process.exit(1);
}

console.log('✓ CDP MCP Server built successfully');
console.log('  Output: cdp-mcp-server/dist/server.cjs');
