import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const routesRoot = path.join(root, 'src/routes');
const appRouteFiles = [
  ['(app)/agent/[id]/+page.svelte', '/agent/[id]'],
  ['(app)/settings/+page.svelte', '/settings'],
  ['(app)/test-comments/+page.svelte', '/test-comments'],
  ['(app)/test-error-boundary/+page.svelte', '/test-error-boundary'],
  ['(app)/test-input/+page.svelte', '/test-input'],
  ['(app)/test-mentions/+page.svelte', '/test-mentions'],
  ['(app)/test-mentions/compact/+page.svelte', '/test-mentions/compact'],
  ['(app)/test-monaco/+page.svelte', '/test-monaco'],
  ['(app)/test-workspace-cards/+page.svelte', '/test-workspace-cards'],
  ['(app)/test-workspace-hover-card/+page.svelte', '/test-workspace-hover-card'],
  ['(app)/workspace/[id]/+page.svelte', '/workspace/[id]'],
  ['(app)/workspace/[id]/files/+page.svelte', '/workspace/[id]/files'],
  ['(app)/workspace/[id]/terminal-test/+page.svelte', '/workspace/[id]/terminal-test'],
  ['(app)/workspace/creating/+page.svelte', '/workspace/creating'],
] as const;
const movedAsyncDataBaselinePaths = [
  ['src/routes/+layout.svelte', 'src/routes/(app)/+layout.svelte'],
  ['src/routes/agent/[id]/+page.svelte', 'src/routes/(app)/agent/[id]/+page.svelte'],
  ['src/routes/settings/+page.svelte', 'src/routes/(app)/settings/+page.svelte'],
  ['src/routes/test-comments/+page.svelte', 'src/routes/(app)/test-comments/+page.svelte'],
  [
    'src/routes/test-error-boundary/+page.svelte',
    'src/routes/(app)/test-error-boundary/+page.svelte',
  ],
  ['src/routes/test-input/+page.svelte', 'src/routes/(app)/test-input/+page.svelte'],
  ['src/routes/test-mentions/+page.svelte', 'src/routes/(app)/test-mentions/+page.svelte'],
  [
    'src/routes/test-mentions/compact-initializer-test.svelte',
    'src/routes/(app)/test-mentions/compact-initializer-test.svelte',
  ],
  [
    'src/routes/test-mentions/compact/+page.svelte',
    'src/routes/(app)/test-mentions/compact/+page.svelte',
  ],
  ['src/routes/workspace/[id]/+page.svelte', 'src/routes/(app)/workspace/[id]/+page.svelte'],
] as const;

function publicRoute(relativeFile: string): string {
  const segments = relativeFile
    .replace(/\/\+page\.svelte$/, '')
    .split('/')
    .filter((segment) => !/^\(.+\)$/.test(segment));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!/\.(svelte|ts)$/.test(entry.name) || entry.name.endsWith('.test.ts')) return [];
    return [absolutePath];
  });
}

describe('catalog route shell', () => {
  it('keeps product URLs unchanged beneath the app-shell route group', () => {
    for (const [relativeFile, expectedUrl] of appRouteFiles) {
      expect(existsSync(path.join(routesRoot, relativeFile)), relativeFile).toBe(true);
      expect(publicRoute(relativeFile)).toBe(expectedUrl);
    }
    expect(existsSync(path.join(routesRoot, 'sandbox/+page.svelte'))).toBe(true);
    expect(existsSync(path.join(routesRoot, '(app)/sandbox'))).toBe(false);
  });

  it('starts shared state at the root while keeping product host code inside the app shell', () => {
    const rootLayout = readFileSync(path.join(routesRoot, '+layout.svelte'), 'utf8');
    const appLayout = readFileSync(path.join(routesRoot, '(app)/+layout.svelte'), 'utf8');
    expect(rootLayout).toContain("import '../app.css'");
    expect(rootLayout).toContain('startRootStoreLifecycle');
    expect(rootLayout).not.toMatch(/electron-bridge|LiveAppClient|seedMockStore/);
    expect(appLayout).toContain('data-testid="app-ready"');
    expect(appLayout).toContain('LiveAppClient');
  });

  it('moves async-data lint baseline paths without changing baseline membership', () => {
    const eslintConfig = readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
    const baselineSource = eslintConfig.match(
      /const componentAsyncDataFetchBaselineFiles = \[([\s\S]*?)\n\];/,
    )?.[1];
    expect(baselineSource).toBeDefined();
    const baselinePaths = [...baselineSource!.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect(baselinePaths).toHaveLength(153);
    expect(new Set(baselinePaths).size).toBe(153);
    for (const [oldPath, newPath] of movedAsyncDataBaselinePaths) {
      expect(baselinePaths).not.toContain(oldPath);
      expect(baselinePaths).toContain(newPath);
    }
  });

  it('keeps catalog shell and fixture modules host and domain independent', () => {
    const files = [
      path.join(routesRoot, 'sandbox/+layout.svelte'),
      path.join(routesRoot, 'sandbox/+page.svelte'),
      path.join(routesRoot, 'sandbox/[slug]/+page.svelte'),
      ...sourceFiles(path.join(root, 'src/lib/component-catalog')),
    ];
    const forbidden =
      /from ['"](?:\$store\/|\$features\/|\$lib\/client|\$lib\/electron-bridge|electron)|import ['"]\$store\//;
    const violations = files.flatMap((file) => {
      const relativeFile = path.relative(root, file);
      const isStoreSeededSubscriptionFixture =
        relativeFile ===
          'src/lib/component-catalog/renderers/SubscriptionRowsCatalogPreview.svelte' ||
        relativeFile === 'src/lib/component-catalog/subscription-rows/subscription-row-fixtures.ts';
      if (isStoreSeededSubscriptionFixture) return [];
      return readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (forbidden.test(line) ? [`${relativeFile}:${index + 1}`] : []));
    });
    expect(violations).toEqual([]);

    const clientHooks = readFileSync(path.join(root, 'src/hooks.client.ts'), 'utf8');
    expect(clientHooks).toContain("window.location.pathname.startsWith('/sandbox')");
    expect(clientHooks).toMatch(
      /if \([\s\S]*!isCatalogRoute[\s\S]*VITE_ENABLE_BROWSER_MOCK[\s\S]*\) \{/,
    );
  });

  it('uses canonical controls throughout the catalog workspace and previews', () => {
    const violations = sourceFiles(path.join(root, 'src/lib/component-catalog'))
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => /<(?:button|input|select)\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));

    expect(violations).toEqual([]);
  });

  it('consumes the shared hatch without catalog-local recipes or physical workarounds', () => {
    const sources = sourceFiles(path.join(root, 'src/lib/component-catalog'))
      .filter((file) => file.endsWith('.svelte'))
      .map((file) => readFileSync(file, 'utf8'));
    const combined = sources.join('\n');

    expect(combined).not.toMatch(/--[\w-]*hatch[\w-]*\s*:/);
    expect(combined).not.toContain('repeating-linear-gradient(');
    expect(combined).not.toMatch(/background-image\s*:\s*color-mix\(/);
    expect(combined.match(/background-image:\s*var\(--surface-hatch\)/g)).toHaveLength(3);
  });

  it('uses only public subpaths for the Settings catalog lane', () => {
    const file = 'src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte';
    const source = readFileSync(path.join(root, file), 'utf8');
    expect(source).not.toMatch(/\$lib\/components\/ui\/[^'\"]+\/[^'\"]+\.svelte/);
  });
});
