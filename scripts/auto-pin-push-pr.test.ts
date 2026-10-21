// @verify-changed-triggers: .github/workflows/auto-pin-intentd.yml, scripts/rolling-pr.mjs
// @vitest-environment node

// Runs the real bash of auto-pin-intentd.yml's "Push branch and open/update
// rolling PR" step in a scratch git repo (a local bare repo as `origin`)
// against a fake `gh`, with the real scripts/rolling-pr.mjs doing the lookup.
// The fake `gh pr list` never shows a just-created PR, modelling GitHub's
// list lag: the step must still report the new PR's number, or the CI wait
// and merge steps are skipped and the pin waits for the next run.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const workflow = load(
  readFileSync(resolve(__dirname, '../.github/workflows/auto-pin-intentd.yml'), 'utf8'),
);
const BRANCH = (workflow.env as Record<string, string>).BRANCH;
const STEP_NAME = 'Push branch and open/update rolling PR';
const step = (workflow.jobs.pin.steps as { name: string; run?: string }[]).find(
  (s) => s.name === STEP_NAME,
);
if (!step?.run) throw new Error(`auto-pin-intentd.yml has no "${STEP_NAME}" run step`);
const script = step.run;

const REPO = 'intent-hq/cloudlands-fe';
const VIEWER = 'intent-release-bot';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type ListedPr = { number: number; state: 'OPEN' | 'CLOSED' | 'MERGED' };

/** A `gh pr list` row for the automation's own same-repo rolling PR. */
const ownPr = (number: number, state: ListedPr['state'] = 'OPEN') => ({
  number,
  state,
  headRefName: BRANCH,
  isCrossRepository: false,
  author: { login: VIEWER },
  labels: [],
});

