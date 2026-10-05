// @vitest-environment node
// @verify-changed-triggers: package.json, scripts/run-unit-tests.mjs, scripts/unit-test-prerequisites.mjs, scripts/generate-build-config.cjs, scripts/transfer-selection-fixtures.mjs
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import { loadTransferSelectionFixtures } from './transfer-selection-fixtures.mjs';
import { pnpmInvocation } from './pnpm-launcher.mjs';

const repo = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const roots: string[] = [];
let canonical: Awaited<ReturnType<typeof loadTransferSelectionFixtures>>;
const contractTest =
  'src/lib/components/chat/input/ModelPicker.transfer-selection-contract.test.ts';
beforeAll(async () => {
  canonical = await loadTransferSelectionFixtures();
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(realVitest = false, monorepo = false) {
  const temporary = mkdtempSync(join(tmpdir(), 'test-unit-args-'));
  roots.push(temporary);
  const root = monorepo ? join(temporary, 'packages/cloudlands-fe') : temporary;
  const write = (file: string, content: string, mode?: number) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content, { mode });
  };
  write(
    'package.json',
    JSON.stringify({
      type: 'module',
      packageManager: manifest.packageManager,
      scripts: { 'test:unit': manifest.scripts['test:unit'] },
    }),
  );
  write(
    'scripts/check-deps-fresh.mjs',
    `import { appendFileSync } from 'node:fs';
appendFileSync('children.jsonl', JSON.stringify({ child: 'prepare', args: process.argv.slice(2) }) + '\\n');
if (process.env.PREP_SIGNAL) process.kill(process.pid, process.env.PREP_SIGNAL);
else process.exitCode = Number(process.env.PREP_EXIT || 0);
`,
  );
  mkdirSync(join(root, 'src/main'), { recursive: true });
  copyFileSync(
    join(repo, 'scripts/generate-build-config.cjs'),
    join(root, 'scripts/generate-build-config.cjs'),
  );
  const launcher = join(repo, 'scripts/run-unit-tests.mjs');
  copyFileSync(launcher, join(root, 'scripts/run-unit-tests.mjs'));
  for (const file of ['transfer-selection-fixtures.mjs', 'unit-test-prerequisites.mjs']) {
    const source = join(repo, 'scripts', file);
    if (existsSync(source)) copyFileSync(source, join(root, 'scripts', file));
  }
  const shared = monorepo ? temporary : join(root, 'shared');
  const fixtureRoot = join(shared, 'docs/protocol/fixtures/transfer-selection');
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(join(shared, 'scripts'), { recursive: true });
  copyFileSync(join(canonical.paths.root, 'contract.json'), join(fixtureRoot, 'contract.json'));
  copyFileSync(canonical.paths.generated, join(fixtureRoot, 'public-sessions.json'));
  copyFileSync(
    canonical.paths.validator,
    join(shared, 'scripts/check-transfer-selection-contract.mjs'),
  );
  if (realVitest) {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(repo, 'node_modules/vitest'), join(root, 'node_modules/vitest'), 'junction');
    write('vitest.config.ts', "export default { test: { environment: 'node' } };\n");
    write(
      'selected file.test.js',
      `import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
it('selected name with spaces', () => { writeFileSync('selected-ran', 'yes'); expect(1 + 1).toBe(2); });
it('unselected name', () => { throw new Error('name filter was lost'); });
`,
    );
    write(
      'unselected.test.js',
      "import { it } from 'vitest'; it('selected name with spaces', () => { throw new Error('file filter was lost'); });\n",
    );
  } else {
    write(
      'node_modules/vitest/vitest.mjs',
      `import { appendFileSync } from 'node:fs';
if (process.env.OBSERVE_BUILD_CONFIG) {
  const { BUILD_CONFIG } = await import('../../src/main/build-config.generated.ts');
  appendFileSync('observed-config.json', JSON.stringify(BUILD_CONFIG));
}
appendFileSync('children.jsonl', JSON.stringify({ child: 'vitest', args: process.argv.slice(2) }) + '\\n');
if (process.env.TEST_SIGNAL) process.kill(process.pid, process.env.TEST_SIGNAL);
else process.exitCode = Number(process.env.TEST_EXIT || 0);
`,
    );
  }
  // Also intercept the old shell command, so a regression never starts the real suite.
  write(
    'node_modules/.bin/vitest',
    '#!/bin/sh\nexec node node_modules/vitest/vitest.mjs "$@"\n',
    0o755,
  );
  write('node_modules/.bin/vitest.cmd', '@node node_modules/vitest/vitest.mjs %*\r\n');
  return { root, write, fixtureRoot };
}

