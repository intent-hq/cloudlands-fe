import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { collectUsedMessageKeys } from './i18n-used-message-keys.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = path.join(repositoryRoot, 'src/shared/paraglide');
const outputRoot = path.join(repositoryRoot, 'static/generated');
const temporaryRoot = path.join(repositoryRoot, '.svelte-kit/i18n-bundle');
const catalog = JSON.parse(readFileSync(path.join(repositoryRoot, 'messages/en.json'), 'utf8'));

const usedMessageKeys = collectUsedMessageKeys(
  path.join(repositoryRoot, 'src'),
  new Set(Object.keys(catalog)),
);
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
