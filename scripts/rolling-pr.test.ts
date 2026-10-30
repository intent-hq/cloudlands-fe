// @verify-changed-triggers: .github/workflows/auto-cut-alpha.yml, .github/workflows/auto-pin-intentd.yml
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { findRollingPr } from './rolling-pr.mjs';

const SCRIPT = resolve(__dirname, 'rolling-pr.mjs');
const REPO = 'intent-hq/cloudlands-fe';
const BRANCH = 'auto/intentd-pin';
const BOT = 'release-bot';

// A PR as `gh pr list --json number,headRefName,isCrossRepository,author,labels`
// returns it. `--head` matches fork PRs with the same branch name too.
const pr = (
  number: number,
  {
    login = BOT,
    fork = false,
    labels = [] as string[],
    head = BRANCH,
  }: { login?: string; fork?: boolean; labels?: string[]; head?: string } = {},
) => ({
  number,
  headRefName: head,
  isCrossRepository: fork,
  author: { login, is_bot: false },
  labels: labels.map((name) => ({ id: name, name, color: '000000' })),
});

/** Fake gh: records calls, answers `api user` and `pr list`. */
function fakeGh(prs: unknown, { login = BOT, failOn = '' } = {}) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    calls.push(args);
    if (failOn && args.join(' ').includes(failOn)) throw new Error(`gh ${failOn} failed`);
    if (args[0] === 'api' && args[1] === 'user') return `${login}\n`;
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(prs);
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls };
}

const find = (prs: unknown, opts: { viewer?: string; login?: string; failOn?: string } = {}) => {
  const fake = fakeGh(prs, opts);
  return {
    result: findRollingPr({ repo: REPO, branch: BRANCH, viewer: opts.viewer, gh: fake.gh }),
    calls: fake.calls,
  };
};

describe('findRollingPr', () => {
  it('returns no PR when none is open on the branch', () => {
    expect(find([]).result).toEqual({ number: null, holdRelease: false, viewer: BOT });
  });

  it("finds the release token's own same-repo PR and lists only open PRs on that branch", () => {
    const { result, calls } = find([pr(42)]);
    expect(result).toEqual({ number: 42, holdRelease: false, viewer: BOT });
    const list = calls.find((args) => args[0] === 'pr')!;
    expect(list.slice(0, 2)).toEqual(['pr', 'list']);
    expect(list[list.indexOf('--repo') + 1]).toBe(REPO);
    expect(list[list.indexOf('--head') + 1]).toBe(BRANCH);
    expect(list[list.indexOf('--state') + 1]).toBe('open');
  });

  it('ignores a fork PR that reuses the branch name, even when listed first', () => {
    expect(find([pr(7, { fork: true })]).result.number).toBeNull();
    expect(find([pr(7, { fork: true }), pr(42)]).result.number).toBe(42);
  });

  it('ignores a same-repo PR opened by anyone but the release token', () => {
    expect(find([pr(8, { login: 'someone' })]).result.number).toBeNull();
    expect(find([pr(8, { login: 'someone' }), pr(42)]).result.number).toBe(42);
  });

  it('ignores a PR whose head is a different branch', () => {
    expect(find([pr(9, { head: `${BRANCH}-other` })]).result.number).toBeNull();
  });

  it('takes the first qualifying PR when several match', () => {
    expect(find([pr(50), pr(42)]).result.number).toBe(50);
  });

  it('reports hold-release only from the qualifying PR', () => {
    expect(find([pr(42, { labels: ['ci', 'hold-release'] })]).result.holdRelease).toBe(true);
    expect(find([pr(42, { labels: ['hold-release-later'] })]).result.holdRelease).toBe(false);
    expect(find([pr(7, { fork: true, labels: ['hold-release'] }), pr(42)]).result.holdRelease).toBe(
      false,
    );
  });

  it('uses a given viewer without asking gh for the token login', () => {
    const { result, calls } = find([pr(8, { login: 'other-bot' })], { viewer: 'other-bot' });
    expect(result.number).toBe(8);
    expect(calls.some((args) => args[0] === 'api')).toBe(false);
  });

  it('fails instead of guessing when the login or the PR list cannot be read', () => {
    expect(() => find([pr(42)], { login: '' })).toThrow(/login/);
    expect(() => find([pr(42)], { failOn: 'api user' })).toThrow();
    expect(() => find([pr(42)], { failOn: 'pr list' })).toThrow();
    expect(() => find({ number: 42 })).toThrow(/array/);
    expect(() => find([{ ...pr(42), number: '42' }])).toThrow(/invalid number/);
  });
});

