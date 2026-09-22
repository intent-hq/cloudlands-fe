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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogShell from './CatalogShell.svelte';
import {
  parseCatalogUrlSettings,
  readCatalogPreferences,
  writeCatalogPreferences,
} from './catalog-preferences';

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
    'src/routes/test-mentions/compact/+page.svelte',
    'src/routes/(app)/test-mentions/compact/+page.svelte',
  ],
  ['src/routes/workspace/[id]/+page.svelte', 'src/routes/(app)/workspace/[id]/+page.svelte'],
] as const;

const srcRoot = path.join(root, 'src');
const hostBoundSpecifier =
  /^(?:\$store\/|\$features\/|\$lib\/client|\$lib\/electron-bridge|electron)/;
const sharedSpecifier = /^\$(?:lib|shared)\//;
const aliasDirectories: Record<string, string> = {
  '$features/': 'features',
  '$lib/': 'lib',
  '$shared/': 'shared',
};
// Compiled from messages/*.json and gitignored; it imports nothing beyond its own output.
const generatedSpecifierPrefixes = ['$shared/paraglide/'];

// Presentational feature components may back catalog fixtures: the axe gate has to cover the exact
// production DOM (tooltip trigger + sr-only label) and only the feature component renders it. Each
// (file, specifier) pair below is exempt from the import guard solely because the closure test proves
// the module — everything it imports at runtime inside its feature family, plus the $lib/$shared
// modules those import directly — carries no store, host, or cross-feature dependency; a type-only
// import is erased and pulls nothing into the bundle.
const presentationalFeatureImports: Record<string, readonly string[]> = {
  'src/lib/component-catalog/renderers/PrincipalAvatarCatalogPreview.svelte': [
    '$features/notes/note-presence/NotePresenceAvatars.svelte',
    '$features/notes/note-presence/note-presence-service',
    '$features/presence/components/PresenceAvatarStack.svelte',
    '$features/presence/components/presence-person',
  ],
};

interface ParsedImport {
  specifier: string;
  typeOnly: boolean;
  line: number;
}

function parseImports(source: string): ParsedImport[] {
  const pattern = /\b(?:import|export)\s+(type\s+)?(?:[^'";:=()]*?\bfrom\s+)?(['"])([^'"]+)\2/g;
  return [...source.matchAll(pattern)].map((match) => ({
    specifier: match[3],
    typeOnly: match[1] !== undefined,
    line: source.slice(0, match.index).split('\n').length,
  }));
}

