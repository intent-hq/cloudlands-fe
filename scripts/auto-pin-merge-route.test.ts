// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { decidePinMergeRoute } from './auto-pin-merge-route.mjs';

const SCRIPT = resolve(__dirname, 'auto-pin-merge-route.mjs');
const PIN_A = '0.11.14';
const PIN_B = '0.11.15';
const MODULE = 'src/test/current-protocol-version.ts';

const pinFile = (version: string) =>
  `# Exact intentd version bundled as the sidecar.\n# Bump by PR.\n${version}\n`;
const moduleFile = (pin: string, protocol: string) =>
  `// GENERATED header.\n// source-pin: ${pin}\nexport const CURRENT_PROTOCOL_VERSION = '${protocol}';\n`;

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * `upstream` plays GitHub (its `main` is live main; like GitHub it serves
 * any reachable commit by SHA). `run` is the workflow's shallow checkout of
 * main taken at run start, as actions/checkout makes it.
 */
function setup(): { upstream: string; run: string } {
  const root = mkdtempSync(join(tmpdir(), 'auto-pin-merge-route-'));
  tempDirs.push(root);
  const upstream = join(root, 'upstream');
  execFileSync('git', ['init', '-q', '-b', 'main', upstream]);
  git(upstream, 'config', 'user.email', 'test@example.com');
  git(upstream, 'config', 'user.name', 'Test');
  git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  mkdirSync(join(upstream, 'src/test'), { recursive: true });
  writeFileSync(join(upstream, 'intentd.version'), pinFile(PIN_A));
  writeFileSync(join(upstream, MODULE), moduleFile(PIN_A, '15.0'));
  writeFileSync(join(upstream, 'src.ts'), 'export const value = 1;\n');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', 'base');

  const run = join(root, 'run');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, run]);
  git(run, 'config', 'user.email', 'bot@example.com');
  git(run, 'config', 'user.name', 'Bot');
  return { upstream, run };
}

