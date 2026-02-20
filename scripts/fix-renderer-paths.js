#!/usr/bin/env node
/**
 * Fix Renderer Paths for Electron
 *
 * With the app:// protocol, we use absolute paths (starting with /)
 * This ensures that when refreshing on a nested route like /workspace/abc123,
 * the asset paths still resolve correctly.
 *
 * The app:// protocol handler serves files from dist/renderer,
 * so /app/immutable/... maps to dist/renderer/app/immutable/...
 *
 * Since we set `base: '/'` in vite.config.mjs and `relative: false` in svelte.config.js,
 * paths should already be absolute. This script just verifies and fixes any edge cases.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const htmlPath = path.join(__dirname, '../dist/renderer/index.html');

if (!fs.existsSync(htmlPath)) {
  console.error(`❌ HTML file not found: ${htmlPath}`);
  process.exit(1);
}

let html = fs.readFileSync(htmlPath, 'utf-8');

// Ensure all asset paths are absolute (start with /)
// Convert any relative ./app/ paths to absolute /app/ paths (just in case)
html = html.replace(/href="\.\/app\//g, 'href="/app/');
html = html.replace(/import\("\.\/app\//g, 'import("/app/');
html = html.replace(/src="\.\/app\//g, 'src="/app/');

// Also fix favicon path if it's relative
html = html.replace(/href="\.\/favicon/g, 'href="/favicon');

fs.writeFileSync(htmlPath, html);

console.log('✅ Verified renderer paths for Electron app:// protocol');
