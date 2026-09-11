import { describe, expect, it } from 'vitest';
import { pnpmInvocation } from './pnpm-launcher.mjs';

const PNPM_ENV = {
  npm_execpath: '/store/pnpm/10.30.3/bin/pnpm.cjs',
  npm_config_user_agent: 'pnpm/10.30.3 npm/? node/v24.19.0 linux x64',
};

describe('pnpm-launcher', () => {
  it('runs the invoking pnpm through node when launched by pnpm run', () => {
    expect(
      pnpmInvocation(['exec', 'tsc'], { env: PNPM_ENV, platform: 'linux', execPath: '/node' }),
    ).toEqual({
      executable: '/node',
      args: ['/store/pnpm/10.30.3/bin/pnpm.cjs', 'exec', 'tsc'],
      shell: false,
    });
  });

  it('does not need a shell for the node launcher on Windows', () => {
    const invocation = pnpmInvocation(['run', 'check'], {
      env: { ...PNPM_ENV, npm_execpath: 'C:\\pnpm\\bin\\pnpm.cjs' },
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
    });
    expect(invocation).toEqual({
      executable: 'C:\\node\\node.exe',
      args: ['C:\\pnpm\\bin\\pnpm.cjs', 'run', 'check'],
      shell: false,
    });
  });

  it('falls back to the pnpm on PATH when npm_execpath is unset', () => {
    expect(
      pnpmInvocation(['exec', 'tsc'], { env: {}, platform: 'linux', execPath: '/node' }),
    ).toEqual({
      executable: 'pnpm',
      args: ['exec', 'tsc'],
      shell: false,
    });
  });

  it('uses a shell for the PATH fallback on Windows', () => {
    expect(
      pnpmInvocation(['run', 'dev'], { env: {}, platform: 'win32', execPath: 'node.exe' }),
    ).toEqual({ executable: 'pnpm', args: ['run', 'dev'], shell: true });
  });

  it('ignores npm_execpath from a runner that is not pnpm', () => {
    const invocation = pnpmInvocation(['exec', 'tsc'], {
      env: {
        npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
        npm_config_user_agent: 'npm/10.9.0 node/v24.19.0 linux x64',
      },
      platform: 'linux',
      execPath: '/node',
    });
    expect(invocation).toEqual({ executable: 'pnpm', args: ['exec', 'tsc'], shell: false });
  });

  it('ignores an npm_execpath that node cannot run directly', () => {
    const invocation = pnpmInvocation(['exec', 'tsc'], {
      env: { ...PNPM_ENV, npm_execpath: '/usr/local/bin/pnpm' },
      platform: 'linux',
      execPath: '/node',
    });
    expect(invocation).toEqual({ executable: 'pnpm', args: ['exec', 'tsc'], shell: false });
  });

  it('does not share the caller argument array', () => {
    const args = ['exec', 'tsc'];
    const invocation = pnpmInvocation(args, { env: {}, platform: 'linux', execPath: '/node' });
    expect(invocation.args).not.toBe(args);
  });
});
