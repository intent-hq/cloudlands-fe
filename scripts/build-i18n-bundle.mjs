import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = path.join(repositoryRoot, 'src/shared/paraglide');
const outputRoot = path.join(repositoryRoot, 'static/generated');
const temporaryRoot = path.join(repositoryRoot, '.svelte-kit/i18n-bundle');
const catalog = JSON.parse(readFileSync(path.join(repositoryRoot, 'messages/en.json'), 'utf8'));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

function collectUsedMessageKeys() {
  const catalogKeys = new Set(Object.keys(catalog));
  const usedKeys = new Set();
  for (const file of walk(path.join(repositoryRoot, 'src'))) {
    if (!/\.(?:svelte|ts)$/.test(file) || /(?:__tests__|\.test\.|\.spec\.)/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    if (!source.includes('paraglide/messages.js')) continue;
    for (const match of source.matchAll(/\b(?:m|msg)\.([$A-Z_a-z][$0-9A-Z_a-z]*)/g)) {
      if (catalogKeys.has(match[1])) usedKeys.add(match[1]);
    }
  }
  return [...usedKeys].sort();
}

const usedMessageKeys = collectUsedMessageKeys();
const temporaryEntry = path.join(temporaryRoot, 'entry.mjs');

mkdirSync(outputRoot, { recursive: true });
mkdirSync(temporaryRoot, { recursive: true });
writeFileSync(
  temporaryEntry,
  `import { ${usedMessageKeys.join(', ')} } from ${JSON.stringify(path.join(generatedRoot, 'messages.js'))};\n` +
    `import * as runtime from ${JSON.stringify(path.join(generatedRoot, 'runtime.js'))};\n` +
    `const messages = { ${usedMessageKeys.join(', ')} };\n` +
    `globalThis.__INTENT_PARAGLIDE_I18N__ = { m: messages, messages, runtime };\n`,
);
writeFileSync(
  path.join(temporaryRoot, 'used-message-keys.json'),
  `${JSON.stringify(usedMessageKeys, null, 2)}\n`,
);

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    outDir: outputRoot,
    lib: {
      entry: temporaryEntry,
      formats: ['iife'],
      name: 'IntentParaglideBundle',
      fileName: () => 'paraglide.js',
    },
  },
});
