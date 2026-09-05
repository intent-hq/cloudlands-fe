import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      '(app)/workspace/new/+page.svelte',
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
    const rootLayout = readFileSync(path.join(outputRoot, '+layout.svelte'), 'utf8');
    expect(rootLayout).toContain('import RouteComponent from');
    expect(rootLayout).toContain('{@render children?.()}');
    expect(readFileSync(path.join(outputRoot, '+layout.ts'), 'utf8')).toContain('export * from');
    expect(existsSync(path.join(outputRoot, 'sandbox/+page.svelte'))).toBe(false);
    expect(existsSync(path.join(outputRoot, '(app)/workspace/[id]/terminal-test'))).toBe(false);
  });

  it('uses canonical source routes in development without generating an alternate tree', () => {
    const outputRoot = temporaryDirectory();

    expect(resolveRoutesDirectory({ production: false, sourceRoot: routesRoot, outputRoot })).toBe(
      routesRoot,
    );
    expect(existsSync(outputRoot)).toBe(false);
  });
});
