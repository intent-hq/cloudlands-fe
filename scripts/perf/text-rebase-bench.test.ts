// @vitest-environment node
// @verify-changed-triggers: ./text-rebase-bench.mjs, ./text-rebase-bench-lib.mjs
//
// The orchestration of `pnpm perf:text-rebase` — worktree add/remove, runner
// spawn, exit codes — exercised against a throwaway git repository under the OS
// temp dir, so the developer's real worktree list is never touched, with
// TEXT_REBASE_BENCH_RUNNER pointing at a stand-in runner instead of vitest.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const scriptsDir = path.resolve(__dirname);
const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

const FAKE_RUNNER = `
import { statSync } from 'node:fs';
const env = process.env;
if (!statSync(env.TEXT_REBASE_BENCH_SRC).isDirectory()) {
  console.error('TEXT_REBASE_BENCH_SRC is not a directory: ' + env.TEXT_REBASE_BENCH_SRC);
  process.exit(4);
}
if (env.FAKE_RUNNER_FAIL_TREE === env.TEXT_REBASE_BENCH_TREE) {
  console.error('fake runner failing on purpose');
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  tree: env.TEXT_REBASE_BENCH_TREE,
  sha: env.TEXT_REBASE_BENCH_SHA,
  mapperMode: 'bidirectional',
  rows: [{ shape: 'mixed', clock: 'cold', phase: 'natural', ms: 1, deadlineHit: null }],
}));
`;

describe.skipIf(!gitAvailable)('perf:text-rebase CLI', () => {
  let repo: string;
  let headSha: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const worktreeDirs = () => readdirSync(repo).filter((name) => name.startsWith('.wt-bench-'));
  const registeredWorktrees = () =>
    git('worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '));
  const runCli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [path.join(repo, 'scripts/perf/text-rebase-bench.mjs'), ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, TEXT_REBASE_BENCH_RUNNER: 'scripts/perf/fake-runner.mjs', ...env },
      timeout: 20_000,
    });

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'text-rebase-bench-cli-'));
    mkdirSync(path.join(repo, 'scripts/perf'), { recursive: true });
    mkdirSync(path.join(repo, 'src'));
    for (const name of ['text-rebase-bench.mjs', 'text-rebase-bench-lib.mjs']) {
      writeFileSync(
        path.join(repo, 'scripts/perf', name),
        readFileSync(path.join(scriptsDir, name)),
      );
    }
    writeFileSync(path.join(repo, 'scripts/perf/fake-runner.mjs'), FAKE_RUNNER);
    writeFileSync(path.join(repo, 'src/marker.txt'), 'checked out\n');
    writeFileSync(path.join(repo, '.gitignore'), '.wt-*/\n');
    git('init', '--quiet', '--initial-branch=main');
    git('-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'add', '.');
    git(
      '-c',
      'user.name=bench',
      '-c',
      'user.email=bench@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    );
    headSha = git('rev-parse', 'HEAD');
  });

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
  });

  it('exits 2 on a usage error without adding a worktree', () => {
    const result = runCli(['--base', 'HEAD', '--head', '']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--head requires a non-empty ref.');
    expect(result.stderr).toContain('usage: pnpm perf:text-rebase');
    expect(worktreeDirs()).toEqual([]);
    expect(registeredWorktrees()).toHaveLength(1);
  });

  it('exits 2 when --base is not a commit, without adding a worktree', () => {
    const result = runCli(['--base', 'no-such-ref']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--base no-such-ref is not a commit in');
    expect(worktreeDirs()).toEqual([]);
    expect(registeredWorktrees()).toHaveLength(1);
  });

  it('removes both worktrees and exits 1 when a runner fails', () => {
    const result = runCli(['--base', 'HEAD', '--head', 'HEAD', '--runs', '1'], {
      FAKE_RUNNER_FAIL_TREE: 'base',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('base runner exited with 3');
    expect(result.stderr).toContain('fake runner failing on purpose');
    expect(worktreeDirs()).toEqual([]);
    expect(registeredWorktrees()).toHaveLength(1);
  });

  it('runs the pairs in alternating order, prints the table, cleans up and exits 0', () => {
    const out = path.join(repo, 'result.json');
    const result = runCli(['--base', 'HEAD', '--head', 'HEAD', '--runs', '2', '--json', out]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('run 1/2: head then base');
    expect(result.stderr).toContain('run 2/2: base then head');
    expect(result.stdout).toContain(`head HEAD (${headSha.slice(0, 12)}) [bidirectional]`);
    expect(result.stdout).toContain('head/base order alternating per run');
    expect(result.stdout).toMatch(/mixed\s+cold\s+natural/);
    const payload = JSON.parse(readFileSync(out, 'utf8'));
    expect(payload.headSha).toBe(headSha);
    expect(payload.documents.head.map((d: { sha: string }) => d.sha)).toEqual([headSha, headSha]);
    expect(payload.summary[0].pairs).toBe(2);
    expect(worktreeDirs()).toEqual([]);
    expect(registeredWorktrees()).toHaveLength(1);
    expect(existsSync(path.join(repo, 'src/marker.txt'))).toBe(true);
  });
});
