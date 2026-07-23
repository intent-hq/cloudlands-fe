#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the index.html file
const indexPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');

  // Remove the entire Vite client import script block more aggressively
  html = html.replace(
    /<script type="module">[\s\S]*?\/\/@vite\/client[\s\S]*?<\/script>/g,
    '',
  );

  // Also remove the specific pattern we see in the HTML
  html = html.replace(
    /<script type="module">[\s\S]*?import\('\/@vite\/client'\)[\s\S]*?<\/script>/g,
    '',
  );

  // Remove any references to .ts files in the HTML
  html = html.replace(/\.ts"/g, '.js"');

  // Collect inline script hashes so we can remove unsafe-inline/unsafe-eval in production
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const inlineScripts = [];
  let match;

  while ((match = scriptTagRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/.test(attrs)) {
      continue;
    }

    const scriptContent = match[2] || '';
    if (!scriptContent.trim()) {
      continue;
    }

    inlineScripts.push(scriptContent);
  }

  const scriptHashes = inlineScripts.map((content) =>
    crypto.createHash('sha256').update(content, 'utf8').digest('base64'),
  );

  if (scriptHashes.length > 0) {
    html = html.replace(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/i,
      (fullMatch, content) => {
        const directives = content
          .split(';')
          .map((directive) => directive.trim())
          .filter(Boolean);

        const updatedDirectives = directives.map((directive) => {
          const parts = directive.split(/\s+/);
          const name = parts.shift();
          if (name !== 'script-src') {
            return directive;
          }

          const filtered = parts.filter(
            (value) => value !== "'unsafe-inline'" && value !== "'unsafe-eval'",
          );
          const withHashes = [...filtered, ...scriptHashes.map((hash) => `'sha256-${hash}'`)];
          const deduped = [...new Set(withHashes)];
          return `${name} ${deduped.join(' ')}`;
        });

        const hasScriptSrc = directives.some((directive) => directive.startsWith('script-src'));
        if (!hasScriptSrc) {
          const hashValues = scriptHashes.map((hash) => `'sha256-${hash}'`).join(' ');
          updatedDirectives.push(`script-src 'self' ${hashValues}`);
        }

        return fullMatch.replace(content, `${updatedDirectives.join('; ')};`);
      },
    );
  }

  // Write the cleaned HTML back
  fs.writeFileSync(indexPath, html);
  console.log('✅ Fixed production HTML - removed Vite client import');
} else {
  console.log('⚠️ index.html not found at:', indexPath);
}