function run(root: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  // Use the installed pnpm even when a direct Vitest invocation inherited npm's npm_execpath.
  const invocation = pnpmInvocation(['run', 'test:unit', ...args], { env: {} });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: root,
    env: {
      ...process.env,
      NODE_COMPILE_CACHE: join(root, 'node-compile-cache'),
      TRANSFER_SELECTION_FIXTURE_ROOT: join(
        root,
        'shared/docs/protocol/fixtures/transfer-selection',
      ),
      TRANSFER_SELECTION_GENERATED: undefined,
      ...env,
    },
    encoding: 'utf8',
    timeout: 20_000,
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.shell,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const log = join(root, 'children.jsonl');
  const children = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { ...result, output: result.stdout + result.stderr, children };
}

describe('test:unit package-script boundary', () => {
  it('rejects a leading literal separator before starting either child', () => {
    const { root } = fixture();
    const result = run(root, [
      '--',
      'selected.test.ts',
      '-t',
      'name with spaces',
      '--maxWorkers=1',
    ]);
    expect(result.children).toEqual([]);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/pnpm run test:unit <file> -t "<name>" --maxWorkers=1/);
  });

  it('rejects a separator even when dependencies are missing', () => {
    const { root } = fixture();
    rmSync(join(root, 'node_modules'), { recursive: true });
    rmSync(join(root, 'scripts/check-deps-fresh.mjs'));
    const result = run(root, ['--']);
    expect(result.status).not.toBe(0);
    expect(result.children).toEqual([]);
    expect(result.output).toContain('pnpm run test:unit <file>');
    expect(result.output).not.toContain('MODULE_NOT_FOUND');
  });

  it('preserves files, spaced name filters, worker options, and shell metacharacters', () => {
    const { root } = fixture();
    const args = [
      'selected file.test.ts',
      'another.test.ts',
      '-t',
      'name with spaces & $x',
      '--maxWorkers=1',
    ];
    const result = run(root, args);
    expect(result.status, result.output).toBe(0);
    expect(result.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts', ...args] },
    ]);
  });

  it('retains intentional no-argument full-suite execution', () => {
    const { root } = fixture();
    const result = run(root, []);
    expect(result.status, result.output).toBe(0);
    expect(result.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts'] },
    ]);
  });

  it('preserves a non-leading separator used as a name-filter value', () => {
    const { root } = fixture();
    const result = run(root, ['selected.test.ts', '-t', '--']);
    expect(result.status, result.output).toBe(0);
    expect(result.children[1].args).toEqual([
      'run',
      '--config',
      'vitest.config.ts',
      'selected.test.ts',
      '-t',
      '--',
    ]);
  });

  it('stops before Vitest when preparation fails and retains the failure code', () => {
    const { root } = fixture();
    const result = run(root, [], { PREP_EXIT: '7' });
    expect(result.status).toBe(7);
    expect(result.children).toEqual([{ child: 'prepare', args: [] }]);
  });

  it('retains the Vitest failure code', () => {
    const { root } = fixture();
    const result = run(root, [], { TEST_EXIT: '9' });
    expect(result.status).toBe(9);
    expect(result.children.map((child) => child.child)).toEqual(['prepare', 'vitest']);
  });

  it.each(['PREP_SIGNAL', 'TEST_SIGNAL'])(
    'does not turn a child signal into success (%s)',
    (key) => {
      const { root } = fixture();
      const result = run(root, [], { [key]: 'SIGTERM' });
      expect(result.status).not.toBe(0);
      expect(result.children.map((child) => child.child)).toEqual(
        key === 'PREP_SIGNAL' ? ['prepare'] : ['prepare', 'vitest'],
      );
    },
  );

  it('runs only the selected file and name in a tiny real Vitest suite', () => {
    const { root } = fixture(true);
    const result = run(root, [
      'selected file.test.js',
      '-t',
      'selected name with spaces',
      '--maxWorkers=1',
    ]);
    expect(result.status, result.output).toBe(0);
    expect(readFileSync(join(root, 'selected-ran'), 'utf8')).toBe('yes');
    expect(result.children).toEqual([{ child: 'prepare', args: [] }]);
  });
});

