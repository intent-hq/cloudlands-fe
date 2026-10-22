// @verify-changed-triggers: .github/workflows/auto-cut-alpha.yml, .github/workflows/auto-pin-intentd.yml
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import { summarizeCiGate, summarizeCiGateText } from './ci-gate-state.mjs';

const SCRIPT = resolve(__dirname, 'ci-gate-state.mjs');
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

// Shapes as `gh pr view --json headRefOid,statusCheckRollup` returns them: a
// CheckRun carries name/status/conclusion (conclusion is "" until it
// completes); a commit StatusContext carries context/state and no name.
const run = (conclusion: string, status = conclusion ? 'COMPLETED' : 'IN_PROGRESS') => ({
  __typename: 'CheckRun',
  name: 'CI Gate',
  status,
  conclusion,
});
const detail = (...rollup: unknown[]) => ({ headRefOid: HEAD, statusCheckRollup: rollup });

describe('summarizeCiGate', () => {
  it('is success only when every CI Gate run concluded SUCCESS', () => {
    expect(summarizeCiGate(detail(run('SUCCESS')))).toBe('success');
    expect(summarizeCiGate(detail(run('SUCCESS'), run('SUCCESS')))).toBe('success');
  });

  it('is missing when no CI Gate run exists on the head', () => {
    expect(summarizeCiGate(detail())).toBe('missing');
    expect(summarizeCiGate({ headRefOid: HEAD })).toBe('missing');
    expect(summarizeCiGate({ headRefOid: HEAD, statusCheckRollup: null })).toBe('missing');
  });

  it('ignores other checks and a commit status that merely uses the context name', () => {
    const lookalikes = detail(
      { __typename: 'CheckRun', name: 'Lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'CI Gate', state: 'SUCCESS' },
    );
    expect(summarizeCiGate(lookalikes)).toBe('missing');
    expect(
      summarizeCiGate(
        detail(run('SUCCESS'), { name: 'Lint', status: 'COMPLETED', conclusion: 'FAILURE' }),
      ),
    ).toBe('success');
  });

  it.each([
    'FAILURE',
    'ERROR',
    'CANCELLED',
    'TIMED_OUT',
    'ACTION_REQUIRED',
    'STARTUP_FAILURE',
    'STALE',
    'SKIPPED',
    'NEUTRAL',
  ])('treats a %s conclusion as a terminal failure', (conclusion) => {
    expect(summarizeCiGate(detail(run(conclusion)))).toBe(`failed:${conclusion}`);
  });

  it('treats an unknown future conclusion as a failure, never as green', () => {
    expect(summarizeCiGate(detail(run('SOMETHING_NEW')))).toBe('failed:SOMETHING_NEW');
  });

  it('reports a running gate by its status, not as an empty state', () => {
    expect(summarizeCiGate(detail(run('', 'IN_PROGRESS')))).toBe('pending:IN_PROGRESS');
    expect(summarizeCiGate(detail(run('', 'QUEUED')))).toBe('pending:QUEUED');
    expect(summarizeCiGate(detail({ name: 'CI Gate', conclusion: null }))).toBe('pending:PENDING');
  });

  it('lets a failure win over a run that is still pending', () => {
    expect(summarizeCiGate(detail(run('', 'IN_PROGRESS'), run('FAILURE')))).toBe(
      'failed:IN_PROGRESS,FAILURE',
    );
    expect(summarizeCiGate(detail(run('SUCCESS'), run('', 'QUEUED')))).toBe(
      'pending:SUCCESS,QUEUED',
    );
  });

  it('binds the state to an expected head when one is given', () => {
    expect(summarizeCiGate(detail(run('SUCCESS')), { head: HEAD })).toBe('success');
    expect(summarizeCiGate(detail(run('SUCCESS')), { head: OTHER })).toBe(`head-mismatch:${HEAD}`);
    expect(summarizeCiGate({ statusCheckRollup: [run('SUCCESS')] }, { head: HEAD })).toBe(
      'unreadable',
    );
  });

  it('is unreadable for input that is not a PR object', () => {
    for (const value of [null, [], 'text', 3, { statusCheckRollup: {} }]) {
      expect(summarizeCiGate(value)).toBe('unreadable');
    }
    expect(summarizeCiGateText('')).toBe('unreadable');
    expect(summarizeCiGateText('{not json')).toBe('unreadable');
  });
});

describe('ci-gate-state.mjs CLI', () => {
  const cli = (input: string, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8' });

  it('prints one state line for stdin and exits 0', () => {
    const green = cli(JSON.stringify(detail(run('SUCCESS'))), '--head', HEAD);
    expect(green.status).toBe(0);
    expect(green.stdout).toBe('success\n');

    const skipped = cli(JSON.stringify(detail(run('SKIPPED'))));
    expect(skipped.status).toBe(0);
    expect(skipped.stdout).toBe('failed:SKIPPED\n');

    const empty = cli('', '--head', HEAD);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toBe('unreadable\n');
  });

  it('rejects malformed arguments with exit 2', () => {
    expect(cli('{}', '--head').status).toBe(2);
    expect(cli('{}', '--head', 'abc123').status).toBe(2);
    expect(cli('{}', '--bogus', HEAD).status).toBe(2);
  });
});

describe('release workflows', () => {
  // The inline copies drifted once already (cloudlands-fe#3536 review); keep
  // every CI Gate read going through the tested script.
  it.each(['auto-cut-alpha.yml', 'auto-pin-intentd.yml'])(
    '%s reads CI Gate only through ci-gate-state.mjs',
    (file) => {
      const workflow = readFileSync(resolve(__dirname, '../.github/workflows', file), 'utf8');
      expect(workflow.includes('node scripts/ci-gate-state.mjs'), 'calls the script').toBe(true);
      expect(/select\(\s*\.name\s*==\s*"CI Gate"\s*\)/.test(workflow), 'inline CI Gate jq').toBe(
        false,
      );
    },
  );
});