type Fixture = {
  /** Every PR on the branch; the fake honors `--state open`. `null` makes `gh pr list` fail. */
  prs: ReturnType<typeof ownPr>[] | null;
  /** Stdout of `gh pr create`. */
  createOutput?: string;
  /** Seed `origin` with the rolling branch already carrying the desired pin. */
  remoteHasPin?: boolean;
};

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function gitEnv() {
  return { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
}

function runPush(fixture: Fixture) {
  const dir = mkdtempSync(join(tmpdir(), 'auto-pin-push-pr-'));
  dirs.push(dir);
  const work = join(dir, 'work');
  const origin = join(dir, 'origin.git');
  mkdirSync(join(work, 'scripts'), { recursive: true });
  mkdirSync(join(work, 'src', 'test'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  git(dir, 'init', '--quiet', '--bare', origin);
  git(work, 'init', '--quiet', '--initial-branch=main');
  git(work, 'remote', 'add', 'origin', origin);
  copyFileSync(resolve(__dirname, 'rolling-pr.mjs'), join(work, 'scripts', 'rolling-pr.mjs'));
  writeFileSync(join(work, 'intentd.version'), '0.11.19\n');
  writeFileSync(
    join(work, 'src', 'test', 'current-protocol-version.ts'),
    "export const V = '1';\n",
  );
  git(work, 'add', '-A');
  git(
    work,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    'commit',
    '--quiet',
    '-m',
    'init',
  );
  const bump = () => {
    writeFileSync(join(work, 'intentd.version'), '0.11.20\n');
    writeFileSync(
      join(work, 'src', 'test', 'current-protocol-version.ts'),
      "export const V = '2';\n",
    );
  };
  bump();
  let seededHead: string | undefined;
  if (fixture.remoteHasPin) {
    git(work, 'checkout', '--quiet', '-b', 'seed');
    git(work, 'add', '-A');
    git(
      work,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '--quiet',
      '-m',
      'seed',
    );
    git(work, 'push', '--quiet', 'origin', `HEAD:refs/heads/${BRANCH}`);
    seededHead = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '--quiet', 'main');
    bump();
  }
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);

  writeFileSync(join(dir, 'fixture.json'), JSON.stringify(fixture));
  writeFileSync(
    join(dir, 'bin', 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const dir = ${JSON.stringify(dir)};
const f = JSON.parse(fs.readFileSync(dir + '/fixture.json', 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(dir + '/calls', JSON.stringify(a) + '\\n');
const opt = (name) => { const i = a.indexOf(name); return i < 0 ? undefined : a[i + 1]; };
if (a[0] === 'pr' && opt('--repo') !== undefined && opt('--repo') !== ${JSON.stringify(REPO)}) process.exit(3);
if (a[0] === 'pr' && a[1] === 'list') {
  if (f.prs === null) { process.stderr.write('HTTP 502\\n'); process.exit(1); }
  const state = (opt('--state') || 'open').toUpperCase();
  const rows = f.prs.filter((p) => p.headRefName === opt('--head') && (state === 'ALL' || p.state === state));
  process.stdout.write(JSON.stringify(rows.map(({ state: _s, ...p }) => p)));
  process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'create') { process.stdout.write(f.createOutput ?? ''); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'edit') process.exit(0);
process.exit(2);
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, 'outputs'), '');
  // GitHub's default `run` shell on Linux is `bash -e {0}`.
  const result = spawnSync('bash', ['-e', '-c', script], {
    cwd: work,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...gitEnv(),
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      TMPDIR: tmp,
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: join(dir, 'outputs'),
      BRANCH,
      CURRENT: '0.11.19',
      LATEST: '0.11.20',
      VIEWER,
    },
  });
  const outputs = readFileSync(join(dir, 'outputs'), 'utf8');
  const calls = existsSync(join(dir, 'calls'))
    ? readFileSync(join(dir, 'calls'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
    : [];
  const sub = (name: string) => calls.filter((c) => c[0] === 'pr' && c[1] === name);
  return {
    status: result.status,
    stdout: result.stdout,
    number: outputs.match(/^number=(.*)$/m)?.[1],
    head: outputs.match(/^head=(.*)$/m)?.[1],
    pushedHead: spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], {
      cwd: origin,
      encoding: 'utf8',
    }).stdout.trim(),
    seededHead,
    leftoverTmp: readdirSync(tmp),
    creates: sub('create'),
    edits: sub('edit'),
  };
}

const url = (n: number) => `https://github.com/${REPO}/pull/${n}\n`;

describe('auto-pin "Push branch and open/update rolling PR"', () => {
  it('reports a new PR number from gh pr create even when gh pr list lags', () => {
    const run = runPush({ prs: [], createOutput: url(123) });
    expect(run.status).toBe(0);
    expect(run.creates).toHaveLength(1);
    expect(run.creates[0]).toEqual(expect.arrayContaining(['--head', BRANCH]));
    expect(run.edits).toHaveLength(0);
    expect(run.number).toBe('123');
    expect(run.head).toMatch(/^[0-9a-f]{40}$/);
    expect(run.pushedHead).toBe(run.head);
  });

  it('edits the existing open rolling PR instead of creating one', () => {
    const run = runPush({ prs: [ownPr(77)], createOutput: url(999) });
    expect(run.status).toBe(0);
    expect(run.creates).toHaveLength(0);
    expect(run.edits).toHaveLength(1);
    expect(run.edits[0][2]).toBe('77');
    expect(run.number).toBe('77');
    expect(run.pushedHead).toBe(run.head);
  });

  it('skips the push and keeps the remote head when the branch already carries the pin', () => {
    const run = runPush({ prs: [ownPr(77)], remoteHasPin: true });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('skipping push');
    expect(run.head).toBe(run.seededHead);
    expect(run.pushedHead).toBe(run.seededHead);
    expect(run.number).toBe('77');
  });

  it('opens a new PR when the previously seen rolling PR closed meanwhile', () => {
    const run = runPush({ prs: [ownPr(77, 'CLOSED')], createOutput: url(124) });
    expect(run.status).toBe(0);
    expect(run.edits).toHaveLength(0);
    expect(run.creates).toHaveLength(1);
    expect(run.number).toBe('124');
  });

  it('fails without creating or editing when the rolling PR lookup fails', () => {
    const run = runPush({ prs: null, createOutput: url(125) });
    expect(run.status).not.toBe(0);
    expect(run.creates).toHaveLength(0);
    expect(run.edits).toHaveLength(0);
    expect(run.number).toBeUndefined();
  });

  it.each([
    ['no output', ''],
    ['a non-PR URL', `https://github.com/${REPO}/issues/7\n`],
  ])('fails instead of reporting an empty number when gh pr create prints %s', (_label, out) => {
    const run = runPush({ prs: [], createOutput: out });
    expect(run.status).not.toBe(0);
    expect(run.creates).toHaveLength(1);
    expect(run.number).toBeUndefined();
    expect(run.stdout).toContain('::error::');
    expect(run.leftoverTmp).toEqual([]);
  });
});
