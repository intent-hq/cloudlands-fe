// @vitest-environment node
// @verify-changed-triggers: scripts/verify-changed.mjs, scripts/verify-unit-selection.mjs
// @verify-changed-triggers: scripts/verify-changed-receipts.mjs, scripts/verify-changed-coverage.mjs
// @verify-changed-triggers: scripts/verify-changed-receipt-reporter.mjs, scripts/verify-changed-run-files.mjs
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerificationPlan, runVerificationPlan } from './verify-changed.mjs';

const plannerUrl = new URL('./verify-changed.mjs', import.meta.url).href;
const UNIT_LANES = new Set([
  'vitest-direct',
  'vitest-related',
  'vitest-declared',
  'vitest-ui-invariants',
]);
const FIXTURE_CONFIG =
  "export default { test: { environment: 'node', maxWorkers: 2, include: ['src/**/*.test.ts'] } };\n";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
afterEach(() => vi.unstubAllEnvs());

type Coverage = {
  attempt: string;
  complete: boolean;
  checks: Array<{ id: string; status: string; source_attempt?: string }>;
  unitFiles: Array<{ lane: string; file: string; status: string; source_attempt?: string }>;
};

// A tiny real package: git, the installed Vitest, an import graph, a declared
// disk-reading suite and a UI-invariant suite. Every test body appends its
// file name to an ignored journal, which is the execution oracle.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'verify-resume-'));
  const outside = mkdtempSync(join(tmpdir(), 'verify-resume-flags-'));
  roots.push(root, outside);
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction');
  write('.gitignore', 'node_modules\n.dev/\nbodies.jsonl\n');
  vi.stubEnv('NODE_COMPILE_CACHE', join(outside, 'compile-cache'));
  write(
    'package.json',
    JSON.stringify({
      type: 'module',
      scripts: {
        'test:ui-invariants': `node ${JSON.stringify(resolve('scripts/ui-invariant-suites.mjs'))}`,
      },
    }),
  );
  write('vitest.config.ts', FIXTURE_CONFIG);
  const body = (name: string, extra = '') =>
    `import { appendFileSync } from 'node:fs';
${extra}
it('runs', async () => { appendFileSync(${JSON.stringify(join(root, 'bodies.jsonl'))}, ${JSON.stringify(name)} + '\\n'); BODY });`;
  const test = (name: string, imports: string, assertion = 'expect(1).toBe(1);', header = '') =>
    write(
      name,
      `${header}import { it, expect } from 'vitest';\n${imports}\n${body(name).replace('BODY', assertion)}`,
    );
  write('src/a.ts', 'export const a = 1;\n');
  write('src/b.ts', 'export const b = 2;\n');
  test('src/a.test.ts', "import { a } from './a';", 'expect(a).toBe(1);');
  // Fails while a flag outside the package exists; the flag is not source.
  const failFlag = join(outside, 'fail-b');
  test(
    'src/b.test.ts',
    `import { b } from './b';\nimport { existsSync } from 'node:fs';`,
    `expect(existsSync(${JSON.stringify(failFlag)})).toBe(false); expect(b).toBe(2);`,
    '// @verify-changed-exempt: reads only an external fixture flag\n',
  );
  // A declared suite that reads src/b.ts from disk; `expected` makes it pass or fail.
  const writeContract = (expected: string) =>
    test(
      'src/contract.test.ts',
      "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';",
      `expect(readFileSync(join(process.cwd(), 'src/b.ts'), 'utf8')).toContain(${JSON.stringify(expected)});`,
      '// @verify-changed-triggers: src/b.ts\n',
    );
  writeContract('b');
  test('src/ui.test.ts', '', 'expect(true).toBe(true);', '// @ui-invariant\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  const bodies = () => {
    const path = join(root, 'bodies.jsonl');
    const lines = existsSync(path)
      ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    rmSync(path, { force: true });
    return lines.sort();
  };
  return { root, write, writeContract, bodies, failFlag, outside };
}

function marker() {
  return {
    id: 'fixture-check',
    label: 'fixture-check',
    executable: process.execPath,
    args: ['-e', "require('fs').appendFileSync('bodies.jsonl', 'fixture-check\\n')"],
    lockKind: null,
  };
}

function plan(root: string, changed: string[]) {
  const planned = createVerificationPlan(changed, { root, ctTests: [] });
  return {
    ...planned,
    prerequisites: [],
    checks: [
      ...planned.checks
        .filter((check: { id: string }) => UNIT_LANES.has(check.id))
        .map((check: { dependsOn?: string[] }) => ({ ...check, dependsOn: [] })),
      marker(),
    ],
  };
}