/** The workflow's pin commit, built in `repo` on top of its current HEAD. */
function commitPinBump(
  repo: string,
  { protocol = '15.0', extra = false }: { protocol?: string; extra?: boolean } = {},
): string {
  writeFileSync(join(repo, 'intentd.version'), pinFile(PIN_B));
  writeFileSync(join(repo, MODULE), moduleFile(PIN_B, protocol));
  if (extra) writeFileSync(join(repo, 'src.ts'), 'export const value = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `fix: bump intentd sidecar to v${PIN_B}`);
  return git(repo, 'rev-parse', 'HEAD');
}

/** Another PR landing on live main after the pin branch was cut. */
function advanceMain(upstream: string): string {
  writeFileSync(join(upstream, 'other.ts'), 'export const other = 1;\n');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', 'feat: unrelated change');
  return git(upstream, 'rev-parse', 'HEAD');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('decidePinMergeRoute', () => {
  it('routes a plain pin bump on live main with a green CI Gate to a direct merge', () => {
    const { upstream, run } = setup();
    const head = commitPinBump(run);
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('direct');
    expect(result.mainSha).toBe(git(upstream, 'rev-parse', 'main'));
  });

  it('fetches a tested head that only exists on the remote', () => {
    const { upstream, run } = setup();
    git(upstream, 'checkout', '-q', '-b', 'auto/intentd-pin');
    const head = commitPinBump(upstream);
    git(upstream, 'checkout', '-q', 'main');
    expect(() => git(run, 'cat-file', '-e', `${head}^{commit}`)).toThrow();
    expect(decidePinMergeRoute({ head, ciGate: 'success', cwd: run }).route).toBe('direct');
  });

  it('still merges directly when main moved without touching the pin files', () => {
    const { upstream, run } = setup();
    const head = commitPinBump(run);
    const mainSha = advanceMain(upstream);
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('direct');
    expect(result.mainSha).toBe(mainSha);
  });

  it.each([
    ['intentd.version', pinFile('0.11.16')],
    [MODULE, moduleFile(PIN_A, '16.0')],
  ])('keeps the queue when main changed %s after the PR was cut', (path, content) => {
    const { upstream, run } = setup();
    const head = commitPinBump(run);
    advanceMain(upstream);
    writeFileSync(join(upstream, path), content);
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '-qm', `change ${path} on main`);
    const mainSha = git(upstream, 'rev-parse', 'HEAD');
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('queue');
    expect(result.mainSha).toBe(mainSha);
    expect(result.reason).toContain(`changed ${path} since the PR's base`);
  });

  it('keeps the queue when the tested head shares no history with main', () => {
    const { upstream, run } = setup();
    git(upstream, 'checkout', '-q', '--orphan', 'unrelated');
    const head = commitPinBump(upstream);
    git(upstream, 'checkout', '-q', 'main');
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('queue');
    expect(result.reason).toContain('shares no history');
  });

  it('keeps the queue for a pin bump that changes the protocol version', () => {
    const { run } = setup();
    const head = commitPinBump(run, { protocol: '16.0' });
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('queue');
    expect(result.reason).toContain(`protocol version change in ${MODULE}`);
  });

  it('keeps the queue when the diff carries more than the pin', () => {
    const { run } = setup();
    const head = commitPinBump(run, { extra: true });
    const result = decidePinMergeRoute({ head, ciGate: 'success', cwd: run });
    expect(result.route).toBe('queue');
    expect(result.reason).toContain('not a sidecar pin-bump diff');
  });

  it.each([
    'pending',
    'missing',
    'FAILURE',
    'SUCCESS,FAILURE',
    'blocked:changes-requested',
    'blocked:review-threads=1',
    'head-mismatch:' + 'b'.repeat(40),
    '',
  ])('keeps the queue when CI Gate is %j', (ciGate) => {
    const { run } = setup();
    const head = commitPinBump(run);
    expect(decidePinMergeRoute({ head, ciGate, cwd: run }).route).toBe('queue');
  });

  it.each(['', 'HEAD', 'abc123', 'A'.repeat(40)])('keeps the queue for tested head %j', (head) => {
    const { run } = setup();
    commitPinBump(run);
    expect(decidePinMergeRoute({ head, ciGate: 'success', cwd: run }).route).toBe('queue');
  });

  it('throws when live main cannot be fetched', () => {
    const { run } = setup();
    const head = commitPinBump(run);
    git(run, 'remote', 'set-url', 'origin', join(run, 'missing-remote'));
    expect(() => decidePinMergeRoute({ head, ciGate: 'success', cwd: run })).toThrow(
      /cannot fetch origin\/main/,
    );
  });
});

describe('auto-pin-merge-route CLI', () => {
  const runCli = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

  it('prints the direct route and live main sha as GITHUB_OUTPUT lines', () => {
    const { upstream, run } = setup();
    const head = commitPinBump(run);
    const out = runCli(run, ['--head', head, '--ci-gate', 'success']);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual([
      'route=direct',
      `main_sha=${git(upstream, 'rev-parse', 'main')}`,
    ]);
  });

  it('prints the queue route with an empty main sha for a non-green gate', () => {
    const { run } = setup();
    const head = commitPinBump(run);
    const out = runCli(run, ['--head', head, '--ci-gate', 'pending']);
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['route=queue', 'main_sha=']);
  });

  it('exits non-zero on missing arguments', () => {
    const { run } = setup();
    expect(runCli(run, ['--head']).status).toBe(2);
    expect(runCli(run, ['--ci-gate', 'success']).status).toBe(2);
  });

  it('exits non-zero without a route when main cannot be fetched', () => {
    const { run } = setup();
    const head = commitPinBump(run);
    git(run, 'remote', 'set-url', 'origin', join(run, 'missing-remote'));
    const out = runCli(run, ['--head', head, '--ci-gate', 'success']);
    expect(out.status).toBe(2);
    expect(out.stdout).not.toContain('route=');
  });
});
