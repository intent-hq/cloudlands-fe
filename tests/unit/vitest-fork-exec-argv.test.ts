// Regression coverage for the fork-only V8 flag leaking into worker_threads:
// vitest.config.ts starts each fork with `--no-sparkplug` (nodejs/node#62393
// workaround) and src/test-setup.ts strips it from `process.execArgv` again,
// because Node validates a Worker's `execArgv` only when passed explicitly and
// rejects per-process V8 flags with ERR_WORKER_INVALID_EXEC_ARGV — the shape
// `@lix-js/sdk` (via @inlang/paraglide-js) uses. Default inheritance never
// fails, so the Worker assertion below MUST pass `execArgv` explicitly.
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { FORK_EXEC_ARGV, stripForkExecArgv } from '../../scripts/vitest-fork-exec-argv.mjs';

function runWorker(execArgv: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('process.exit(0)', { eval: true, execArgv });
    worker.once('error', reject);
    worker.once('exit', resolve);
  });
}

describe('vitest fork execArgv', () => {
  it('is stripped from process.execArgv inside the fork', () => {
    for (const flag of FORK_EXEC_ARGV) {
      expect(process.execArgv).not.toContain(flag);
    }
  });

  it('was present before the setup file stripped it (the Sparkplug workaround still applies)', () => {
    const recorded = process.env.INTENT_VITEST_STRIPPED_EXEC_ARGV;
    expect(recorded, 'src/test-setup.ts did not record a stripped execArgv').toBeDefined();
    expect(JSON.parse(recorded as string)).toEqual(expect.arrayContaining(['--no-sparkplug']));
  });

  it('lets a Worker start with process.execArgv passed explicitly', async () => {
    await expect(runWorker(process.execArgv)).resolves.toBe(0);
  });

  it('is rejected by Node when handed to a Worker explicitly', async () => {
    await expect(runWorker([...process.execArgv, ...FORK_EXEC_ARGV])).rejects.toMatchObject({
      code: 'ERR_WORKER_INVALID_EXEC_ARGV',
    });
  });
});

describe('stripForkExecArgv', () => {
  it('removes the fork-only flags and keeps everything else in order', () => {
    expect(stripForkExecArgv(['--max-old-space-size=4096', '--no-sparkplug', '--inspect'])).toEqual(
      { kept: ['--max-old-space-size=4096', '--inspect'], removed: ['--no-sparkplug'] },
    );
  });

  it('does not mutate its input', () => {
    const input = ['--no-sparkplug', '--inspect'];
    stripForkExecArgv(input);
    expect(input).toEqual(['--no-sparkplug', '--inspect']);
  });

  it('is idempotent', () => {
    const first = stripForkExecArgv(['--no-sparkplug', '--inspect']);
    expect(stripForkExecArgv(first.kept)).toEqual({ kept: ['--inspect'], removed: [] });
  });

  it('returns empty lists for an empty execArgv', () => {
    expect(stripForkExecArgv([])).toEqual({ kept: [], removed: [] });
  });
});