function attempts(root: string) {
  const directory = join(root, '.dev/verify-changed/attempts');
  return existsSync(directory) ? readdirSync(directory).sort() : [];
}

function coverageOf(root: string, attempt: string): Coverage {
  return JSON.parse(
    readFileSync(join(root, '.dev/verify-changed/attempts', attempt, 'coverage.json'), 'utf8'),
  );
}

async function verify(root: string, changed: string[], options: Record<string, unknown> = {}) {
  const before = new Set(attempts(root));
  const lines: string[] = [];
  let error: string | undefined;
  try {
    await runVerificationPlan(plan(root, changed), root, {
      record: true,
      log: (line: string) => lines.push(line),
      ...options,
    });
  } catch (cause) {
    error = (cause as Error).message;
  }
  const created = attempts(root).filter((attempt) => !before.has(attempt));
  const attempt = created[0];
  const coverage = attempt ? coverageOf(root, attempt) : undefined;
  return { lines, error, attempt, coverage };
}

const statuses = (coverage: Coverage | undefined) =>
  Object.fromEntries(
    (coverage?.unitFiles ?? []).map((entry) => [`${entry.lane} ${entry.file}`, entry.status]),
  );

describe('verify:changed continuation with real fixture graphs', { timeout: 180_000 }, () => {
  it('records every obligation, then an unchanged resume reruns nothing and credits each source', async () => {
    const { root, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    const first = await verify(root, changed);
    expect(first.error).toBeUndefined();
    expect(first.coverage?.complete).toBe(true);
    expect(bodies()).toEqual([
      'fixture-check',
      'src/a.test.ts',
      'src/b.test.ts',
      'src/contract.test.ts',
      'src/ui.test.ts',
    ]);
    const run = JSON.parse(
      readFileSync(join(root, '.dev/verify-changed/attempts', first.attempt!, 'run.json'), 'utf8'),
    );
    expect(Object.keys(run.identities)).toEqual(
      expect.arrayContaining(['source', 'configuration', 'commands', 'selections']),
    );

    const resumed = await verify(root, changed, { resume: true });
    expect(resumed.error).toBeUndefined();
    expect(bodies()).toEqual([]);
    expect(resumed.coverage?.complete).toBe(true);
    expect(resumed.coverage?.unitFiles.length).toBe(first.coverage?.unitFiles.length);
    for (const entry of resumed.coverage!.unitFiles) {
      expect(entry.status).toBe('resumed-passed');
      expect(entry.source_attempt).toBe(first.attempt);
    }
    expect(resumed.coverage?.checks.find((check) => check.id === 'fixture-check')).toMatchObject({
      status: 'resumed-passed',
      source_attempt: first.attempt,
    });
  });

  it('reruns an edited declared test in its new direct lane and credits unaffected passes (cloudlands-fe#3439)', async () => {
    const { root, writeContract, bodies } = fixture();
    // The declared source contract fails after the related lane passed.
    writeContract('zzz');
    const failed = await verify(root, ['src/b.ts']);
    expect(failed.error).toMatch(/failed/);
    expect(statuses(failed.coverage)['vitest-declared src/contract.test.ts']).toBe('failed');
    expect(statuses(failed.coverage)['vitest-related src/b.test.ts']).toBe('executed-passed');
    bodies();

    // Test-only correction: the edited suite is now a changed test (direct lane).
    writeContract('b');
    const resumed = await verify(root, ['src/b.ts', 'src/contract.test.ts'], { resume: true });
    expect(resumed.error).toBeUndefined();
    // The UI-invariant lane never ran after the earlier failure, so it runs now.
    expect(bodies()).toEqual(['fixture-check', 'src/contract.test.ts', 'src/ui.test.ts']);
    expect(resumed.coverage?.complete).toBe(true);
    expect(statuses(resumed.coverage)).toMatchObject({
      'vitest-direct src/contract.test.ts': 'executed-passed',
      'vitest-related src/b.test.ts': 'resumed-passed',
      'vitest-ui-invariants src/ui.test.ts': 'executed-passed',
    });
    expect(Object.keys(statuses(resumed.coverage))).not.toContain(
      'vitest-declared src/contract.test.ts',
    );
  });

  it('reruns only tests related to an edited source, plus triggered declared and UI-invariant suites', async () => {
    const { root, write, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    expect((await verify(root, changed)).coverage?.complete).toBe(true);
    bodies();

    write('src/a.ts', 'export const a = 1; // edited\n');
    const afterA = await verify(root, changed, { resume: true });
    expect(afterA.error).toBeUndefined();
    expect(bodies()).toEqual(['fixture-check', 'src/a.test.ts', 'src/ui.test.ts']);
    expect(statuses(afterA.coverage)).toMatchObject({
      'vitest-related src/a.test.ts': 'executed-passed',
      'vitest-related src/b.test.ts': 'resumed-passed',
      'vitest-declared src/contract.test.ts': 'resumed-passed',
      'vitest-ui-invariants src/ui.test.ts': 'executed-passed',
    });

    write('src/b.ts', 'export const b = 2; // edited\n');
    const afterB = await verify(root, changed, { resume: true });
    expect(afterB.coverage?.complete).toBe(true);
    expect(bodies()).toEqual([
      'fixture-check',
      'src/b.test.ts',
      'src/contract.test.ts',
      'src/ui.test.ts',
    ]);
  });

  it('credits nothing after a configuration change', async () => {
    const { root, write, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    expect((await verify(root, changed)).coverage?.complete).toBe(true);
    bodies();
    write('vitest.config.ts', `${FIXTURE_CONFIG}// configuration edit\n`);
    const resumed = await verify(root, changed, { resume: true });
    expect(resumed.coverage?.complete).toBe(true);
    expect(bodies()).toEqual([
      'fixture-check',
      'src/a.test.ts',
      'src/b.test.ts',
      'src/contract.test.ts',
      'src/ui.test.ts',
    ]);
    expect(
      [...resumed.coverage!.checks, ...resumed.coverage!.unitFiles].every(
        (entry) => entry.status === 'executed-passed',
      ),
    ).toBe(true);
  });

  it('never credits a failed file, and a later compatible failure supersedes an earlier pass', async () => {
    const { root, bodies, failFlag } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    writeFileSync(failFlag, '');
    const failed = await verify(root, changed);
    expect(failed.error).toMatch(/failed/);
    expect(statuses(failed.coverage)['vitest-related src/b.test.ts']).toBe('failed');
    bodies();
    rmSync(failFlag);

    const resumed = await verify(root, changed, { resume: true });
    expect(resumed.coverage?.complete).toBe(true);
    // The failed lane stopped the run, so later lanes and the marker never ran.
    expect(bodies()).toEqual([
      'fixture-check',
      'src/b.test.ts',
      'src/contract.test.ts',
      'src/ui.test.ts',
    ]);
    expect(statuses(resumed.coverage)['vitest-related src/a.test.ts']).toBe('resumed-passed');
    expect(statuses(resumed.coverage)['vitest-related src/b.test.ts']).toBe('executed-passed');

    // A later recorded failure (not resumed) must win over the earlier pass.
    writeFileSync(failFlag, '');
    expect((await verify(root, changed)).error).toMatch(/failed/);
    rmSync(failFlag);
    bodies();
    const again = await verify(root, changed, { resume: true });
    expect(again.coverage?.complete).toBe(true);
    expect(statuses(again.coverage)['vitest-related src/b.test.ts']).toBe('executed-passed');
  });

  it('reruns everything when earlier evidence is missing, corrupt or from another schema', async () => {
    const { root, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    const first = await verify(root, changed);
    expect(first.coverage?.complete).toBe(true);
    bodies();
    const runPath = join(root, '.dev/verify-changed/attempts', first.attempt!, 'run.json');
    const original = readFileSync(runPath, 'utf8');
    const all = [
      'fixture-check',
      'src/a.test.ts',
      'src/b.test.ts',
      'src/contract.test.ts',
      'src/ui.test.ts',
    ];

    writeFileSync(runPath, original.replace('"schema": 1', '"schema": 999'));
    await verify(root, changed, { resume: true });
    expect(bodies()).toEqual(all);
    for (const attempt of attempts(root).filter((id) => id !== first.attempt))
      rmSync(join(root, '.dev/verify-changed/attempts', attempt), { recursive: true });

    writeFileSync(runPath, '{ torn');
    await verify(root, changed, { resume: true });
    expect(bodies()).toEqual(all);
    for (const attempt of attempts(root).filter((id) => id !== first.attempt))
      rmSync(join(root, '.dev/verify-changed/attempts', attempt), { recursive: true });

    writeFileSync(runPath, original);
    rmSync(join(root, '.dev/verify-changed/trees'), { recursive: true });
    const missingTree = await verify(root, changed, { resume: true });
    expect(bodies()).toEqual(all);
    expect(missingTree.coverage?.complete).toBe(true);
  });

  it('credits a non-unit check only for identical sources, while unaffected unit files stay credited', async () => {
    const { root, write, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    expect((await verify(root, changed)).coverage?.complete).toBe(true);
    bodies();
    write('docs/notes.md', '# unrelated\n');
    const resumed = await verify(root, changed, { resume: true });
    expect(resumed.coverage?.complete).toBe(true);
    expect(bodies()).toEqual(['fixture-check']);
    expect(resumed.coverage?.checks.find((check) => check.id === 'fixture-check')?.status).toBe(
      'executed-passed',
    );
  });

  it('keeps the selection budget on the full resolved plan and never truncates', async () => {
    const { root, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    expect((await verify(root, changed)).coverage?.complete).toBe(true);
    bodies();
    const capped = await verify(root, changed, { resume: true, maxUnitFiles: 2 });
    expect(capped.error).toMatch(/4 unit files exceed --max-unit-files 2/);
    expect(capped.attempt).toBeUndefined();
    expect(bodies()).toEqual([]);
  });

  it('previews a continuation with --resolved-plan --resume without running or recording', async () => {
    const { root, write, bodies } = fixture();
    const changed = ['src/a.ts', 'src/b.ts'];
    expect((await verify(root, changed)).coverage?.complete).toBe(true);
    bodies();
    write('src/a.ts', 'export const a = 1; // edited\n');
    const preview = await verify(root, changed, { resume: true, resolvedPlan: true });
    expect(preview.error).toBeUndefined();
    expect(preview.attempt).toBeUndefined();
    expect(bodies()).toEqual([]);
    expect(preview.lines).toContain('  - vitest-related: 1 of 2 file(s) to run');
    expect(preview.lines).toContain('  - vitest-declared: satisfied by compatible receipts');
  });

  it('keeps finished files from an interrupted attempt and reruns only unfinished work', async () => {
    const { root, write, bodies, outside } = fixture();
    const hold = join(outside, 'hold');
    write(
      'src/slow.test.ts',
      `// @verify-changed-exempt: waits on an external fixture flag
import { it } from 'vitest';
import { appendFileSync, existsSync } from 'node:fs';
import { b } from './b';
it('waits', async () => {
  if (b !== 2) throw new Error('unexpected fixture value');
  while (existsSync(${JSON.stringify(hold)})) await new Promise((done) => setTimeout(done, 50));
  appendFileSync(${JSON.stringify(join(root, 'bodies.jsonl'))}, 'src/slow.test.ts\\n');
}, 120_000);`,
    );
    writeFileSync(hold, '');
    const changed = ['src/a.ts', 'src/b.ts'];
    const driver = join(outside, 'driver.mjs');
    writeFileSync(
      driver,
      `import { installTerminationHandlers, runVerificationPlan } from ${JSON.stringify(plannerUrl)};
const { onAttempt } = installTerminationHandlers();
await runVerificationPlan(${JSON.stringify(plan(root, changed))}, process.cwd(), { record: true, onAttempt, log() {} });`,
    );
    // A killed runner cannot clean its own temp files; keep them in the fixture.
    const scratch = join(outside, 'tmp');
    mkdirSync(scratch);
    const child = spawn(process.execPath, [driver], {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
    });
    const exited = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
    const resultsFile = () => {
      const [attempt] = attempts(root);
      return attempt ? join(root, '.dev/verify-changed/attempts', attempt, 'results.jsonl') : '';
    };
    const deadline = Date.now() + 90_000;
    while (!(
      resultsFile() &&
      existsSync(resultsFile()) &&
      readFileSync(resultsFile(), 'utf8').includes('"file":"src/b.test.ts"')
    )) {
      if (Date.now() > deadline) throw new Error('fixture lane never reported a finished file');
      await new Promise((done) => setTimeout(done, 100));
    }
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    rmSync(hold);
    const [interrupted] = attempts(root);
    const partial = coverageOf(root, interrupted);
    expect(partial.complete).toBe(false);
    expect(statuses(partial)['vitest-related src/b.test.ts']).toBe('executed-passed');
    expect(statuses(partial)['vitest-related src/slow.test.ts']).toBe('unfinished');
    // Allow an orphaned worker that observed the released hold to settle.
    await new Promise((done) => setTimeout(done, 500));
    bodies();

    const resumed = await verify(root, changed, { resume: true });
    expect(resumed.error).toBeUndefined();
    expect(resumed.coverage?.complete).toBe(true);
    const ran = bodies();
    expect(ran).toContain('src/slow.test.ts');
    expect(ran).not.toContain('src/b.test.ts');
    expect(statuses(resumed.coverage)['vitest-related src/b.test.ts']).toBe('resumed-passed');
  });
});
