import { describe, expect, it } from 'vitest';
import { pnpmInvocation, quoteForCmd } from './pnpm-launcher.mjs';

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

  it('uses a shell with cmd.exe-quoted arguments for the PATH fallback on Windows', () => {
    expect(
      pnpmInvocation(['run', 'dev'], { env: {}, platform: 'win32', execPath: 'node.exe' }),
    ).toEqual({ executable: 'pnpm', args: ['^"run^"', '^"dev^"'], shell: true });
  });

  it('keeps spaces and cmd.exe metacharacters inside one argument on the Windows fallback', () => {
    const invocation = pnpmInvocation(['exec', 'prettier', '--check', 'src/a & b.ts'], {
      env: {},
      platform: 'win32',
      execPath: 'node.exe',
    });
    expect(invocation.shell).toBe(true);
    expect(invocation.args).toHaveLength(4);
    expect(invocation.args[3]).toBe('^"src/a^ ^&^ b.ts^"');
  });

  it('does not quote arguments when the node launcher is used on Windows', () => {
    const invocation = pnpmInvocation(['exec', 'prettier', 'src/a & b.ts'], {
      env: { ...PNPM_ENV, npm_execpath: 'C:\\pnpm\\bin\\pnpm.cjs' },
      platform: 'win32',
      execPath: 'C:\\node\\node.exe',
    });
    expect(invocation.shell).toBe(false);
    expect(invocation.args).toEqual([
      'C:\\pnpm\\bin\\pnpm.cjs',
      'exec',
      'prettier',
      'src/a & b.ts',
    ]);
  });

  it('does not quote arguments for the PATH fallback off Windows', () => {
    const invocation = pnpmInvocation(['exec', 'prettier', 'src/a & b.ts'], {
      env: {},
      platform: 'linux',
      execPath: '/node',
    });
    expect(invocation).toEqual({
      executable: 'pnpm',
      args: ['exec', 'prettier', 'src/a & b.ts'],
      shell: false,
    });
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

describe('quoteForCmd', () => {
  it('wraps the argument in quotes and caret-escapes every cmd.exe metacharacter', () => {
    expect(quoteForCmd('plain')).toBe('^"plain^"');
    expect(quoteForCmd('a b')).toBe('^"a^ b^"');
    expect(quoteForCmd('a&b|c<d>e')).toBe('^"a^&b^|c^<d^>e^"');
    expect(quoteForCmd('%PATH%')).toBe('^"^%PATH^%^"');
  });

  it('escapes embedded quotes and trailing backslashes for the argv parser', () => {
    expect(quoteForCmd('say "hi"')).toBe('^"say^ \\^"hi\\^"^"');
    expect(quoteForCmd('C:\\dir\\')).toBe('^"C:\\dir\\\\^"');
    expect(quoteForCmd('C:\\dir')).toBe('^"C:\\dir^"');
  });

  it('accepts non-string arguments', () => {
    expect(quoteForCmd(3100)).toBe('^"3100^"');
  });
});
