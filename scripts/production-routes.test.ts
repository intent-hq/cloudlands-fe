import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isInternalRouteFile,
  listProductionRouteFiles,
  prepareProductionRoutes,
  readProductionRouteManifest,
  resolveRoutesDirectory,
} from './production-routes.mjs';

const temporaryDirectories: string[] = [];
const routesRoot = path.resolve('src/routes');

function temporaryDirectory() {
  const directory = path.join(os.tmpdir(), `intent-production-routes-${crypto.randomUUID()}`);
  temporaryDirectories.push(directory);
  return directory;
}

// The canonical source a generated wrapper delegates to, resolved from its own location.
function wrapperTarget(outputRoot: string, routeFile: string) {
  const wrapperFile = path.join(outputRoot, routeFile);
  const wrapper = readFileSync(wrapperFile, 'utf8');
  const specifier = wrapper.match(/\bfrom\s+"([^"]+)"/)?.[1];
  expect(specifier, `${routeFile} wrapper must import its source`).toBeDefined();
  return { wrapper, target: path.resolve(path.dirname(wrapperFile), specifier!) };
}

// What a module route file exports once loaded, keyed by export name with
// functions replaced by their return value. Loaded by a plain Node process:
// the fixture lives outside the vitest root, which its module runner refuses.
function moduleExports(file: string): Record<string, unknown> {
  const script = `import(${JSON.stringify(pathToFileURL(file).href)}).then((module) => {
    const entries = Object.keys(module).sort().map((name) => {
      const value = module[name];
      return [name, typeof value === 'function' ? value() : value];
    });
    process.stdout.write(JSON.stringify(Object.fromEntries(entries)));
  });`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('production route graph', () => {
  it('keeps every product route entry and excludes only internal route trees', () => {
    const routeFiles = listProductionRouteFiles(routesRoot);

    expect(routeFiles).toEqual([
      '(app)/+error.svelte',
      '(app)/+layout.svelte',
      '(app)/+page.svelte',
      '(app)/agent/[id]/+page.svelte',
      '(app)/settings/+page.svelte',
      '(app)/workspace/[id]/+page.svelte',
      '(app)/workspace/[id]/files/+page.svelte',
      '(app)/workspace/creating/+page.svelte',
      '+error.svelte',
      '+layout.svelte',
      '+layout.ts',
      'hud/+layout.svelte',
      'hud/+page.svelte',
    ]);
    expect(routeFiles.some(isInternalRouteFile)).toBe(false);
    expect(existsSync(path.join(routesRoot, 'sandbox/+page.svelte'))).toBe(true);
    expect(existsSync(path.join(routesRoot, '(app)/test-monaco/+page.svelte'))).toBe(true);
  });

  it('generates a production manifest and wrappers that import the canonical sources', () => {
    const outputRoot = temporaryDirectory();
    prepareProductionRoutes({ sourceRoot: routesRoot, outputRoot });

    const routeFiles = listProductionRouteFiles(routesRoot);
    expect(readProductionRouteManifest(outputRoot)).toEqual(routeFiles);
    for (const routeFile of routeFiles) {
      const { wrapper, target } = wrapperTarget(outputRoot, routeFile);
      expect(target, routeFile).toBe(path.join(routesRoot, routeFile));
      expect(wrapper.includes('{@render children'), routeFile).toBe(
        path.basename(routeFile) === '+layout.svelte',
      );
    }
    expect(existsSync(path.join(outputRoot, 'sandbox/+page.svelte'))).toBe(false);
    expect(existsSync(path.join(outputRoot, '(app)/workspace/[id]/terminal-test'))).toBe(false);
  });

  it('generates module wrappers that expose every export of their source', () => {
    const root = temporaryDirectory();
    const sourceRoot = path.join(root, 'src/routes');
    const outputRoot = path.join(root, 'production-routes');
    const modules = {
      '+layout.ts':
        "export const ssr = false;\nexport function load() {\n  return { route: 'root' };\n}\n",
      'nested/+page.ts':
        "export const prerender = true;\nexport const load = () => ({ route: 'nested' });\n",
    };
    for (const [routeFile, source] of Object.entries(modules)) {
      mkdirSync(path.dirname(path.join(sourceRoot, routeFile)), { recursive: true });
      writeFileSync(path.join(sourceRoot, routeFile), source);
    }
    prepareProductionRoutes({ sourceRoot, outputRoot });

    for (const routeFile of Object.keys(modules)) {
      const source = moduleExports(path.join(sourceRoot, routeFile));
      expect(Object.keys(source), routeFile).toContain('load');
      expect(moduleExports(path.join(outputRoot, routeFile)), routeFile).toEqual(source);
    }
  });

  it('uses canonical source routes in development without generating an alternate tree', () => {
    const outputRoot = temporaryDirectory();

    expect(resolveRoutesDirectory({ production: false, sourceRoot: routesRoot, outputRoot })).toBe(
      routesRoot,
    );
    expect(existsSync(outputRoot)).toBe(false);
  });
});
