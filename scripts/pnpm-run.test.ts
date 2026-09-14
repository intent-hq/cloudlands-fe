import { describe, expect, it } from 'vitest';
import { parseArgs, planInvocation } from './pnpm-run.mjs';

const PNPM_ENV = {
  npm_execpath: '/store/pnpm/10.30.3/bin/pnpm.cjs',
  npm_config_user_agent: 'pnpm/10.30.3 npm/? node/v24.19.0 linux x64',
};

describe('parseArgs', () => {
  it('takes exactly the first argument as the script name', () => {
    expect(parseArgs(['lint'])).toEqual({ script: 'lint', forwarded: [] });
  });

  it('forwards a positional that equals another script name instead of running it', () => {
    expect(parseArgs(['test:unit', 'test:integration'])).toEqual({
      script: 'test:unit',
      forwarded: ['test:integration'],
    });
    expect(parseArgs(['capture', 'other', '--help'])).toEqual({
      script: 'capture',
      forwarded: ['other', '--help'],
    });
  });

  it('keeps a user-written "--" and everything after it verbatim', () => {
    expect(parseArgs(['test:ct', '--', '--grep', 'geometry snapshot', '--'])).toEqual({
      script: 'test:ct',
      forwarded: ['--', '--grep', 'geometry snapshot', '--'],
    });
    expect(parseArgs(['lint', '--', 'x'])).toEqual({ script: 'lint', forwarded: ['--', 'x'] });
  });

  it('rejects a missing script name', () => {
    expect(() => parseArgs([])).toThrow(/No script name/);
    expect(() => parseArgs(['--', '--fix'])).toThrow(/No script name/);
    expect(() => parseArgs(['--help'])).toThrow(/No script name/);
  });

  it('forwards trailing flags appended by the outer pnpm', () => {
    expect(parseArgs(['dev:web', '--help'])).toEqual({ script: 'dev:web', forwarded: ['--help'] });
    expect(parseArgs(['dev:web', '--port', '3100', '--host'])).toEqual({
      script: 'dev:web',
      forwarded: ['--port', '3100', '--host'],
    });
    expect(parseArgs(['test:ct', '--grep', 'geometry', 'src/a.spec.ts'])).toEqual({
      script: 'test:ct',
      forwarded: ['--grep', 'geometry', 'src/a.spec.ts'],
    });
  });
});

describe('planInvocation', () => {
  const options = { env: PNPM_ENV, platform: 'linux', execPath: '/node' };

  it('routes the script through the invoking pnpm', () => {
    expect(planInvocation(parseArgs(['lint']), options)).toEqual({
      script: 'lint',
      executable: '/node',
      args: ['/store/pnpm/10.30.3/bin/pnpm.cjs', 'run', 'lint'],
      shell: false,
    });
  });

  it('forwards "--" arguments exactly as pnpm run would receive them', () => {
    const invocation = planInvocation(parseArgs(['test:ct', '--', '--grep', 'a b']), options);
    expect(invocation.args).toEqual([
      '/store/pnpm/10.30.3/bin/pnpm.cjs',
      'run',
      'test:ct',
      '--',
      '--grep',
      'a b',
    ]);
  });

  it('forwards bare trailing flags without inserting "--"', () => {
    const invocation = planInvocation(parseArgs(['dev:web', '--help']), options);
    expect(invocation.args).toEqual([
      '/store/pnpm/10.30.3/bin/pnpm.cjs',
      'run',
      'dev:web',
      '--help',
    ]);
  });

  it('never consumes more than one script, so shell chains forward to the last member', () => {
    const invocation = planInvocation(parseArgs(['check', 'lint', '--fix', 'src']), options);
    expect(invocation.args).toEqual([
      '/store/pnpm/10.30.3/bin/pnpm.cjs',
      'run',
      'check',
      'lint',
      '--fix',
      'src',
    ]);
  });

  it('uses the cmd.exe-quoted PATH fallback on Windows without npm_execpath', () => {
    const invocation = planInvocation(parseArgs(['dev:web']), {
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