describe('canonical fixture preflight before Vitest', () => {
  it.each(['parent', 'dot segments', 'repeated separators', 'ancestor prefix'])(
    'preflights absolute ancestor filters with %s and preserves argv',
    (form) => {
      const { root, fixtureRoot } = fixture(false, true);
      const selection =
        form === 'dot segments'
          ? `${root}/../`
          : form === 'repeated separators'
            ? `${dirname(root)}//`
            : form === 'ancestor prefix'
              ? dirname(root).slice(0, -1)
              : dirname(root);
      const args = [selection, '--maxWorkers=1'];
      const env = { TRANSFER_SELECTION_FIXTURE_ROOT: fixtureRoot };
      rmSync(join(fixtureRoot, 'public-sessions.json'));
      const missing = run(root, args, env);
      expect(missing.children, missing.output).toEqual([{ child: 'prepare', args: [] }]);
      expect(missing.status).toBe(1);
      expect(missing.output).toContain(join(fixtureRoot, 'public-sessions.json'));

      copyFileSync(canonical.paths.generated, join(fixtureRoot, 'public-sessions.json'));
      rmSync(join(root, 'children.jsonl'));
      const valid = run(root, args, env);
      expect(valid.status, valid.output).toBe(0);
      expect(valid.children).toEqual([
        { child: 'prepare', args: [] },
        { child: 'vitest', args: ['run', '--config', 'vitest.config.ts', ...args] },
      ]);
    },
  );

  it.each([
    { args: ['--maxWorkers=', '1'], filters: [] },
    { args: ['-t=', 'unrelated-name'], filters: [] },
    { args: ['--silent=', 'passed-only'], filters: [] },
    {
      args: ['--globals=ModelPicker', 'unrelated.test.ts'],
      filters: ['ModelPicker', 'unrelated.test.ts'],
    },
    {
      args: ['--isolate=src/lib/components/chat', 'unrelated.test.ts'],
      filters: ['src/lib/components/chat', 'unrelated.test.ts'],
    },
  ])('preflights ambiguous equals arguments $args using the Vitest parser', ({ args, filters }) => {
    // The installed parser is independent of our conservative selection helper:
    // empty equals consumes the next value; boolean equals can add a file filter.
    const parsed = parseCLI(['vitest', 'run', '--config', 'vitest.config.ts', ...args]);
    expect(parsed.filter).toEqual(filters);
    expect(filters.length === 0 || filters.some((filter) => contractTest.includes(filter))).toBe(
      true,
    );

    const { root, fixtureRoot } = fixture();
    rmSync(join(fixtureRoot, 'public-sessions.json'));
    const missing = run(root, args);
    expect(missing.children, missing.output).toEqual([{ child: 'prepare', args: [] }]);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain(join(fixtureRoot, 'public-sessions.json'));
    expect(missing.output).toContain('TRANSFER_SELECTION_FIXTURE_ROOT=');

    copyFileSync(canonical.paths.generated, join(fixtureRoot, 'public-sessions.json'));
    rmSync(join(root, 'children.jsonl'));
    const valid = run(root, args);
    expect(valid.status, valid.output).toBe(0);
    expect(valid.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts', ...args] },
    ]);
  });

  it.each([
    [],
    [contractTest],
    ['src/lib/components/chat'],
    ['ModelPicker'],
    ['transfer-selection'],
    ['MODELpicker'],
    ['scripts/transfer-selection-fixtures.test.ts'],
    ['scripts/run-unit-tests.test.ts'],
    ['src'],
    ['.'],
    ['**/*.test.ts'],
    ['-t', 'unrelated name'],
    ['--testNamePattern=unrelated'],
    ['--reporter', 'unrelated.test.ts'],
    ['--maxWorkers', '1'],
    ['--silent', 'passed-only'],
    ['--silent', 'yes'],
    ['--watch', 'false'],
    ['--coverage', 'false'],
    ['--reporter=unrelated.test.ts'],
    ['--unknown-option', 'unrelated.test.ts'],
    ['unrelated.test.ts', '--config', 'custom.ts'],
    ['unrelated.test.ts', '--root', 'elsewhere'],
    ['related', 'unrelated.ts'],
    ['unrelated.test.ts', '--', 'ModelPicker'],
    ['unrelated.test.ts', 'ModelPicker'],
    [`${contractTest}:10`],
    ['./src/lib/../lib/components/chat/input/ModelPicker'],
  ])('requires fixtures for selection %j', (...args: string[]) => {
    const { root, fixtureRoot } = fixture();
    rmSync(join(fixtureRoot, 'public-sessions.json'));
    const result = run(root, args);
    expect(result.status, result.output).toBe(1);
    expect(result.children.map((child) => child.child)).not.toContain('vitest');
    expect(result.output).toContain(join(fixtureRoot, 'public-sessions.json'));
    expect(result.output).toContain('TRANSFER_SELECTION_FIXTURE_ROOT=');
    expect(result.output).toContain('pnpm run test:unit');
  });

  it.each([
    ['unrelated.test.ts'],
    ['src/features/notes'],
    ['pnpm-launcher'],
    ['unrelated.test.ts', '-t', 'ModelPicker'],
    ['--testNamePattern', 'ModelPicker', 'unrelated.test.ts'],
    ['unrelated.test.ts', '--reporter', 'ModelPicker', '--maxWorkers', '1'],
    ['unrelated.test.ts', '-t', '--'],
    ['unrelated.test.ts', '--silent', 'passed-only'],
    ['unrelated.test.ts', '--coverage=false', '--maxWorkers=1'],
    ['unrelated.test.ts', '--globals=true', '--isolate=false'],
  ])('keeps unrelated focused selection independent of fixtures %j', (...args: string[]) => {
    const { root } = fixture();
    rmSync(join(root, 'shared'), { recursive: true });
    const result = run(root, args);
    expect(result.status, result.output).toBe(0);
    expect(result.children).toEqual([
      { child: 'prepare', args: [] },
      { child: 'vitest', args: ['run', '--config', 'vitest.config.ts', ...args] },
    ]);
  });

  it.each([
    'missing root',
    'missing validator',
    'empty root',
    'missing contract',
    'invalid contract JSON',
    'invalid golden JSON',
    'invalid contract',
    'mismatched golden',
  ])('rejects %s using the real canonical validator', (change) => {
    const { root, fixtureRoot } = fixture();
    const env: NodeJS.ProcessEnv = {};
    let failingPath = fixtureRoot;
    if (change === 'missing root') {
      env.TRANSFER_SELECTION_FIXTURE_ROOT = undefined;
      failingPath = resolve(root, '../../scripts/check-transfer-selection-contract.mjs');
    } else if (change === 'missing validator') {
      failingPath = join(root, 'shared/scripts/check-transfer-selection-contract.mjs');
      rmSync(failingPath);
    } else if (change === 'empty root') {
      env.TRANSFER_SELECTION_FIXTURE_ROOT = '';
      failingPath = 'TRANSFER_SELECTION_FIXTURE_ROOT must be a non-empty path';
    } else {
      failingPath = join(
        fixtureRoot,
        change.includes('contract') ? 'contract.json' : 'public-sessions.json',
      );
      if (change === 'missing contract') rmSync(failingPath);
      else if (change.includes('JSON')) writeFileSync(failingPath, '{invalid');
      else {
        const data = JSON.parse(readFileSync(failingPath, 'utf8'));
        if (change === 'invalid contract') data.formatVersion = 99;
        else data.provenance.contractSha256 = '0'.repeat(64);
        writeFileSync(failingPath, JSON.stringify(data));
      }
    }
    const checked = run(root, [contractTest], env);
    expect(checked.status, checked.output).toBe(1);
    expect(checked.children.map((child) => child.child)).not.toContain('vitest');
    expect(checked.output).toContain(failingPath);
    expect(checked.output).toContain('TRANSFER_SELECTION_FIXTURE_ROOT=');
  });

  it('loads canonical inputs in the default monorepo layout', () => {
    const { root } = fixture(false, true);
    const result = run(root, [contractTest], { TRANSFER_SELECTION_FIXTURE_ROOT: undefined });
    expect(result.status, result.output).toBe(0);
    expect(result.children.map((child) => child.child)).toEqual(['prepare', 'vitest']);
  });

  it('validates a supplied generated output without requiring the golden', () => {
    const { root, fixtureRoot } = fixture();
    const generated = join(root, 'fresh responses.json');
    copyFileSync(join(fixtureRoot, 'public-sessions.json'), generated);
    rmSync(join(fixtureRoot, 'public-sessions.json'));
    const result = run(root, [contractTest], { TRANSFER_SELECTION_GENERATED: generated });
    expect(result.status, result.output).toBe(0);
    expect(result.children.map((child) => child.child)).toEqual(['prepare', 'vitest']);
  });

  it.each(['', 'missing.json'])('does not fall back from generated override %j', (generated) => {
    const { root } = fixture();
    const result = run(root, [contractTest], { TRANSFER_SELECTION_GENERATED: generated });
    expect(result.status, result.output).toBe(1);
    expect(result.children.map((child) => child.child)).not.toContain('vitest');
    expect(result.output).toContain(
      generated || 'TRANSFER_SELECTION_GENERATED must be a non-empty path',
    );
  });
});

