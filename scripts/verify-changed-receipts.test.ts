// @vitest-environment node
// @verify-changed-exempt: reads only temporary fixture repositories it creates
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCoverage, obligationsFor, reconcile } from './verify-changed-coverage.mjs';
import {
  commandIdentity,
  configurationIdentity,
  createAttempt,
  diffSources,
  loadAttempts,
  loadTree,
  pruneAttempts,
  RECEIPT_SCHEMA,
  sourceIdentity,
} from './verify-changed-receipts.mjs';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verify-receipts-'));
  roots.push(root);
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  for (const [file, content] of Object.entries({ '.gitignore': 'ignored/\n', ...files }))
    write(file, content);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return { root, write };
}

function identities(root: string) {
  return {
    source: sourceIdentity(root),
    configuration: { digest: 'config', parts: {} },
    commands: [],
    selections: [],
  };
}

describe('source identity', () => {
  it('hashes tracked and untracked files, excluding ignored files and receipt storage', () => {
    const { root, write } = repo({ 'src/a.ts': 'a', 'ignored/x.ts': 'x' });
    execFileSync('git', ['add', 'src/a.ts'], { cwd: root });
    write('src/untracked.ts', 'u');
    write('.dev/verify-changed/attempts/x/run.json', '{}');
    symlinkSync('src/a.ts', join(root, 'link.ts'));
    const first = sourceIdentity(root);
    expect(Object.keys(first.files).sort()).toEqual([
      '.gitignore',
      'link.ts',
      'src/a.ts',
      'src/untracked.ts',
    ]);
    expect(first.files['src/a.ts']).toBe(
      execFileSync('git', ['hash-object', 'src/a.ts'], { cwd: root, encoding: 'utf8' }).trim(),
    );

    write('src/a.ts', 'changed');
    write('src/new.ts', 'n');
    rmSync(join(root, 'src/untracked.ts'));
    write('ignored/x.ts', 'still ignored');
    const second = sourceIdentity(root);
    expect(diffSources(first.files, second.files)).toEqual([
      'src/a.ts',
      'src/new.ts',
      'src/untracked.ts',
    ]);
    expect(second.digest).not.toBe(first.digest);
  });

  it('identifies a symlink by its target and a deleted tracked file by absence', () => {
    const { root } = repo({ 'a.ts': 'a', 'b.ts': 'b' });
    execFileSync('git', ['add', '.'], { cwd: root });
    symlinkSync('a.ts', join(root, 'link.ts'));
    const before = sourceIdentity(root);
    rmSync(join(root, 'link.ts'));
    symlinkSync('b.ts', join(root, 'link.ts'));
    rmSync(join(root, 'b.ts'));
    const after = sourceIdentity(root);
    expect(diffSources(before.files, after.files)).toEqual(['b.ts', 'link.ts']);
  });
});

describe('configuration identity', () => {
  const config = `export default { test: { setupFiles: ['./setup.ts'], globalSetup: ['./global.ts'] } };`;
  it('changes with config files, setup import closures, runtime and environment, not with ordinary source', () => {
    const { root, write } = repo({
      'vitest.config.ts': config,
      'setup.ts': "import './helper';\nvi.mock('./mocked');",
      'helper.ts': 'export {};',
      'mocked.ts': 'export {};',
      'global.ts': 'export {};',
      'src/a.ts': 'a',
    });
    const base = configurationIdentity(root, { env: {} }).digest;
    write('src/a.ts', 'edited');
    write('mocked.ts', 'export const replaced = true;');
    expect(configurationIdentity(root, { env: {} }).digest).toBe(base);

    for (const file of ['helper.ts', 'global.ts', 'vitest.config.ts', 'package.json']) {
      const previous = existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null;
      write(file, `${previous ?? ''}\n// edit`);
      expect(configurationIdentity(root, { env: {} }).digest, file).not.toBe(base);
      if (previous === null) rmSync(join(root, file));
      else write(file, previous);
    }
    expect(configurationIdentity(root, { env: {} }).digest).toBe(base);
    expect(configurationIdentity(root, { env: {}, nodeVersion: 'v0.0.0' }).digest).not.toBe(base);
    expect(configurationIdentity(root, { env: { CI: 'true' } }).digest).not.toBe(base);
  });
});

