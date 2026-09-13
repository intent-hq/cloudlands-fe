// @verify-changed-triggers: src/lib/component-catalog/**, src/hooks.client.ts, eslint.config.js,
//   src/routes/+layout.svelte, src/routes/(app)/+layout.svelte,
//   src/routes/sandbox/+layout.svelte, src/routes/sandbox/+page.svelte,
//   src/routes/sandbox/[slug]/+page.svelte, src/routes/(app)/sandbox/**,
//   src/routes/(app)/agent/[id]/+page.svelte, src/routes/(app)/settings/+page.svelte,
//   src/routes/(app)/test-comments/+page.svelte, src/routes/(app)/test-error-boundary/+page.svelte,
//   src/routes/(app)/test-input/+page.svelte, src/routes/(app)/test-mentions/+page.svelte,
//   src/routes/(app)/test-mentions/compact/+page.svelte, src/routes/(app)/test-monaco/+page.svelte,
//   src/routes/(app)/test-workspace-cards/+page.svelte,
//   src/routes/(app)/test-workspace-hover-card/+page.svelte,
//   src/routes/(app)/workspace/[id]/+page.svelte, src/routes/(app)/workspace/[id]/files/+page.svelte,
//   src/routes/(app)/workspace/[id]/terminal-test/+page.svelte,
//   src/routes/(app)/workspace/creating/+page.svelte

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogShell from './CatalogShell.svelte';

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

describe('CatalogShell root inline style ownership', () => {
  const fontToken = "'Inter Variable', Inter, system-ui, sans-serif";
  const rootStyle = () => document.documentElement.style;

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    window.history.replaceState(null, '', '/sandbox/button');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
  });

  async function chooseTheme(name: 'Light' | 'Dark' | 'System') {
    await fireEvent.click(screen.getByRole('radio', { name }));
    await waitFor(() =>
      expect(rootStyle().getPropertyValue('color-scheme')).toBe(name.toLowerCase()),
    );
  }

  async function chooseColorTheme(name: string) {
    const trigger = screen.getByRole('button', { name: 'Color theme' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const options = screen.getAllByRole('option');
    const highlighted = options.findIndex((option) => option.hasAttribute('data-highlighted'));
    const target = options.indexOf(screen.getByRole('option', { name }));
    expect(target).toBeGreaterThanOrEqual(0);
    const key = target > highlighted ? 'ArrowDown' : 'ArrowUp';
    for (let step = 0; step < Math.abs(target - Math.max(highlighted, 0)); step += 1) {
      await fireEvent.keyDown(trigger, { key });
    }
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger.textContent).toContain(name));
  }

  // The sandbox route owns the font token and, as the shell's parent, may write it to the
  // root after the shell has already mounted; the shell must never wipe it.
  function declareSandboxFontToken() {
    rootStyle().setProperty('--font-ui', fontToken);
  }

  it('keeps unowned root inline properties across theme and color theme changes', async () => {
    render(CatalogShell, { props: { activeSlug: 'button' } });
    await waitFor(() => expect(rootStyle().getPropertyValue('color-scheme')).not.toBe(''));
    declareSandboxFontToken();

    await chooseTheme('Dark');
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await chooseColorTheme('Dracula');
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).not.toBe(''));
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);

    await chooseTheme('Light');
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);
    expect(rootStyle().getPropertyValue('--background')).not.toBe('');

    await chooseColorTheme('Default');
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).toBe(''));
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);
    expect(rootStyle().getPropertyValue('color-scheme')).toBe('light');
  });

  it('restores prior root inline values on teardown and survives a remount', async () => {
    rootStyle().setProperty('color-scheme', 'light');
    const first = render(CatalogShell, { props: { activeSlug: 'button' } });
    await waitFor(() => expect(rootStyle().getPropertyValue('color-scheme')).not.toBe(''));
    declareSandboxFontToken();
    await chooseTheme('Dark');
    await chooseColorTheme('Nord');
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).not.toBe(''));

    first.unmount();
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);
    expect(rootStyle().getPropertyValue('color-scheme')).toBe('light');
    expect(rootStyle().getPropertyValue('--background')).toBe('');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    render(CatalogShell, { props: { activeSlug: 'button' } });
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).not.toBe(''));
    expect(rootStyle().getPropertyValue('color-scheme')).toBe('dark');
    expect(rootStyle().getPropertyValue('--font-ui')).toBe(fontToken);
  });

  it('restores prior inline priority when a preset drops a property and on teardown', async () => {
    rootStyle().setProperty('color-scheme', 'light', 'important');
    rootStyle().setProperty('--background', 'red', 'important');
    const shell = render(CatalogShell, { props: { activeSlug: 'button' } });
    await waitFor(() => expect(rootStyle().getPropertyValue('color-scheme')).toBe('light'));
    await chooseColorTheme('Dracula');
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).not.toBe('red'));

    await chooseColorTheme('Default');
    await waitFor(() => expect(rootStyle().getPropertyValue('--background')).toBe('red'));
    expect(rootStyle().getPropertyPriority('--background')).toBe('important');

    await chooseTheme('Dark');
    expect(rootStyle().getPropertyPriority('color-scheme')).toBe('');

    shell.unmount();
    expect(rootStyle().getPropertyValue('color-scheme')).toBe('light');
    expect(rootStyle().getPropertyPriority('color-scheme')).toBe('important');
    expect(rootStyle().getPropertyValue('--background')).toBe('red');
    expect(rootStyle().getPropertyPriority('--background')).toBe('important');
  });
});