describe('generated build input launcher prerequisite', () => {
  it.each(['missing', 'obsolete'])(
    'prepares %s input before the test child imports it',
    (state) => {
      const { root, write } = fixture();
      if (state === 'obsolete')
        write(
          'src/main/build-config.generated.ts',
          'export const BUILD_CONFIG = { GIT_COMMIT_HASH: "1515d8f61" } as const;',
        );
      const result = run(root, ['selected.test.ts'], {
        OBSERVE_BUILD_CONFIG: '1',
        INTENT_ISOLATED_TEST_BUILD_ID: 'manual-123-1',
        INTENT_ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
      });
      expect(result.status, result.output).toBe(0);
      expect(JSON.parse(readFileSync(join(root, 'observed-config.json'), 'utf8'))).toMatchObject({
        ISOLATED_TEST_BUILD_ID: 'manual-123-1',
        ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
      });
    },
  );

  it('rejects invalid inputs with existing output before spawning Vitest', () => {
    const { root, write } = fixture();
    write(
      'src/main/build-config.generated.ts',
      'export const BUILD_CONFIG = { GIT_COMMIT_HASH: "1515d8f61" } as const;',
    );
    const result = run(root, ['selected.test.ts'], {
      INTENT_ISOLATED_TEST_BUILD_ID: 'manual-123-1',
      INTENT_ISOLATED_TEST_BACKEND_SHA: '',
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Isolated test builds require');
    expect(result.children.map((child) => child.child)).toEqual(['prepare']);
  });
});