describe('attempt records', () => {
  it('never rewrites an attempt, tolerates a torn final line and skips foreign or corrupt attempts', () => {
    const { root } = repo({ 'a.ts': 'a' });
    const attempt = createAttempt(root, { argv: ['--resume'], identities: identities(root) });
    attempt.append({ type: 'check-end', id: 'x', invocation: 'x#1', status: 'passed' });
    appendFileSync(attempt.resultsPath, '{"type":"unit-fi');
    expect(() => attempt.writeFile('run.json', '{}')).toThrow(/EEXIST/);
    const [loaded] = loadAttempts(root);
    expect(loaded.run.schema).toBe(RECEIPT_SCHEMA);
    expect(loaded.run.argv).toEqual(['--resume']);
    expect(loaded.results.map((record: { type: string }) => record.type)).toEqual(['check-end']);
    expect(loadTree(root, attempt.run.identities.source.digest)).toEqual(
      sourceIdentity(root).files,
    );

    const foreign = createAttempt(root, { identities: identities(root) });
    const runPath = join(foreign.directory, 'run.json');
    writeFileSync(
      runPath,
      readFileSync(runPath, 'utf8').replace(`"schema": ${RECEIPT_SCHEMA}`, '"schema": 0'),
    );
    const corrupt = createAttempt(root, { identities: identities(root) });
    writeFileSync(join(corrupt.directory, 'run.json'), 'not json');
    expect(loadAttempts(root).map((entry: { id: string }) => entry.id)).toEqual([attempt.id]);
  });

  it('prunes whole attempts untouched for the retention window and then their unreferenced trees', () => {
    const { root, write } = repo({ 'a.ts': 'a' });
    const old = createAttempt(root, { identities: identities(root) });
    const oldTree = old.run.identities.source.digest;
    write('a.ts', 'b');
    const fresh = createAttempt(root, { identities: identities(root) });
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const name of ['run.json', 'results.jsonl'])
      utimesSync(join(old.directory, name), longAgo, longAgo);
    utimesSync(join(root, '.dev/verify-changed/trees', `${oldTree}.json`), longAgo, longAgo);
    pruneAttempts(root);
    expect(existsSync(old.directory)).toBe(false);
    expect(existsSync(fresh.directory)).toBe(true);
    expect(loadTree(root, oldTree)).toBeNull();
    expect(loadTree(root, fresh.run.identities.source.digest)).not.toBeNull();
  });
});

describe('coverage contract', () => {
  const lane = {
    id: 'vitest-related',
    label: 'related',
    executable: 'pnpm',
    args: ['exec', 'vitest', 'related', '--run', '--config', 'vitest.config.ts', 'src/a.ts'],
    lockKind: null,
  };
  const lint = {
    id: 'eslint',
    label: 'eslint',
    executable: 'pnpm',
    args: ['exec', 'eslint'],
    lockKind: null,
  };
  const plan = { checks: [lint, lane] };
  const selections = [{ id: 'vitest-related', files: ['a.test.ts', 'b.test.ts'] }];
  const file = (fileName: string, state: string, invocation = 'vitest-related#2') => ({
    type: 'unit-file',
    lane: 'vitest-related',
    config: 'vitest.config.ts',
    invocation,
    file: fileName,
    state,
  });
  const end = (id: string, status: string, invocation: string, command: string) => ({
    type: 'check-end',
    id,
    invocation,
    command,
    status,
  });

  it('is incomplete when a lane exits cleanly but a resolved file never reported', () => {
    const coverage = buildCoverage({
      attemptId: 'now',
      obligations: obligationsFor(plan, selections),
      credits: null,
      results: [
        end('eslint', 'passed', 'eslint#1', commandIdentity(lint)),
        file('a.test.ts', 'passed'),
        end('vitest-related', 'passed', 'vitest-related#2', commandIdentity(lane)),
      ],
    });
    expect(coverage.complete).toBe(false);
    expect(coverage.unitFiles).toEqual([
      expect.objectContaining({ file: 'a.test.ts', status: 'executed-passed' }),
      expect.objectContaining({ file: 'b.test.ts', status: 'unfinished' }),
    ]);
    expect(coverage.counts.checks['executed-passed']).toBe(2);
  });

  async function credited(results: object[]) {
    const tree = { 'a.ts': '1' };
    const credits = await reconcile({
      plan,
      selections,
      configuration: { digest: 'config' },
      source: { files: tree },
      attempts: [
        {
          id: 'earlier',
          run: { identities: { configuration: { digest: 'config' }, source: { digest: 't' } } },
          results,
        },
      ],
      loadTree: () => tree,
      invalidatedFiles: async () => ({ all: false, files: new Set() }),
    });
    return {
      files: [...credits.files.keys()].map((key) => key.split('\0')[1]),
      checks: [...credits.checks.keys()],
    };
  }

  it('credits finished files of an interrupted invocation but not a failed file', async () => {
    expect(await credited([file('a.test.ts', 'passed'), file('b.test.ts', 'failed')])).toEqual({
      files: ['a.test.ts'],
      checks: [],
    });
  });

  it('withholds file credit when the invocation failed without a failing file or had unhandled errors', async () => {
    const command = commandIdentity(lane);
    expect(
      await credited([
        file('a.test.ts', 'passed'),
        file('b.test.ts', 'passed'),
        end('vitest-related', 'failed', 'vitest-related#2', command),
      ]),
    ).toEqual({ files: [], checks: [] });
    expect(
      await credited([
        file('a.test.ts', 'passed'),
        file('b.test.ts', 'passed'),
        {
          type: 'unit-run-end',
          invocation: 'vitest-related#2',
          reason: 'failed',
          unhandledErrors: 1,
        },
      ]),
    ).toEqual({ files: [], checks: [] });
    expect(
      await credited([
        file('a.test.ts', 'passed'),
        file('b.test.ts', 'passed'),
        end('eslint', 'passed', 'eslint#1', commandIdentity(lint)),
      ]),
    ).toEqual({ files: ['a.test.ts', 'b.test.ts'], checks: ['eslint', 'vitest-related'] });
  });

  it('credits a non-unit check only for the identical command', async () => {
    expect(
      await credited([
        end('eslint', 'passed', 'eslint#1', commandIdentity({ ...lint, args: ['other'] })),
      ]),
    ).toEqual({ files: [], checks: [] });
  });
});
