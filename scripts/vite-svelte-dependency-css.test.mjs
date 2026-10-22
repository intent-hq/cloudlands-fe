// @vitest-environment node
// @verify-changed-triggers: package.json, pnpm-lock.yaml, svelte.config.js, postcss.config.mjs
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createServer, normalizePath } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import {
  canonicalSvelteDependencyId,
  svelteDependencyCss,
} from '../test/vite-svelte-dependency-css.mjs';

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

it('loads the real unbundled Toaster stylesheet through the emitted virtual CSS URL', async () => {
  const root = process.cwd();
  const cacheDir = await mkdtemp(path.join(await realpath(tmpdir()), 'svelte-css-'));
  cleanups.push(() => rm(cacheDir, { recursive: true, force: true }));
  const server = await createServer({
    configFile: false,
    root,
    cacheDir,
    logLevel: 'silent',
    plugins: [svelteDependencyCss(), svelte({ configFile: path.resolve('svelte.config.js') })],
    server: { middlewareMode: true, watch: null, preTransformRequests: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  cleanups.push(() => server.close());
  const filename = normalizePath(await realpath('node_modules/svelte-sonner/dist/Toaster.svelte'));
  const component = await server.transformRequest(`/@fs/${filename}`);
  expect(component.code).toContain('export default Toaster');
  const cssUrl = component.code.match(/["']([^"']+[?&]svelte&type=style[^"']*)["']/)?.[1];
  expect(cssUrl).toBeTruthy();
  const css = await server.transformRequest(cssUrl);
  expect(css.code).toContain('[data-sonner-toaster]');
  expect(css.code).toMatch(/position:\s*fixed/);
  expect(css.code).not.toContain('<script');
  expect((await server.moduleGraph.getModuleByUrl(`/@fs/${filename}`)).id).toBe(filename);
  const styleQuery = '?svelte&type=style&lang.css&flag=a%20b';
  const resolvedStyle = await server.pluginContainer.resolveId(`${filename}${styleQuery}&v=123`);
  expect(resolvedStyle.id).toBe(filename + styleQuery);
  const ordinaryDependency = await server.pluginContainer.resolveId(
    `${path.dirname(filename)}/index.js?v=123&flag=a%20b`,
  );
  expect(ordinaryDependency.id).toContain('index.js?v=123&flag=a%20b');
});

it('removes only optimizer versions and preserves virtual stylesheet queries byte for byte', () => {
  for (const [id, expected] of [
    ['/node_modules/a/A.svelte?v=123', '/node_modules/a/A.svelte'],
    ['/node_modules/a/A.svelte?v=123#fragment', '/node_modules/a/A.svelte#fragment'],
    [
      '/node_modules/a/A.svelte?x=a%26b&v=123#fragment',
      '/node_modules/a/A.svelte?x=a%26b#fragment',
    ],
    [
      '/node_modules/a/A.svelte?v=123&svelte&type=style&lang.css',
      '/node_modules/a/A.svelte?svelte&type=style&lang.css',
    ],
    [
      '/node_modules/a/A.svelte?flag&v=123&x=a%20b&x=a+b&v=456',
      '/node_modules/a/A.svelte?flag&x=a%20b&x=a+b',
    ],
    ['C:\\repo\\node_modules\\a\\A.svelte?v=123&t=9', 'C:\\repo\\node_modules\\a\\A.svelte?t=9'],
  ]) {
    expect(canonicalSvelteDependencyId(id)).toBe(expected);
    expect(canonicalSvelteDependencyId(expected)).toBe(expected);
  }
});

it('leaves local components, ordinary dependencies and special imports untouched', () => {
  for (const id of [
    '/src/A.svelte?v=123',
    '/node_modules-backup/A.svelte?v=123',
    '/node_modules/a/A.svelte?version=123&value=x',
    '/node_modules/a/index.js?v=123',
    '/node_modules/a/A.svelte?raw&v=123',
    '/node_modules/a/A.svelte?url&v=123',
    '\0virtual/node_modules/a/A.svelte?v=123',
  ])
    expect(canonicalSvelteDependencyId(id)).toBe(id);
});