function resolveModule(
  fromFile: string,
  specifier: string,
  sourceRoot: string,
): string | undefined {
  const alias = Object.keys(aliasDirectories).find((prefix) => specifier.startsWith(prefix));
  const base = alias
    ? path.join(sourceRoot, aliasDirectories[alias]!, specifier.slice(alias.length))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(fromFile), specifier)
      : undefined;
  if (!base) return undefined;
  return [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.svelte.ts`,
    path.join(base, 'index.ts'),
  ].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function boundaryViolations(
  source: string,
  relativeFile: string,
  allowlisted: readonly string[],
): string[] {
  return parseImports(source).flatMap(({ specifier, line }) =>
    hostBoundSpecifier.test(specifier) && !allowlisted.includes(specifier)
      ? [`${relativeFile}:${line}`]
      : [],
  );
}

// Walks the runtime imports of each allowlisted module: fully within the allowlisted feature
// families, and one level into the $lib/$shared modules those families import directly.
function runtimeHostViolations(
  importingFile: string,
  specifiers: readonly string[],
  sourceRoot: string,
): string[] {
  const projectRoot = path.dirname(sourceRoot);
  const violations: string[] = [];
  const imports = parseImports(readFileSync(importingFile, 'utf8'));
  const families = specifiers.map((specifier) => `${path.posix.dirname(specifier)}/`);
  const queue: { file: string; shared: boolean }[] = [];
  for (const specifier of specifiers) {
    const uses = imports.filter((entry) => entry.specifier === specifier);
    if (uses.length === 0) {
      violations.push(
        `${path.relative(projectRoot, importingFile)} no longer imports ${specifier}`,
      );
      continue;
    }
    if (uses.every((entry) => entry.typeOnly)) continue;
    const resolved = resolveModule(importingFile, specifier, sourceRoot);
    if (resolved) queue.push({ file: resolved, shared: false });
    else violations.push(`${specifier} unresolvable`);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const { file, shared } = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const moduleFile = path.relative(projectRoot, file);
    for (const entry of parseImports(readFileSync(file, 'utf8'))) {
      if (entry.typeOnly) continue;
      const location = `${moduleFile}:${entry.line} (${entry.specifier})`;
      const staysInFamily =
        entry.specifier.startsWith('.') ||
        families.some((family) => entry.specifier.startsWith(family));
      if (!staysInFamily && hostBoundSpecifier.test(entry.specifier)) {
        violations.push(location);
        continue;
      }
      if (shared) continue;
      const crossesToShared = sharedSpecifier.test(entry.specifier);
      if (!staysInFamily && !crossesToShared) continue;
      if (generatedSpecifierPrefixes.some((prefix) => entry.specifier.startsWith(prefix))) continue;
      const next = resolveModule(file, entry.specifier, sourceRoot);
      if (next) queue.push({ file: next, shared: crossesToShared });
      else violations.push(`${location} unresolvable`);
    }
  }
  return violations;
}

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

    expect(baselinePaths).toHaveLength(141);
    expect(new Set(baselinePaths).size).toBe(141);
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
    const violations = files.flatMap((file) => {
      const relativeFile = path.relative(root, file);
      const isStoreSeededSubscriptionFixture =
        relativeFile ===
          'src/lib/component-catalog/renderers/SubscriptionRowsCatalogPreview.svelte' ||
        relativeFile === 'src/lib/component-catalog/subscription-rows/subscription-row-fixtures.ts';
      if (isStoreSeededSubscriptionFixture) return [];
      return boundaryViolations(
        readFileSync(file, 'utf8'),
        relativeFile,
        presentationalFeatureImports[relativeFile] ?? [],
      );
    });
    expect(violations).toEqual([]);

    const clientHooks = readFileSync(path.join(root, 'src/hooks.client.ts'), 'utf8');
    expect(clientHooks).toContain("window.location.pathname.startsWith('/sandbox')");
    expect(clientHooks).toMatch(
      /if \([\s\S]*!isCatalogRoute[\s\S]*VITE_ENABLE_BROWSER_MOCK[\s\S]*\) \{/,
    );
  });

  it('keeps allowlisted presentational feature modules free of runtime host dependencies', () => {
    const violations = Object.entries(presentationalFeatureImports).flatMap(
      ([relativeFile, specifiers]) =>
        runtimeHostViolations(path.join(root, relativeFile), specifiers, srcRoot),
    );
    expect(violations).toEqual([]);
  });

  it('matches allowlist exemptions on the import specifier, not on line text', () => {
    const allowlisted = ['$features/presence/components/presence-person'];
    const source = [
      '<script lang="ts">',
      "  import { presencePersonLabel } from '$features/presence/components/presence-person';",
      "  import PresenceTypingIndicator from '$features/presence/components/PresenceTypingIndicator.svelte'; // follows '$features/presence/components/presence-person'",
      '</script>',
    ].join('\n');
    expect(boundaryViolations(source, 'renderer.svelte', allowlisted)).toEqual([
      'renderer.svelte:3',
    ]);
  });

  it('sees host dependencies one level into the $lib modules an allowlisted module imports', () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'catalog-guard-'));
    try {
      const tmpSrc = path.join(tmp, 'src');
      const write = (relativeFile: string, content: string) => {
        const file = path.join(tmpSrc, relativeFile);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
        return file;
      };
      const renderer = write(
        'lib/component-catalog/renderers/Preview.svelte',
        '<script lang="ts">\n  import Stack from \'$features/presence/components/Stack.svelte\';\n</script>',
      );
      write(
        'features/presence/components/Stack.svelte',
        '<script lang="ts">\n  import { remoteCursorColor } from \'$lib/components/tiptap/RemoteCursorDecorations\';\n</script>',
      );
      const decorations = 'lib/components/tiptap/RemoteCursorDecorations.ts';
      const specifiers = ['$features/presence/components/Stack.svelte'];

      write(
        decorations,
        "import { Plugin } from '@tiptap/pm/state';\nexport const remoteCursorColor = 1;\n",
      );
      expect(runtimeHostViolations(renderer, specifiers, tmpSrc)).toEqual([]);

      write(
        decorations,
        "import { Plugin } from '@tiptap/pm/state';\nimport { x } from '$store/anything';\n",
      );
      expect(runtimeHostViolations(renderer, specifiers, tmpSrc)).toEqual([
        'src/lib/components/tiptap/RemoteCursorDecorations.ts:2 ($store/anything)',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses canonical controls throughout the catalog workspace and previews', () => {
    const violations = sourceFiles(path.join(root, 'src/lib/component-catalog'))
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => /<(?:button|input|select)\b/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file));

    expect(violations).toEqual([]);
  });

  it('does not invent surface textures or physical background-image workarounds', () => {
    const sources = sourceFiles(path.join(root, 'src/lib/component-catalog'))
      .filter((file) => file.endsWith('.svelte'))
      .map((file) => readFileSync(file, 'utf8'));
    const combined = sources.join('\n');

    expect(combined).not.toMatch(/--[\w-]*hatch[\w-]*/);
    expect(combined).not.toContain('repeating-linear-gradient(');
    expect(combined).not.toMatch(/background-image\s*:/);
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
    const trigger = screen.getByRole('combobox', { name: 'Color theme' });
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

describe('CatalogShell motion URL compatibility', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation((key) => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    writeCatalogPreferences(localStorage, {
      theme: 'dark',
      colorTheme: 'default',
      motion: 'system',
    });
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/sandbox/button');
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('data-reduce-motion');
  });

  function motionOption(name: 'System' | 'Full' | 'Reduced') {
    return within(screen.getByTestId('catalog-motion-control')).getByRole('radio', { name });
  }

  it.each([
    ['true', 'Reduced'],
    ['false', 'Full'],
  ] as const)(
    'keeps system mode after reloading a legacy reducedMotion=%s link',
    async (legacy, initialLabel) => {
      const historyState = { catalog: { entry: 'button', scroll: 42 } };
      window.history.replaceState(
        historyState,
        '',
        `/sandbox/button?state=loading&width=420&tag=one&tag=two&reducedMotion=${legacy}#preview`,
      );
      const first = render(CatalogShell, { props: { activeSlug: 'button' } });
      await waitFor(() =>
        expect(motionOption(initialLabel).getAttribute('aria-checked')).toBe('true'),
      );

      await fireEvent.click(motionOption('System'));
      await waitFor(() => {
        expect(motionOption('System').getAttribute('aria-checked')).toBe('true');
        expect(readCatalogPreferences(localStorage).motion).toBe('system');
        const params = new URLSearchParams(window.location.search);
        expect(params.has('motion')).toBe(false);
        expect(params.has('reducedMotion')).toBe(false);
      });

      const serialized = new URL(window.location.href);
      expect(parseCatalogUrlSettings(serialized.searchParams).motion).toBeUndefined();
      expect(serialized.pathname).toBe('/sandbox/button');
      expect(serialized.hash).toBe('#preview');
      expect(serialized.searchParams.get('state')).toBe('loading');
      expect(serialized.searchParams.get('width')).toBe('420');
      expect(serialized.searchParams.getAll('tag')).toEqual(['one', 'two']);
      expect(serialized.searchParams.get('theme')).toBe('dark');
      expect(window.history.state).toEqual(historyState);
      expect(readCatalogPreferences(localStorage)).toEqual({
        theme: 'dark',
        colorTheme: 'default',
        motion: 'system',
      });

      // Reload the shell from its serialized URL and saved preferences, not component state.
      const writesBeforeReload = vi.mocked(localStorage.setItem).mock.calls.length;
      first.unmount();
      render(CatalogShell, { props: { activeSlug: 'button' } });
      await waitFor(() => {
        expect(vi.mocked(localStorage.setItem).mock.calls.length).toBeGreaterThan(
          writesBeforeReload,
        );
        expect(motionOption('System').getAttribute('aria-checked')).toBe('true');
      });
      document.documentElement.setAttribute('data-reduce-motion', '');
      await waitFor(() =>
        expect(screen.getByTestId('catalog-shell').getAttribute('data-catalog-motion')).toBe(
          'reduced',
        ),
      );
      document.documentElement.removeAttribute('data-reduce-motion');
      await waitFor(() =>
        expect(screen.getByTestId('catalog-shell').getAttribute('data-catalog-motion')).toBe(
          'full',
        ),
      );
    },
  );

  it.each([
    ['true', 'Reduced', 'Full', 'full'],
    ['false', 'Full', 'Reduced', 'reduced'],
  ] as const)(
    'replaces legacy reducedMotion=%s when changing %s to %s',
    async (legacy, initialLabel, nextLabel, nextMotion) => {
      window.history.replaceState(null, '', `/sandbox/button?reducedMotion=${legacy}`);
      const first = render(CatalogShell, { props: { activeSlug: 'button' } });
      await waitFor(() =>
        expect(motionOption(initialLabel).getAttribute('aria-checked')).toBe('true'),
      );

      await fireEvent.click(motionOption(nextLabel));
      await waitFor(() => {
        const params = new URLSearchParams(window.location.search);
        expect(params.has('reducedMotion')).toBe(false);
        expect(params.get('motion')).toBe(nextMotion);
        expect(parseCatalogUrlSettings(params).motion).toBe(nextMotion);
        expect(readCatalogPreferences(localStorage).motion).toBe(nextMotion);
      });

      first.unmount();
      render(CatalogShell, { props: { activeSlug: 'button' } });
      await waitFor(() =>
        expect(motionOption(nextLabel).getAttribute('aria-checked')).toBe('true'),
      );
    },
  );
});
