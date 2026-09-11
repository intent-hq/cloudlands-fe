import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireVerificationLock,
  createVerificationPlan,
  expandInputPaths,
  findRelatedCtTests,
  lockTimeout,
  parseArgs,
  printPlan,
  runCli,
  runVerificationPlan,
  testRunner,
  verificationLockKey,
  vitestExcludePatterns,
} from './verify-changed.mjs';

const requireFromTest = createRequire(import.meta.url);

function vitestList(root: string, filter: string) {
  const bin = join(requireFromTest.resolve('vitest/package.json'), '..', 'vitest.mjs');
  return execFileSync(
    process.execPath,
    [bin, 'list', '--root', root, '--config', 'vitest.config.ts', filter],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
    .split('\n')
    .filter(Boolean);
}

const temporaryPaths: string[] = [];

function temporaryDirectory() {
  const path = join(tmpdir(), `verify-changed-test-${process.pid}-${temporaryPaths.length}`);
  mkdirSync(path, { recursive: true });
  temporaryPaths.push(path);
  return path;
}

function fixtureRoot(files: Record<string, string>) {
  const root = temporaryDirectory();
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error('timed out waiting for test condition');
}

function testCheck(id: string, lockKind: string | null) {
  return { id, label: id, executable: 'noop', args: [], lockKind };
}

function testPlan(...checks: ReturnType<typeof testCheck>[]) {
  return { files: [], checks, fallbackReasons: [] };
}

function runnerOptions(
  lockRoot: string,
  runCheck: (check: ReturnType<typeof testCheck>) => Promise<void>,
  env: Record<string, string> = {},
) {
  return {
    env,
    lockPath: (key: string) => join(lockRoot, key),
    acquireLock: (options: Record<string, unknown>) =>
      acquireVerificationLock({ ...options, pollMs: 5 }),
    runCheck,
    log() {},
  };
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('verify-changed arguments and paths', () => {
  it('parses explicit paths and dry-run', () => {
    expect(parseArgs(['--dry-run', '--', 'src/a.ts'])).toEqual({
      dryRun: true,
      help: false,
      paths: ['src/a.ts'],
    });
    expect(() => parseArgs(['--wat'])).toThrow('unknown option');
  });

  it('accepts package-prefixed paths and expands directories', () => {
    const root = fixtureRoot({ 'src/a.ts': '', 'src/nested/b.svelte': '' });
    expect(expandInputPaths(['packages/cloudlands-fe/src'], root)).toEqual([
      'src/a.ts',
      'src/nested/b.svelte',
    ]);
    expect(() => expandInputPaths(['../outside.ts'], root)).toThrow('outside');
  });

  it('rejects symlinks outside the package and keeps in-package and missing paths', () => {
    const root = fixtureRoot({ 'src/a.ts': '' });
    const outside = fixtureRoot({ 'outside.ts': '' });
    symlinkSync(outside, join(root, 'external'), 'dir');
    symlinkSync(join(root, 'src'), join(root, 'internal'), 'dir');

    expect(() => expandInputPaths(['external'], root)).toThrow('outside');
    expect(expandInputPaths(['internal'], root)).toEqual(['internal/a.ts']);
    expect(expandInputPaths(['src/deleted.ts'], root)).toEqual(['src/deleted.ts']);
  });
});

describe('verification planning', () => {
  it('selects related Vitest and only the renderer boundary', () => {
    const root = fixtureRoot({ 'src/lib/example.ts': 'export const value = 1;' });
    const plan = createVerificationPlan(['src/lib/example.ts'], { root, ctTests: [] });
    expect(plan.checks.map((check) => check.id)).toEqual([
      'prettier',
      'eslint',
      'architecture',
      'vitest-related',
      'vitest-ui-invariants',
      'tsc-renderer',
    ]);
  });

  it('runs the architecture gates for any code change under src/', () => {
    const root = fixtureRoot({
      'src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga.ts': '',
      'src/main/index.ts': '',
      'src/lib/__tests__/example.test.ts': '',
    });
    for (const file of [
      'src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga.ts',
      'src/main/index.ts',
      'src/lib/__tests__/example.test.ts',
    ]) {
      const plan = createVerificationPlan([file], { root, ctTests: [] });
      const architecture = plan.checks.find((check) => check.id === 'architecture');
      expect(architecture?.args, file).toEqual(['run', 'lint:architecture']);
      expect(architecture?.lockKind, file).toBeNull();
    }
  });

  it('runs the architecture gates when a gate script itself changes', () => {
    const root = fixtureRoot({
      'scripts/check-saga-watcher-ownership.mjs': '',
      'scripts/type-check.ts': '',
      'scripts/verify-changed.mjs': '',
    });
    for (const file of ['scripts/check-saga-watcher-ownership.mjs', 'scripts/type-check.ts']) {
      const plan = createVerificationPlan([file], { root, ctTests: [] });
      expect(
        plan.checks.map((check) => check.id),
        file,
      ).toContain('architecture');
    }
    const otherScript = createVerificationPlan(['scripts/verify-changed.mjs'], {
      root,
      ctTests: [],
    });
    expect(otherScript.checks.map((check) => check.id)).not.toContain('architecture');
  });

  it('runs the type-check:validate wrapper only when scripts/type-check.ts changes', () => {
    const root = fixtureRoot({
      'scripts/type-check.ts': '',
      'src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga.ts': '',
    });
    const wrapper = createVerificationPlan(['scripts/type-check.ts'], { root, ctTests: [] });
    const ids = wrapper.checks.map((check) => check.id);
    expect(ids).toContain('architecture');
    expect(ids).toContain('type-check-validate');
    expect(ids.indexOf('type-check-validate')).toBe(ids.indexOf('architecture') + 1);
    const validate = wrapper.checks.find((check) => check.id === 'type-check-validate');
    expect(validate?.args).toEqual(['run', 'type-check:validate']);
    expect(validate?.lockKind).toBeNull();

    const saga = createVerificationPlan(
      ['src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga.ts'],
      { root, ctTests: [] },
    );
    expect(saga.checks.map((check) => check.id)).toContain('architecture');
    expect(saga.checks.map((check) => check.id)).not.toContain('type-check-validate');
  });

  it('runs the architecture gates when an AGENTS.md instruction file changes', () => {
    const root = fixtureRoot({
      'AGENTS.md': '# agents',
      'src/store/renderer/AGENTS.md': '# store agents',
      'docs/AGENTS-notes.md': '# notes',
    });
    for (const file of ['AGENTS.md', 'src/store/renderer/AGENTS.md']) {
      const plan = createVerificationPlan([file], { root, ctTests: [] });
      expect(plan.fallbackReasons, file).toEqual([]);
      expect(
        plan.checks.map((check) => check.id),
        file,
      ).toContain('architecture');
    }
    const other = createVerificationPlan(['docs/AGENTS-notes.md'], { root, ctTests: [] });
    expect(other.checks.map((check) => check.id)).not.toContain('architecture');
  });

  it('skips the architecture gates for docs, messages, and static changes', () => {
    const root = fixtureRoot({
      'README.md': '# readme',
      'docs/guide.md': '# guide',
      'messages/en.json': '{}',
      'static/icon.svg': '<svg />',
    });
    const plan = createVerificationPlan(
      ['README.md', 'docs/guide.md', 'messages/en.json', 'static/icon.svg'],
      { root, ctTests: [] },
    );
    expect(plan.fallbackReasons).toEqual([]);
    expect(plan.checks.map((check) => check.id)).not.toContain('architecture');
  });

  it('runs the repo-wide UI invariant suites for renderer source changes', () => {
    const root = fixtureRoot({
      'src/features/example/Example.svelte': '<button />',
      'src/features/example/main/status.ts': '',
    });
    const rendererPlan = createVerificationPlan(['src/features/example/Example.svelte'], {
      root,
      ctTests: [],
    });
    const uiInvariants = rendererPlan.checks.find((check) => check.id === 'vitest-ui-invariants');
    expect(uiInvariants?.args).toEqual(['run', 'test:ui-invariants']);
    expect(uiInvariants?.lockKind).toBeNull();

    const mainPlan = createVerificationPlan(['src/features/example/main/status.ts'], {
      root,
      ctTests: [],
    });
    expect(mainPlan.checks.map((check) => check.id)).not.toContain('vitest-ui-invariants');
  });

  it('runs the repo-wide UI invariant suites for renderer stylesheet changes', () => {
    const root = fixtureRoot({
      'src/lib/styles/tokens.css': ':root { --color: red; }',
    });
    const existingPlan = createVerificationPlan(['src/lib/styles/tokens.css'], {
      root,
      ctTests: [],
    });
    expect(existingPlan.checks.map((check) => check.id)).toContain('vitest-ui-invariants');

    const deletedPlan = createVerificationPlan(['src/lib/styles/removed.css'], {
      root,
      ctTests: [],
    });
    expect(deletedPlan.checks.map((check) => check.id)).toContain('vitest-ui-invariants');
  });

  it('runs the preload drift test for IPC channel source changes', () => {
    const triggers = [
      'src/preload/index.ts',
      'src/preload/index.template.ts',
      'src/shared/ipc-registry.ts',
      'scripts/inline-ipc-channels.ts',
    ];
    const root = fixtureRoot({
      ...Object.fromEntries(triggers.map((file) => [file, ''])),
      'src/preload/other.ts': '',
      'src/lib/example.ts': '',
      'scripts/inline-ipc-channels.test.ts': '',
      'package.json': '{}',
    });
    const ids = (files: string[]) =>
      createVerificationPlan(files, { root, ctTests: [] }).checks.map((check) => check.id);

    for (const file of triggers) {
      expect(ids([file]), file).toContain('vitest-preload-drift');
    }
    const drift = createVerificationPlan(['src/shared/ipc-registry.ts'], {
      root,
      ctTests: [],
    }).checks.find((check) => check.id === 'vitest-preload-drift');
    expect(drift?.args).toEqual([
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      'scripts/inline-ipc-channels.test.ts',
    ]);
    expect(drift?.lockKind).toBeNull();

    expect(ids(['src/preload/other.ts'])).not.toContain('vitest-preload-drift');
    expect(ids(['src/lib/example.ts'])).not.toContain('vitest-preload-drift');

    const fallback = ids(['src/preload/index.ts', 'package.json']);
    expect(fallback).toContain('vitest-full');
    expect(fallback).not.toContain('vitest-preload-drift');

    const direct = ids(['src/preload/index.ts', 'scripts/inline-ipc-channels.test.ts']);
    expect(direct).toContain('vitest-direct');
    expect(direct).not.toContain('vitest-preload-drift');
  });

  it('prints the regeneration hint only when the generated preload is planned', () => {
    const root = fixtureRoot({
      'src/preload/index.ts': '',
      'src/preload/index.template.ts': '',
      'src/shared/ipc-registry.ts': '',
    });
    const linesFor = (files: string[]) => {
      const lines: string[] = [];
      printPlan(createVerificationPlan(files, { root, ctTests: [] }), true, (line: string) =>
        lines.push(line),
      );
      return lines;
    };
    const hint = (lines: string[]) =>
      lines.filter((line) => line.includes('pnpm run generate:ipc-channels'));

    const generated = linesFor(['src/preload/index.ts']);
    expect(hint(generated)).toHaveLength(1);
    expect(hint(generated)[0]).toContain('src/preload/index.ts');
    expect(hint(generated)[0]).toContain('src/preload/index.template.ts');
    expect(hint(linesFor(['src/shared/ipc-registry.ts', 'src/preload/index.ts']))).toHaveLength(1);

    expect(hint(linesFor(['src/preload/index.template.ts']))).toEqual([]);
    expect(hint(linesFor(['src/shared/ipc-registry.ts']))).toEqual([]);
  });

  it('selects a component test that directly imports a changed Svelte component', () => {
    const root = fixtureRoot({
      'src/lib/Button.svelte': '<button />',
      'src/lib/__tests__/button.ct.spec.ts': "import Button from '../Button.svelte';",
    });
    const ctTests = ['src/lib/__tests__/button.ct.spec.ts'];
    expect(findRelatedCtTests(['src/lib/Button.svelte'], { root, ctTests })).toEqual(ctTests);
    const plan = createVerificationPlan(['src/lib/Button.svelte'], { root, ctTests });
    expect(plan.checks.map((check) => check.id)).toContain('ct-related');
    expect(plan.checks.map((check) => check.id)).toContain('svelte-check');
  });

  it('selects scene geometry for previews, fixtures, snapshots, and imported components', () => {
    const geometryTest = 'src/lib/components/workspace/workspace-hover-card.geometry.ct.spec.ts';
    const root = fixtureRoot({
      [geometryTest]:
        "import Preview, { preview } from './workspace-hover-card.preview.svelte';\ndefineGeometrySnapshotSuite({ scene: 'workspace-hover-card', component: Preview, definition: preview });",
      'src/lib/components/workspace/workspace-hover-card.preview.svelte':
        "import HoverCard from '$lib/components/ui/HoverCard.svelte';\nimport WorkspaceHoverCard from './WorkspaceHoverCard.svelte';",
      'src/lib/components/workspace/workspace-hover-card.preview-fixtures.ts': '',
      'src/lib/components/ui/HoverCard.svelte': '<aside />',
      'src/lib/components/workspace/WorkspaceHoverCard.svelte': '<article />',
      'src/lib/components/workspace/__geometry__/workspace-hover-card.geometry.json': '{}',
    });
    const options = { root, ctTests: [geometryTest] };

    for (const file of [
      'src/lib/components/workspace/workspace-hover-card.preview.svelte',
      'src/lib/components/workspace/workspace-hover-card.preview-fixtures.ts',
      'src/lib/components/ui/HoverCard.svelte',
      'src/lib/components/workspace/WorkspaceHoverCard.svelte',
      'src/lib/components/workspace/__geometry__/workspace-hover-card.geometry.json',
    ]) {
      expect(findRelatedCtTests([file], options), file).toEqual([geometryTest]);
    }
  });

  it('keeps main and preload type checks scoped to their boundaries', () => {
    const root = fixtureRoot({
      'src/features/system/main/status.ts': '',
      'src/preload/index.ts': '',
    });
    const plan = createVerificationPlan(
      ['src/features/system/main/status.ts', 'src/preload/index.ts'],
      { root, ctTests: [] },
    );
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toContain('tsc-main');
    expect(ids).toContain('tsc-preload');
    expect(ids).not.toContain('tsc-renderer');
    expect(ids).not.toContain('vitest-ui-invariants');
  });

  it('checks all process boundaries for shared source', () => {
    const root = fixtureRoot({ 'src/shared/protocol.ts': '' });
    const plan = createVerificationPlan(['src/shared/protocol.ts'], { root, ctTests: [] });
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining(['tsc-renderer', 'tsc-main', 'tsc-preload']));
  });

  it('uses the conservative suite for an unknown high-risk change', () => {
    const root = fixtureRoot({ 'native/tool.bin': 'data' });
    const plan = createVerificationPlan(['native/tool.bin'], { root, ctTests: [] });
    expect(plan.fallbackReasons).toEqual(['native/tool.bin']);
    expect(plan.checks.map((check) => check.id)).toEqual([
      'architecture',
      'vitest-full',
      'svelte-check',
      'tsc-renderer',
      'tsc-main',
      'tsc-preload',
    ]);
    expect(plan.checks.find((check) => check.id === 'vitest-full')?.lockKind).toBe('vitest-full');
    expect(plan.checks.find((check) => check.id === 'svelte-check')?.lockKind).toBeNull();
    expect(plan.checks.find((check) => check.id === 'tsc-renderer')?.lockKind).toBeNull();
  });

  it('runs changed integration tests with their own Vitest config', () => {
    const root = fixtureRoot({ 'tests/integration/example.test.ts': '' });
    const plan = createVerificationPlan(['tests/integration/example.test.ts'], {
      root,
      ctTests: [],
    });
    expect(plan.checks.find((check) => check.id === 'vitest-integration')?.args).toContain(
      'tests/integration/vitest.integration.config.ts',
    );
  });

  it('classifies test paths by the runner that owns them', () => {
    expect(testRunner('test/splash-loader.spec.ts')).toBe('playwright');
    expect(testRunner('test/nested/geometry.spec.ts')).toBe('playwright');
    expect(testRunner('test/current-main-baseline.spec.ts')).toBe('manual');
    expect(testRunner('test/catalog-manual-review.capture.spec.ts')).toBe('manual');
    expect(testRunner('test/actions-status-visual.spec.ts')).toBe('playwright');
    expect(testRunner('test/added.visual.spec.ts')).toBe('playwright');
    expect(testRunner('test/added.ct.spec.ts')).toBe('playwright');
    expect(testRunner('test/helpers.test.ts')).toBe('manual');
    expect(testRunner('src/lib/components/ui/card/operate-patterns.visual.spec.ts')).toBe('manual');
    expect(testRunner('src/lib/components/ui/card/operate-patterns.visual.spec.tsx')).toBe(
      'vitest',
    );
    expect(testRunner('scripts/probe.ct.spec.ts')).toBe('manual');
    expect(testRunner('tests/remote-env/remote-env.test.ts')).toBe('manual');
    expect(testRunner('tests/integration/example.test.ts')).toBe('integration');
    expect(testRunner('tests/integration/example.spec.ts')).toBe('manual');
    expect(testRunner('tests/unit/edge-cases.test.ts')).toBe('vitest');
    expect(testRunner('src/test/factories/__tests__/workspace.factory.test.ts')).toBe('vitest');
    expect(testRunner('src/lib/__tests__/button.ct.spec.ts')).toBe('ct');
    expect(testRunner('scripts/verify-changed.test.ts')).toBe('vitest');
    expect(testRunner('src/lib/example.ts')).toBeNull();
  });

  it('routes an added browser spec to Playwright instead of Vitest', () => {
    const root = fixtureRoot({ 'test/splash-loader.spec.ts': '' });
    const plan = createVerificationPlan(['test/splash-loader.spec.ts'], { root, ctTests: [] });
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toContain('playwright-direct');
    expect(ids).not.toContain('vitest-direct');
    expect(plan.checks.find((check) => check.id === 'playwright-direct')?.args).toEqual([
      'exec',
      'playwright',
      'test',
      'test/splash-loader.spec.ts',
    ]);
  });

  it('does not hand a browser-owned CT-shaped spec to the component test runner', () => {
    const root = fixtureRoot({
      'test/added.ct.spec.ts': '',
      'src/lib/components/__tests__/button.ct.spec.ts': '',
    });
    const browser = createVerificationPlan(['test/added.ct.spec.ts'], { root, ctTests: [] });
    expect(browser.checks.map((check) => check.id)).toContain('playwright-direct');
    expect(browser.checks.map((check) => check.id)).not.toContain('ct-related');

    const component = createVerificationPlan(['src/lib/components/__tests__/button.ct.spec.ts'], {
      root,
      ctTests: [],
    });
    expect(component.checks.find((check) => check.id === 'ct-related')?.args).toContain(
      'src/lib/components/__tests__/button.ct.spec.ts',
    );
    expect(component.checks.map((check) => check.id)).not.toContain('playwright-direct');
  });

  it('plans a Playwright command whose filter selects only the changed spec', () => {
    const spec = 'test/actions-status-visual.spec.ts';
    const plan = createVerificationPlan([spec], { root: process.cwd(), ctTests: [] });
    const args = plan.checks.find((check) => check.id === 'playwright-direct')?.args ?? [];
    expect(args.slice(0, 2)).toEqual(['exec', 'playwright']);
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
    const output = execFileSync(
      process.execPath,
      [cli, ...args.slice(2), '--list', '--reporter=list'],
      { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const listed = output.split('\n').filter((line) => /\.spec\.ts:\d+:\d+/.test(line));
    expect(listed.length).toBeGreaterThan(0);
    for (const line of listed) expect(line).toContain('actions-status-visual.spec.ts:');
    expect(output).toMatch(/Total: \d+ tests? in 1 file/);
  });

  it('never passes a deleted unit test as a test path but keeps its directory covered', () => {
    const root = fixtureRoot({ 'src/lib/__tests__/sibling.test.ts': '' });
    const plan = createVerificationPlan(['src/lib/__tests__/removed.test.ts'], {
      root,
      ctTests: [],
    });
    const direct = plan.checks.find((check) => check.id === 'vitest-direct');
    expect(direct?.args).not.toContain('src/lib/__tests__/removed.test.ts');
    expect(direct?.args).toContain('src/lib/__tests__');
    for (const check of plan.checks) {
      expect(check.args).not.toContain('src/lib/__tests__/removed.test.ts');
    }
  });

  it('drops a deleted unit test whose directory is gone without running anything for it', () => {
    const root = fixtureRoot({ 'src/other.ts': '' });
    const plan = createVerificationPlan(['src/gone/__tests__/removed.test.ts'], {
      root,
      ctTests: [],
    });
    expect(plan.checks.map((check) => check.id)).not.toContain('vitest-direct');
    expect(plan.checks.map((check) => check.id)).toContain('tsc-renderer');
  });

  it('drops a deleted unit test whose surviving directory has no runnable unit tests', () => {
    const root = fixtureRoot({
      'src/lib/debug/__tests__/fixtures/sample.json': '{}',
      'src/lib/debug/__tests__/helpers.ts': 'export const helper = 1;',
      'src/lib/debug/__tests__/Widget.ct.spec.ts': '',
      'src/lib/debug/__tests__/harness.visual.spec.ts': '',
    });
    const plan = createVerificationPlan(['src/lib/debug/__tests__/removed.test.ts'], {
      root,
      ctTests: [],
    });
    expect(plan.checks.map((check) => check.id)).not.toContain('vitest-direct');
    for (const check of plan.checks) expect(check.args).not.toContain('src/lib/debug/__tests__');
  });

  it('reads the Vitest exclude list from the repository config', () => {
    const patterns = vitestExcludePatterns(process.cwd());
    expect(patterns).toEqual(
      expect.arrayContaining(['**/build/**', '**/dist/**', 'test/**', '**/*.ct.spec.ts']),
    );
    for (const pattern of patterns) expect(pattern).not.toMatch(/\/\/|\s/);
  });

  it('ignores survivors that Vitest excludes when deciding a deletion fallback', () => {
    const test = "import { test } from 'vitest';\ntest('kept', () => {});\n";
    const root = fixtureRoot({
      'vitest.config.ts': [
        'export default {',
        '  test: {',
        '    exclude: [',
        "      '**/node_modules/**',",
        "      '**/build/**', // build output",
        "      '**/dist/**',",
        "      '**/example/quarantined.test.ts',",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
      'src/example/build/keep.test.ts': test,
      'src/example/dist/keep.test.ts': test,
      'src/example/quarantined.test.ts': test,
    });
    const deleted = 'src/example/removed.test.ts';

    expect(vitestList(root, 'src/example')).toEqual([]);
    const excludedOnly = createVerificationPlan([deleted], { root, ctTests: [] });
    expect(excludedOnly.checks.map((check) => check.id)).not.toContain('vitest-direct');

    writeFileSync(join(root, 'src/example/live.test.ts'), test);
    expect(vitestList(root, 'src/example')).toEqual(['src/example/live.test.ts > kept']);
    const withSurvivor = createVerificationPlan([deleted], { root, ctTests: [] });
    expect(withSurvivor.checks.find((check) => check.id === 'vitest-direct')?.args).toContain(
      'src/example',
    );
  });

  it('treats a deleted test directory with glob characters in its name literally', () => {
    const test = "import { test } from 'vitest';\ntest('kept', () => {});\n";
    const directory = 'src/routes/(app)/workspace/[id]';
    const root = fixtureRoot({
      'vitest.config.ts': "export default { test: { exclude: ['**/node_modules/**'] } };\n",
      [`${directory}/keep.test.ts`]: test,
    });

    expect(vitestList(root, directory)).toEqual([`${directory}/keep.test.ts > kept`]);
    const plan = createVerificationPlan([`${directory}/removed.test.ts`], { root, ctTests: [] });
    expect(plan.checks.find((check) => check.id === 'vitest-direct')?.args).toContain(directory);
  });

  it('keeps a deleted unit test directory when a nested runnable unit test survives', () => {
    const root = fixtureRoot({ 'src/lib/debug/__tests__/nested/keep.test.ts': '' });
    const plan = createVerificationPlan(['src/lib/debug/__tests__/removed.test.ts'], {
      root,
      ctTests: [],
    });
    expect(plan.checks.find((check) => check.id === 'vitest-direct')?.args).toContain(
      'src/lib/debug/__tests__',
    );
  });

  it('drops deleted component, integration, and browser specs from runnable lists', () => {
    const root = fixtureRoot({ 'src/lib/Button.svelte': '<button />' });
    const files = [
      'src/lib/__tests__/removed.ct.spec.ts',
      'tests/integration/removed.test.ts',
      'test/removed.spec.ts',
    ];
    const plan = createVerificationPlan(files, {
      root,
      ctTests: ['src/lib/__tests__/removed.ct.spec.ts'],
      readText: () => '',
    });
    const ids = plan.checks.map((check) => check.id);
    expect(ids).not.toContain('ct-related');
    expect(ids).not.toContain('vitest-integration');
    expect(ids).not.toContain('playwright-direct');
    for (const check of plan.checks) {
      for (const file of files) expect(check.args).not.toContain(file);
    }
  });

  it('plans the issue scenario: modified source, deleted unit test, added browser spec', () => {
    const root = fixtureRoot({
      'src/app.html': '<html></html>',
      'src/lib/splash/splash-loader.ts': 'export const ready = true;',
      'src/lib/splash/__tests__/other.test.ts': '',
      'test/splash-loader.spec.ts': '',
    });
    const files = [
      'src/app.html',
      'src/lib/splash/splash-loader.ts',
      'src/lib/splash/__tests__/splash-loader.test.ts',
      'test/splash-loader.spec.ts',
    ];
    const plan = createVerificationPlan(files, { root, ctTests: [] });
    const byId = Object.fromEntries(plan.checks.map((check) => [check.id, check]));

    expect(byId['playwright-direct']?.args).toEqual([
      'exec',
      'playwright',
      'test',
      'test/splash-loader.spec.ts',
    ]);
    expect(byId['vitest-direct']?.args).toEqual([
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      'src/lib/splash/__tests__',
    ]);
    expect(byId['vitest-related']?.args).toContain('src/lib/splash/splash-loader.ts');
    expect(plan.fallbackReasons).toEqual([]);

    const lines: string[] = [];
    printPlan(plan, true, (line: string) => lines.push(line));
    const commandLines = lines.filter((line) => line.startsWith('  - ') && line.includes(': pnpm'));
    expect(
      commandLines.some(
        (line) => line.includes('playwright test') && line.includes('test/splash-loader.spec.ts'),
      ),
    ).toBe(true);
    for (const line of commandLines) {
      expect(line).not.toContain('src/lib/splash/__tests__/splash-loader.test.ts');
      expect(line.includes('vitest') && line.includes('test/splash-loader.spec.ts')).toBe(false);
    }
  });

  it('runs the whole Playwright browser suite when its config changes', () => {
    const root = fixtureRoot({ 'playwright.config.ts': '', 'test/a.spec.ts': '' });
    const plan = createVerificationPlan(['playwright.config.ts', 'test/a.spec.ts'], {
      root,
      ctTests: [],
    });
    const ids = plan.checks.map((check) => check.id);
    expect(ids).toContain('playwright-full');
    expect(ids).not.toContain('playwright-direct');
    expect(plan.fallbackReasons).toEqual([]);
  });
});

describe('dependency freshness gate', () => {
  function cliOptions(depsResult: { ok: boolean; reason: string | null }) {
    const calls: string[] = [];
    return {
      calls,
      options: {
        log() {},
        checkDeps() {
          calls.push('checkDeps');
          return depsResult;
        },
        async runPlan() {
          calls.push('runPlan');
        },
      },
    };
  }

  it('checks the install before running a plan and refuses a stale install', async () => {
    const root = fixtureRoot({ 'src/lib/example.ts': 'export const value = 1;' });
    const reason = 'node_modules is out of sync';
    const stale = cliOptions({ ok: false, reason });
    await expect(runCli(['src/lib/example.ts'], root, stale.options)).rejects.toThrow(reason);
    expect(stale.calls).toEqual(['checkDeps']);

    const fresh = cliOptions({ ok: true, reason: null });
    await runCli(['src/lib/example.ts'], root, fresh.options);
    expect(fresh.calls).toEqual(['checkDeps', 'runPlan']);
  });

  it('skips the install check for dry runs', async () => {
    const root = fixtureRoot({ 'src/lib/example.ts': 'export const value = 1;' });
    const stale = cliOptions({ ok: false, reason: 'node_modules is out of sync' });
    await runCli(['--dry-run', 'src/lib/example.ts'], root, stale.options);
    expect(stale.calls).toEqual([]);
  });

  it('refuses with the remediation when the installed lockfile copy is unreadable', async () => {
    const root = fixtureRoot({
      'src/lib/example.ts': 'export const value = 1;',
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    });
    mkdirSync(join(root, 'node_modules', '.pnpm', 'lock.yaml'), { recursive: true });
    const calls: string[] = [];
    const options = {
      log() {},
      async runPlan() {
        calls.push('runPlan');
      },
    };
    await expect(runCli(['src/lib/example.ts'], root, options)).rejects.toThrow(
      /could not be read \(EISDIR\).*pnpm install --frozen-lockfile/,
    );
    expect(calls).toEqual([]);
  });
});

describe('expensive-check coordination', () => {
  it('releases only its own acquired lock', async () => {
    const parent = temporaryDirectory();
    const lockPath = join(parent, 'lock');
    const cwd = '/current/worktree';
    const release = await acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5, cwd });
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'))).toMatchObject({
      pid: process.pid,
      cwd,
    });
    release();
    expect(() => readFileSync(join(lockPath, 'owner.json'), 'utf8')).toThrow();
  });

  it('times out without removing or stopping a live owner', async () => {
    const lockPath = temporaryDirectory();
    const ownerCwd = '/other/worktree';
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({ pid: process.pid, cwd: ownerCwd, token: 'other' }),
    );
    await expect(acquireVerificationLock({ lockPath, timeoutMs: 15, pollMs: 5 })).rejects.toThrow(
      new RegExp(`owner pid ${process.pid} cwd ${ownerCwd}; waited [0-9]+ms`),
    );
    expect(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8')).token).toBe('other');
  });

  it('retries when the lock disappears before its metadata can be inspected', async () => {
    const parent = temporaryDirectory();
    const lockPath = join(parent, 'lock');
    mkdirSync(lockPath);

    const release = await acquireVerificationLock({
      lockPath,
      timeoutMs: 15,
      pollMs: 5,
      statLock(path: string) {
        rmSync(path, { recursive: true, force: true });
        return statSync(path);
      },
    });

    expect(readFileSync(join(lockPath, 'owner.json'), 'utf8')).toContain(String(process.pid));
    release();
  });

  it('preserves unexpected lock inspection errors', async () => {
    const lockPath = temporaryDirectory();
    const error = Object.assign(new Error('lock inspection failed'), { code: 'EACCES' });

    await expect(
      acquireVerificationLock({
        lockPath,
        timeoutMs: 15,
        pollMs: 5,
        statLock() {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });

  it('uses per-kind keys and bounded default waits', () => {
    expect(verificationLockKey(testCheck('ct', 'ct'), {})).toBe('ct-3100');
    expect(verificationLockKey(testCheck('ct', 'ct'), { CT_PORT: '03101' })).toBe('ct-3101');
    expect(verificationLockKey(testCheck('vitest', 'vitest-full'), {})).toBe('vitest-full');
    expect(verificationLockKey(testCheck('tsc', null), {})).toBeNull();
    expect(lockTimeout('ct-3100', undefined)).toBe(240_000);
    expect(lockTimeout('vitest-full', undefined)).toBe(120_000);
    expect(lockTimeout('ct-3100', '999999')).toBe(300_000);
  });

  it('allows unlocked tsc and Svelte runs to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      await gate.promise;
    });

    const runs = [
      runVerificationPlan(testPlan(testCheck('tsc-renderer', null)), lockRoot, options),
      runVerificationPlan(testPlan(testCheck('svelte-check', null)), lockRoot, options),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(['tsc-renderer', 'svelte-check']);
    gate.resolve();
    await Promise.all(runs);
  });

  it('serializes CT runs on the same port', async () => {
    const lockRoot = temporaryDirectory();
    const firstGate = deferred();
    const started: string[] = [];
    const options = runnerOptions(
      lockRoot,
      async (check) => {
        started.push(check.id);
        if (check.id === 'first') await firstGate.promise;
      },
      { CT_PORT: '3200' },
    );

    const first = runVerificationPlan(testPlan(testCheck('first', 'ct')), lockRoot, options);
    await waitUntil(() => started.length === 1);
    const second = runVerificationPlan(testPlan(testCheck('second', 'ct')), lockRoot, options);
    await new Promise((done) => setTimeout(done, 20));
    expect(started).toEqual(['first']);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('releases a CT lock before running the next unlocked check', async () => {
    const lockRoot = temporaryDirectory();
    const cheapGate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      if (check.id === 'cheap') await cheapGate.promise;
    });

    const first = runVerificationPlan(
      testPlan(testCheck('first-ct', 'ct'), testCheck('cheap', null)),
      lockRoot,
      options,
    );
    await waitUntil(() => started.includes('cheap'));
    const second = runVerificationPlan(testPlan(testCheck('second-ct', 'ct')), lockRoot, options);
    await waitUntil(() => started.includes('second-ct'));
    expect(started).toEqual(['first-ct', 'cheap', 'second-ct']);
    cheapGate.resolve();
    await Promise.all([first, second]);
  });

  it('allows CT runs on different ports to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const runCheck = async (check: ReturnType<typeof testCheck>) => {
      started.push(check.id);
      await gate.promise;
    };

    const runs = [
      runVerificationPlan(
        testPlan(testCheck('ct-3200', 'ct')),
        lockRoot,
        runnerOptions(lockRoot, runCheck, { CT_PORT: '3200' }),
      ),
      runVerificationPlan(
        testPlan(testCheck('ct-3201', 'ct')),
        lockRoot,
        runnerOptions(lockRoot, runCheck, { CT_PORT: '3201' }),
      ),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(expect.arrayContaining(['ct-3200', 'ct-3201']));
    gate.resolve();
    await Promise.all(runs);
  });

  it('allows full Vitest and CT to proceed concurrently', async () => {
    const lockRoot = temporaryDirectory();
    const gate = deferred();
    const started: string[] = [];
    const options = runnerOptions(lockRoot, async (check) => {
      started.push(check.id);
      await gate.promise;
    });

    const runs = [
      runVerificationPlan(testPlan(testCheck('vitest', 'vitest-full')), lockRoot, options),
      runVerificationPlan(testPlan(testCheck('ct', 'ct')), lockRoot, options),
    ];
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(expect.arrayContaining(['vitest', 'ct']));
    gate.resolve();
    await Promise.all(runs);
  });
});
