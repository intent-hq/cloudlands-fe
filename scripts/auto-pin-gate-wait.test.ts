// @verify-changed-triggers: .github/workflows/auto-pin-intentd.yml, scripts/ci-gate-state.mjs
// @vitest-environment node

// Runs the real bash of auto-pin-intentd.yml's "Wait for CI Gate on the pushed
// head" step against a fake `gh`, so the loop around scripts/ci-gate-state.mjs
// (head binding, change requests, terminal failures, review threads) is
// covered, not only the script itself.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib'))('js-yaml');
const workflow = load(
  readFileSync(resolve(__dirname, '../.github/workflows/auto-pin-intentd.yml'), 'utf8'),
);
const step = (workflow.jobs.pin.steps as { name: string; run?: string }[]).find(
  (s) => s.name === 'Wait for CI Gate on the pushed head',
)!;

const HEAD = 'c'.repeat(40);
const OTHER = 'd'.repeat(40);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type View = {
  headRefOid: string;
  reviewDecision: string;
  statusCheckRollup: { name: string; status: string; conclusion: string }[];
} | null;

/** A `gh pr view` answer; `null` makes gh fail for that poll. */
const view = (
  conclusion: string,
  { head = HEAD, review = '' }: { head?: string; review?: string } = {},
): View => ({
  headRefOid: head,
  reviewDecision: review,
  statusCheckRollup: [
    {
      name: 'CI Gate',
      status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
      conclusion,
    },
  ],
});

/**
 * Run the step. `views` answers successive `gh pr view` polls (the last one
 * repeats); `unresolved` answers the review-thread GraphQL count.
 */
function runWait(views: View[], { unresolved = '0', waitSeconds = '600' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'auto-pin-gate-wait-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'bin'));
  copyFileSync(resolve(__dirname, 'ci-gate-state.mjs'), join(dir, 'scripts', 'ci-gate-state.mjs'));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ views, unresolved }));
  writeFileSync(
    join(dir, 'bin', 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const dir = ${JSON.stringify(dir)};
const f = JSON.parse(fs.readFileSync(dir + '/fixture.json', 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(dir + '/calls', JSON.stringify(a) + '\\n');
if (a[0] === 'pr' && a[1] === 'view') {
  const polls = fs.existsSync(dir + '/polls') ? Number(fs.readFileSync(dir + '/polls', 'utf8')) : 0;
  fs.writeFileSync(dir + '/polls', String(polls + 1));
  const v = f.views[Math.min(polls, f.views.length - 1)];
  if (v === null) process.exit(1);
  process.stdout.write(JSON.stringify(v));
  process.exit(0);
}
if (a[0] === 'api' && a[1] === 'graphql') { process.stdout.write(f.unresolved + '\\n'); process.exit(0); }
process.exit(2);
`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, 'bin', 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(dir, 'outputs'), '');
  // GitHub's default `run` shell on Linux is `bash -e {0}`.
  const result = spawnSync('bash', ['-e', '-c', step.run!], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'intent-hq/cloudlands-fe',
      GITHUB_OUTPUT: join(dir, 'outputs'),
      PR: '42',
      HEAD_SHA: HEAD,
      WAIT_GATE_SECONDS: waitSeconds,
    },
  });
  const state = readFileSync(join(dir, 'outputs'), 'utf8').match(/^state=(.*)$/m)?.[1];
  const calls = readFileSync(join(dir, 'calls'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  return {
    status: result.status,
    stdout: result.stdout,
    state,
    polls: calls.filter((args) => args[0] === 'pr' && args[1] === 'view').length,
  };
}

describe('auto-pin "Wait for CI Gate on the pushed head"', () => {
  it('reports success for a green gate on the pushed head with no open threads', () => {
    const run = runWait([view('SUCCESS')]);
    expect(run.status).toBe(0);
    expect(run.state).toBe('success');
    expect(run.polls).toBe(1);
  });

  it('keeps polling while the PR head lags behind the pushed commit', () => {
    const run = runWait([
      view('FAILURE', { head: OTHER, review: 'CHANGES_REQUESTED' }),
      view('SUCCESS'),
    ]);
    expect(run.state).toBe('success');
    expect(run.polls).toBe(2);
  });

  it('keeps polling after an unreadable read', () => {
    const run = runWait([null, view('SUCCESS')]);
    expect(run.state).toBe('success');
    expect(run.polls).toBe(2);
  });

  it.each(['SKIPPED', 'NEUTRAL', 'FAILURE'])(
    'stops at once on a terminal %s gate instead of waiting out the deadline',
    (conclusion) => {
      const run = runWait([view(conclusion), view('SUCCESS')]);
      expect(run.state).toBe(`failed:${conclusion}`);
      expect(run.polls).toBe(1);
      expect(run.stdout).toContain('::warning::CI Gate concluded unsuccessfully');
    },
  );

  it('blocks on a change request on the pushed head', () => {
    const run = runWait([view('SUCCESS', { review: 'CHANGES_REQUESTED' })]);
    expect(run.state).toBe('blocked:changes-requested');
    expect(run.polls).toBe(1);
  });

  it('blocks a green gate when a review thread is unresolved', () => {
    expect(runWait([view('SUCCESS')], { unresolved: '1' }).state).toBe('blocked:review-threads=1');
  });

  it('reports the pending state at the deadline', () => {
    const run = runWait([view('')], { waitSeconds: '0' });
    expect(run.state).toBe('pending:IN_PROGRESS');
    expect(run.stdout).toContain('not green');
  });
});
