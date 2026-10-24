// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_DELAYS_MS,
  RETRYABLE_STAPLER_EXIT,
  retryDelaysFromEnv,
  runStaplerWithBackoff,
} from './apple-ticket-retry.mjs';

type Result = { status: number | null; output: string };

function harness(statuses: number[]) {
  const calls: string[][] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const run = (args: string[]): Result => {
    calls.push(args);
    const status = statuses[calls.length - 1];
    return { status, output: `attempt ${calls.length} exit ${status}` };
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  const log = (line: string) => logs.push(line);
  return { calls, sleeps, logs, opts: { run, sleep, log, delaysMs: [1, 2, 3, 4] } };
}

describe('runStaplerWithBackoff', () => {
  it('uses a 30s/60s/120s/240s backoff by default', () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(RETRYABLE_STAPLER_EXIT).toBe(68);
  });

  it('passes on the first try without waiting', async () => {
    const h = harness([0]);
    await expect(runStaplerWithBackoff('validate', '/tmp/Intent.app', h.opts)).resolves.toBe(
      'attempt 1 exit 0',
    );
    expect(h.calls).toEqual([['stapler', 'validate', '-v', '/tmp/Intent.app']]);
    expect(h.sleeps).toEqual([]);
  });

  it('retries Apple connection loss (exit 68) with backoff until it succeeds', async () => {
    const h = harness([68, 68, 0]);
    await runStaplerWithBackoff('staple', '/tmp/Intent.app', h.opts);
    expect(h.calls).toHaveLength(3);
    expect(h.calls[0]).toEqual(['stapler', 'staple', '-v', '/tmp/Intent.app']);
    expect(h.sleeps).toEqual([1, 2]);
    expect(h.logs.filter((line) => line.startsWith('::warning::'))).toHaveLength(2);
  });

  it('fails immediately on a non-retryable stapler exit such as a missing ticket (65)', async () => {
    const h = harness([65, 0]);
    await expect(
      runStaplerWithBackoff('validate', '/tmp/Intent.app', h.opts),
    ).rejects.toMatchObject({ exitCode: 65 });
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('fails when the stapler process cannot run at all', async () => {
    const h = harness([]);
    h.opts.run = () => ({ status: null, output: 'spawn xcrun ENOENT' });
    await expect(
      runStaplerWithBackoff('validate', '/tmp/Intent.app', h.opts),
    ).rejects.toMatchObject({ exitCode: null });
    expect(h.sleeps).toEqual([]);
  });

  it('gives up after every wait is used and reports the last output', async () => {
    const h = harness([68, 68, 68, 68, 68, 0]);
    const failure = runStaplerWithBackoff('validate', '/tmp/Intent.app', h.opts);
    await expect(failure).rejects.toMatchObject({ exitCode: 68 });
    await expect(failure).rejects.toThrow(/5 attempts[\s\S]*attempt 5 exit 68/);
    expect(h.calls).toHaveLength(5);
    expect(h.sleeps).toEqual([1, 2, 3, 4]);
    expect(h.logs.at(-1)).toMatch(/^::error::/);
  });

  it('rejects unknown stapler actions', async () => {
    const h = harness([0]);
    await expect(runStaplerWithBackoff('remove', '/tmp/Intent.app', h.opts)).rejects.toThrow(
      /Unsupported stapler action/,
    );
    expect(h.calls).toEqual([]);
  });
});

describe('retryDelaysFromEnv', () => {
  it('defaults when unset or blank', () => {
    expect(retryDelaysFromEnv({})).toEqual(DEFAULT_RETRY_DELAYS_MS);
    expect(retryDelaysFromEnv({ APPLE_TICKET_RETRY_DELAYS_MS: ' ' })).toEqual(
      DEFAULT_RETRY_DELAYS_MS,
    );
  });

  it('parses a comma-separated override', () => {
    expect(retryDelaysFromEnv({ APPLE_TICKET_RETRY_DELAYS_MS: '0, 5,10' })).toEqual([0, 5, 10]);
  });

  it('rejects malformed overrides instead of silently disabling retries', () => {
    for (const value of ['-1', 'abc', '1,,2', '1.5'])
      expect(() => retryDelaysFromEnv({ APPLE_TICKET_RETRY_DELAYS_MS: value })).toThrow(
        /APPLE_TICKET_RETRY_DELAYS_MS/,
      );
  });
});

describe('CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function cli(statuses: number[], args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'apple-ticket-retry-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'statuses'), statuses.join('\n'));
    writeFileSync(
      join(dir, 'bin', 'xcrun'),
      `#!/bin/bash
printf '%s\\n' "$*" >> "${dir}/calls"
status=$(sed -n "$(($(wc -l < "${dir}/calls")))p" "${dir}/statuses")
echo "stub xcrun exit $status"
exit "$status"
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/apple-ticket-retry.mjs'), ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
          APPLE_TICKET_RETRY_DELAYS_MS: '0,0,0,0',
        },
      },
    );
    let calls: string[] = [];
    try {
      calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
    } catch {
      // xcrun was never called
    }
    return { ...result, calls };
  }

  it('retries exit 68 through xcrun and exits 0 once validate passes', () => {
    const result = cli([68, 0], ['validate', '/tmp/Intent.app']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toEqual([
      'stapler validate -v /tmp/Intent.app',
      'stapler validate -v /tmp/Intent.app',
    ]);
    expect(result.stdout).toContain('stub xcrun exit 68');
  });

  it('exits with the stapler code when validation keeps failing', () => {
    const result = cli([68, 68, 68, 68, 68], ['validate', '/tmp/Intent.app']);
    expect(result.status).toBe(68);
    expect(result.calls).toHaveLength(5);
  });

  it('exits with the stapler code without retrying a real ticket failure', () => {
    const result = cli([65], ['validate', '/tmp/Intent.app']);
    expect(result.status).toBe(65);
    expect(result.calls).toHaveLength(1);
  });

  it('requires an action and an app path', () => {
    const result = cli([0], ['validate']);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
  });
});
