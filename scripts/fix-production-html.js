#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hardenProductionScriptCsp, injectParaglideBundle } from './fix-production-html-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the index.html file
const indexPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Remove the entire Vite client import script block more aggressively
  html = html.replace(/<script type="module">[\s\S]*?\/\/@vite\/client[\s\S]*?<\/script>/g, '');

  // Also remove the specific pattern we see in the HTML
  html = html.replace(
    /<script type="module">[\s\S]*?import\('\/@vite\/client'\)[\s\S]*?<\/script>/g,
    '',
  );

  // Remove any references to .ts files in the HTML
  html = html.replace(/\.ts"/g, '.js"');

  // The production app imports a tiny facade backed by this prebuilt catalog.
  // Inject it before the app bootstrap so localized module constants are ready.
  html = injectParaglideBundle(html);

  // Production Electron and web output share the same strict script policy.
  html = hardenProductionScriptCsp(html);

  // Write the cleaned HTML back
  fs.writeFileSync(indexPath, html);
  console.log('✅ Fixed production HTML - removed Vite client import');
} else {
  console.log('⚠️ index.html not found at:', indexPath);
}
