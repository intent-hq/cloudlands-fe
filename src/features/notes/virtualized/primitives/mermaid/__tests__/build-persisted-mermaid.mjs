// TEST ONLY build composition; never modifies the frozen host worktree.
import assert from 'node:assert/strict';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const expect = (value) => ({ toBe: (expected) => assert.equal(value, expected) });
const owned = 'src/features/notes/virtualized/primitives/mermaid/__tests__';
let evidence, renderer, manager;

if (
  !process.env.MERMAID_PERSISTED_EVIDENCE ||
  !process.env.MERMAID_FROZEN_HOST_ROOT ||
  !process.env.MERMAID_FROZEN_HOST_SHA
)
  throw new Error('Explicit evidence, frozen host root and pinned test host SHA required');
evidence = resolve(process.env.MERMAID_PERSISTED_EVIDENCE);
const frozen = resolve(process.env.MERMAID_FROZEN_HOST_ROOT);
const git = (...args) => execFileSync('git', ['-C', frozen, ...args], { encoding: 'utf8' }).trim();
expect(git('rev-parse', 'HEAD')).toBe(process.env.MERMAID_FROZEN_HOST_SHA);
expect(git('status', '--porcelain')).toBe('');
const inputs = git(
  'ls-files',
  'src/features/notes/primitive-host',
  'src/preload/primitive-host.ts',
  'src/app.css',
  'src/lib/styles',
  'package.json',
  'pnpm-lock.yaml',
).split('\n');
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const sourceHashes = Object.fromEntries(
  await Promise.all(inputs.map(async (file) => [file, await hash(join(frozen, file))])),
);
const installedLock = await hash(join(frozen, 'node_modules/.pnpm/lock.yaml'));
expect(installedLock).toBe(sourceHashes['pnpm-lock.yaml']);
renderer = join(evidence, 'renderer');
manager = join(evidence, 'manager/host.cjs');
await mkdir(evidence, { recursive: true });
await writeFile(
  join(evidence, 'frozen-host-sources.json'),
  JSON.stringify(
    { head: process.env.MERMAID_FROZEN_HOST_SHA, sources: sourceHashes, installedLock },
    null,
    2,
  ),
);
const registry = join(evidence, 'registry.ts');
await writeFile(
  registry,
  `export { adapters } from ${JSON.stringify(resolve(owned, 'persisted-mermaid-adapter.ts'))};`,
);
// Compile frozen public host sources into OWN evidence directory; never edit host build/cache.
await build({
  configFile: false,
  root: join(frozen, 'src/features/notes/primitive-host/renderer'),
  base: './',
  logLevel: 'warn',
  cacheDir: join(evidence, 'vite-cache'),
  worker: { format: 'es' },
  plugins: [svelte({ configFile: resolve('svelte.config.js') })],
  css: { postcss: { plugins: [tailwindcss(), autoprefixer()] } },
  resolve: {
    alias: [
      { find: './adapters', replacement: registry },
      { find: '$lib', replacement: resolve('src/lib') },
      { find: '$shared', replacement: resolve('src/shared') },
      { find: '$app', replacement: resolve('playwright/app-stubs') },
      {
        find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
        replacement: resolve('src/lib/icons/phosphor-icons.ts'),
      },
      { find: /^svelte-fa$/, replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts') },
    ],
  },
  build: { outDir: renderer, emptyOutDir: false },
});
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: renderer,
    emptyOutDir: false,
    lib: {
      entry: join(frozen, 'src/preload/primitive-host.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: { external: ['electron'] },
  },
});
await build({
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true },
  build: {
    ssr: join(frozen, 'src/features/notes/primitive-host/main/construction-host.ts'),
    outDir: join(evidence, 'manager'),
    emptyOutDir: false,
    rollupOptions: {
      external: (id) => id === 'electron' || id.startsWith('node:'),
      output: { format: 'cjs', entryFileNames: 'host.cjs' },
    },
  },
});
const files = [manager];
async function assets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await assets(file);
    else files.push(file);
  }
}
await assets(renderer);
await writeFile(
  join(evidence, 'built-hashes.json'),
  JSON.stringify(
    Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [
          file,
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ]),
      ),
    ),
    null,
    2,
  ),
);
expect(git('rev-parse', 'HEAD')).toBe(process.env.MERMAID_FROZEN_HOST_SHA);
expect(git('status', '--porcelain')).toBe('');
for (const file of inputs) expect(await hash(join(frozen, file)), file).toBe(sourceHashes[file]);
