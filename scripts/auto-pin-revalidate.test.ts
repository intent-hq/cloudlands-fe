// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { revalidateAgainstLiveMain } from './auto-pin-revalidate.mjs';

const SCRIPT = resolve(__dirname, 'auto-pin-revalidate.mjs');
const PIN_A = '0.9.14';
const PIN_B = '0.9.15';

const pinFile = (version: string) =>
  `# Exact intentd version bundled as the sidecar.\n# Bump by PR.\n${version}\n`;

const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Model the race: `upstream` plays the GitHub repo (its `main` is live main),
 * `run` is the workflow's checkout — a clone taken at run start, so it only
 * ever sees the snapshot of main unless something re-fetches. Like
 * actions/checkout, the clone is shallow (`--depth 1`; git honors it only
 * for `file://` URLs, not plain local paths).
 */
function setup(): { upstream: string; run: string } {
  const root = mkdtempSync(join(tmpdir(), 'auto-pin-revalidate-'));
  tempDirs.push(root);
  const upstream = join(root, 'upstream');
  execFileSync('git', ['init', '-q', '-b', 'main', upstream]);
  git(upstream, 'config', 'user.email', 'test@example.com');
  git(upstream, 'config', 'user.name', 'Test');
  writeFileSync(join(upstream, 'intentd.version'), pinFile(PIN_A));
  writeFileSync(join(upstream, 'src.ts'), 'export const value = 1;\n');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', 'base');

  const run = join(root, 'run');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, run]);
  expect(git(run, 'rev-parse', '--is-shallow-repository')).toBe('true');
  return { upstream, run };
}

/** A pin PR squash-merging onto live main while the run is in flight. */
function mergePinOnMain(upstream: string, version: string): string {
  writeFileSync(join(upstream, 'intentd.version'), pinFile(version));
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-qm', `fix: bump intentd sidecar to v${version}`);
  return git(upstream, 'rev-parse', 'HEAD');
}

/** The workflow's preflight step: the pin is already edited in the working tree. */
function applyPreflightEdit(run: string, version: string): void {
  writeFileSync(join(run, 'intentd.version'), pinFile(version));
}

function revalidate(run: string, current = PIN_A, latest = PIN_B) {
  return revalidateAgainstLiveMain({ current, latest, cwd: run }) as {
    proceed: boolean;
    mainPin: string;
    mainSha: string;
    reason: string;
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('auto-pin-revalidate', () => {
  it('proceeds when live main still carries the pin the run started from', () => {
    const { run } = setup();
    applyPreflightEdit(run, PIN_B);
    const result = revalidate(run);
    expect(result.proceed).toBe(true);
    expect(result.mainPin).toBe(PIN_A);
  });

  it('does not proceed when the previous pin PR merged after the run started (monorepo#4359)', () => {
    const { upstream, run } = setup();
    applyPreflightEdit(run, PIN_B);
    const mergedSha = mergePinOnMain(upstream, PIN_B);
    // The stale remote-tracking ref alone would still say PIN_A — the script
    // must re-fetch live main rather than trust the snapshot.
    expect(git(run, 'show', 'origin/main:intentd.version')).toContain(PIN_A);
    const result = revalidate(run);
    expect(result.proceed).toBe(false);
    expect(result.mainPin).toBe(PIN_B);
    expect(result.mainSha).toBe(mergedSha);
    expect(result.reason).toMatch(/already landed/);
    expect(git(run, 'rev-parse', '--is-shallow-repository')).toBe('true');
  });

  it('does not proceed when main moved to a different, still-older pin', () => {
    const { upstream, run } = setup();
    mergePinOnMain(upstream, '0.9.15-alpha.1');
    const result = revalidate(run, PIN_A, '0.9.16');
    expect(result.proceed).toBe(false);
    expect(result.mainPin).toBe('0.9.15-alpha.1');
    expect(result.reason).toMatch(/moved/);
  });

  it('does not proceed when main moved past the target pin', () => {
    const { upstream, run } = setup();
    mergePinOnMain(upstream, '0.9.16');
    const result = revalidate(run);
    expect(result.proceed).toBe(false);
    expect(result.mainPin).toBe('0.9.16');
  });

  it('throws when live main cannot be fetched', () => {
    const { run } = setup();
    git(run, 'remote', 'set-url', 'origin', join(run, 'does-not-exist'));
    expect(() => revalidate(run)).toThrow(/cannot fetch origin\/main/);
  });

  it('throws when the pin on live main is unreadable', () => {
    const { upstream, run } = setup();
    writeFileSync(join(upstream, 'intentd.version'), '# no pin line\n');
    git(upstream, 'add', '-A');
    git(upstream, 'commit', '-qm', 'break pin');
    expect(() => revalidate(run)).toThrow(/cannot read intentd\.version on origin\/main/);
  });

  describe('CLI', () => {
    const cli = (cwd: string, ...args: string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

    it('prints GITHUB_OUTPUT lines and exits 0 for the raced run', () => {
      const { upstream, run } = setup();
      mergePinOnMain(upstream, PIN_B);
      const out = cli(run, '--current', PIN_A, '--latest', PIN_B);
      expect(out.status).toBe(0);
      expect(out.stdout).toBe(`proceed=false\nmain_pin=${PIN_B}\n`);
      expect(out.stderr).toMatch(/already landed/);
    });

    it('prints proceed=true for a genuinely pending bump', () => {
      const { run } = setup();
      const out = cli(run, '--current', PIN_A, '--latest', PIN_B);
      expect(out.status).toBe(0);
      expect(out.stdout).toBe(`proceed=true\nmain_pin=${PIN_A}\n`);
    });

    it('exits 2 on usage errors and on fetch failures', () => {
      const { run } = setup();
      expect(cli(run, '--current', PIN_A).status).toBe(2);
      git(run, 'remote', 'remove', 'origin');
      const out = cli(run, '--current', PIN_A, '--latest', PIN_B);
      expect(out.status).toBe(2);
      expect(out.stdout).toBe('');
    });
  });
});