describe('rolling-pr.mjs CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Run the CLI with a stub `gh` on PATH serving `prs` for `pr list`. */
  function cli(prs: unknown, args: string[], { login = BOT, fail = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'rolling-pr-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs));
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
const a = process.argv.slice(2);
if (${fail}) process.exit(1);
if (a[0] === 'api' && a[1] === 'user') { process.stdout.write(${JSON.stringify(login)} + '\\n'); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'list') { process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(dir, 'prs.json'))}, 'utf8')); process.exit(0); }
process.exit(2);
`,
      { mode: 0o755 },
    );
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
  }

  it('prints GITHUB_OUTPUT lines for the qualifying PR', () => {
    const out = cli(
      [pr(7, { fork: true }), pr(42, { labels: ['hold-release'] })],
      ['--repo', REPO, '--branch', BRANCH],
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('number=42\nhold_release=true\n');
  });

  it('prints an empty number when there is no qualifying PR', () => {
    const out = cli([pr(7, { fork: true })], ['--repo', REPO, '--branch', BRANCH]);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('number=\nhold_release=false\n');
  });

  it('honors --viewer', () => {
    const out = cli([pr(42)], ['--repo', REPO, '--branch', BRANCH, '--viewer', 'someone-else']);
    expect(out.stdout).toBe('number=\nhold_release=false\n');
  });

  it('exits 1 with no output lines when gh fails or the login is empty', () => {
    const failed = cli([pr(42)], ['--repo', REPO, '--branch', BRANCH], { fail: true });
    expect(failed.status).toBe(1);
    expect(failed.stdout).toBe('');
    const anonymous = cli([pr(42)], ['--repo', REPO, '--branch', BRANCH], { login: '' });
    expect(anonymous.status).toBe(1);
    expect(anonymous.stdout).toBe('');
  });

  it('exits 2 on malformed arguments', () => {
    expect(cli([], ['--branch', BRANCH]).status).toBe(2);
    expect(cli([], ['--repo', 'not-a-repo', '--branch', BRANCH]).status).toBe(2);
    expect(cli([], ['--repo', REPO, '--branch']).status).toBe(2);
    expect(cli([], ['--repo', REPO, '--branch', BRANCH, '--viewer', '']).status).toBe(2);
  });
});

/** Every `gh pr list` shell command, joined across `\\` continuations; comments skipped. */
function ghPrListCommands(workflow: string): string[] {
  const lines = workflow.split('\n');
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trimStart().startsWith('#') || !lines[i].includes('gh pr list')) continue;
    let command = lines[i];
    while (/\\\s*$/.test(lines[i]) && i + 1 < lines.length) {
      i += 1;
      command += ` ${lines[i].trim()}`;
    }
    commands.push(command);
  }
  return commands;
}

describe('release workflows', () => {
  // The inline lookup existed in four copies (cloudlands-fe#3536 review); a
  // `gh pr list --head` call in either workflow would be a fifth.
  it.each(['auto-cut-alpha.yml', 'auto-pin-intentd.yml'])(
    '%s finds its rolling PR only through rolling-pr.mjs',
    (file) => {
      const workflow = readFileSync(resolve(__dirname, '../.github/workflows', file), 'utf8');
      expect(workflow.includes('node scripts/rolling-pr.mjs'), 'calls the script').toBe(true);
      expect(ghPrListCommands(workflow).filter((cmd) => /\s--head\b/.test(cmd))).toEqual([]);
    },
  );
});
