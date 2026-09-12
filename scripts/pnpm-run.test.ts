import { describe, expect, it, vi } from 'vitest';
import { parseArgs, planInvocations, runInvocations } from './pnpm-run.mjs';

const PNPM_ENV = {
  npm_execpath: '/store/pnpm/10.30.3/bin/pnpm.cjs',
  npm_config_user_agent: 'pnpm/10.30.3 npm/? node/v24.19.0 linux x64',
};

describe('parseArgs', () => {
  it('collects every positional argument as a script name', () => {
    expect(parseArgs(['lint', 'check', 'test:unit'])).toEqual({
      scripts: ['lint', 'check', 'test:unit'],
      forwarded: [],
    });
  });

  it('splits forwarded arguments at the first "--"', () => {
    expect(parseArgs(['test:ct', '--', '--grep', 'geometry snapshot', '--'])).toEqual({
      scripts: ['test:ct'],
      forwarded: ['--grep', 'geometry snapshot', '--'],
    });
  });

  it('rejects an empty script list', () => {
    expect(() => parseArgs([])).toThrow(/No script name/);
    expect(() => parseArgs(['--', '--fix'])).toThrow(/No script name/);
  });

  it('rejects option-like tokens before "--"', () => {
    expect(() => parseArgs(['--fix', 'lint'])).toThrow(/Unknown option "--fix"/);
  });

  it('rejects forwarded arguments when more than one script is named', () => {
    expect(() => parseArgs(['lint', 'check', '--', '--fix'])).toThrow(/single script/);
  });
});

describe('planInvocations', () => {
  const options = { env: PNPM_ENV, platform: 'linux', execPath: '/node' };

  it('routes each script through the invoking pnpm in order', () => {
    expect(planInvocations(parseArgs(['lint', 'check']), options)).toEqual([
      {
        script: 'lint',
        executable: '/node',
        args: ['/store/pnpm/10.30.3/bin/pnpm.cjs', 'run', 'lint'],
        shell: false,
      },
      {
        script: 'check',
        executable: '/node',
        args: ['/store/pnpm/10.30.3/bin/pnpm.cjs', 'run', 'check'],
        shell: false,
      },
    ]);
  });

  it('forwards "--" arguments exactly as pnpm run would receive them', () => {
    const [invocation] = planInvocations(parseArgs(['test:ct', '--', '--grep', 'a b']), options);
    expect(invocation.args).toEqual([
      '/store/pnpm/10.30.3/bin/pnpm.cjs',
      'run',
      'test:ct',
      '--',
      '--grep',
      'a b',
    ]);
  });

  it('uses the cmd.exe-quoted PATH fallback on Windows without npm_execpath', () => {
    const [invocation] = planInvocations(parseArgs(['dev:web']), {
      env: {},
      platform: 'win32',
      execPath: 'node.exe',
    });
    expect(invocation).toEqual({
      script: 'dev:web',
      executable: 'pnpm',
      args: ['^"run^"', '^"dev:web^"'],
      shell: true,
    });
  });
});

describe('runInvocations', () => {
  const invocations = planInvocations(parseArgs(['a', 'b', 'c']), {
    env: PNPM_ENV,
    platform: 'linux',
    execPath: '/node',
  });

  it('runs every script sequentially and exits 0 when all succeed', async () => {
    const order: string[] = [];
    const spawnScript = vi.fn(async (invocation: { script: string }) => {
      order.push(invocation.script);
      return 0;
    });
    await expect(runInvocations(invocations, spawnScript)).resolves.toBe(0);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('stops at the first failure and propagates its exit code', async () => {
    const spawnScript = vi.fn(async (invocation: { script: string }) =>
      invocation.script === 'b' ? 7 : 0,
    );
    await expect(runInvocations(invocations, spawnScript)).resolves.toBe(7);
    expect(spawnScript.mock.calls.map(([invocation]) => invocation.script)).toEqual(['a', 'b']);
  });

  it('does not start a later script while an earlier one is still running', async () => {
    let resolveFirst: (code: number) => void = () => {};
    const spawnScript = vi.fn(
      (invocation: { script: string }) =>
        new Promise<number>((resolve) => {
          if (invocation.script === 'a') resolveFirst = resolve;
          else resolve(0);
        }),
    );
    const run = runInvocations(invocations, spawnScript);
    await Promise.resolve();
    expect(spawnScript).toHaveBeenCalledTimes(1);
    resolveFirst(0);
    await expect(run).resolves.toBe(0);
    expect(spawnScript).toHaveBeenCalledTimes(3);
  });
});
