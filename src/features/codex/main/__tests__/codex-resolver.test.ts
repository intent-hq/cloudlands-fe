import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../../../../shared/main/async-utils', () => ({
  execFileAsync: mocks.execFileAsync,
}));

vi.mock('../codex-acp-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../codex-acp-manager')>()),
  ensureManagedCodexAcp: vi.fn(),
}));

import { findBinary } from '../../../../shared/main/find-binary';
import { execFileAsync } from '../../../../shared/main/async-utils';
import { ensureManagedCodexAcp } from '../codex-acp-manager';
import {
  clearCodexCache,
  CODEX_ACP_NPX_PACKAGE,
  CODEX_CLI_NPX_PACKAGE,
  MINIMUM_CODEX_APP_SERVER_VERSION,
  resolveCodexCommand,
  resolveCodexMcpCommand,
  resolveCodexModelListCommands,
} from '../codex-resolver';

describe('codex-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCodexCache();
    vi.mocked(ensureManagedCodexAcp).mockRejectedValue(new Error('managed unavailable'));
    vi.mocked(execFileAsync).mockRejectedValue(
      Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
    );
  });

  it('resolves session command to managed codex-acp before user-installed and npx candidates', async () => {
    vi.mocked(ensureManagedCodexAcp).mockResolvedValue({
      wrapperPath: '/managed/codex-acp.js',
      version: '0.13.0',
    });

    const result = await resolveCodexCommand();

    expect(result).toEqual({
      command: process.execPath,
      argsPrefix: ['/managed/codex-acp.js'],
      usesNpx: false,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(findBinary).not.toHaveBeenCalled();
  });

  it('falls back to the user-installed codex-acp command path when managed is unavailable', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      return null;
    });

    const result = await resolveCodexCommand();
    expect(result).toEqual({ command: '/usr/local/bin/codex-acp', argsPrefix: [], usesNpx: false });
  });

  it('pins the npx codex-acp fallback to the managed runtime version', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'npx') return '/usr/local/bin/npx';
      return null;
    });

    const result = await resolveCodexCommand();
    expect(result).toEqual({
      command: '/usr/local/bin/npx',
      argsPrefix: ['-y', CODEX_ACP_NPX_PACKAGE],
      usesNpx: true,
    });
    expect(CODEX_ACP_NPX_PACKAGE).toMatch(/^@zed-industries\/codex-acp@\d+\.\d+\.\d+$/);
  });

  it('prepends the official codex app-server candidate when a recent CLI is available', async () => {
    vi.mocked(ensureManagedCodexAcp).mockResolvedValue({
      wrapperPath: '/managed/codex-acp.js',
      version: '0.13.0',
    });
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      if (name === 'npx') return '/usr/local/bin/npx';
      return null;
    });
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: `codex-cli ${MINIMUM_CODEX_APP_SERVER_VERSION}`,
      stderr: '',
    });

    const result = await resolveCodexModelListCommands();

    expect(result[0]).toEqual({
      command: '/opt/homebrew/bin/codex',
      argsPrefix: ['app-server', '--listen', 'stdio://'],
      usesNpx: false,
      source: 'codex-app-server',
      codexCliVersion: MINIMUM_CODEX_APP_SERVER_VERSION,
    });
    expect(result.map((candidate) => candidate.source)).toEqual([
      'codex-app-server',
      'managed-codex-acp',
      'codex-acp',
      'npx-codex-acp',
    ]);
    expect(execFileAsync).toHaveBeenCalledWith(
      '/opt/homebrew/bin/codex',
      ['--version'],
      expect.objectContaining({ encoding: 'utf8', timeout: 1500 }),
    );
  });

  it('accepts the legacy official codex CLI version output format', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      return null;
    });
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: `codex ${MINIMUM_CODEX_APP_SERVER_VERSION}`,
      stderr: '',
    });

    const result = await resolveCodexModelListCommands();

    expect(result[0]).toEqual({
      command: '/opt/homebrew/bin/codex',
      argsPrefix: ['app-server', '--listen', 'stdio://'],
      usesNpx: false,
      source: 'codex-app-server',
      codexCliVersion: MINIMUM_CODEX_APP_SERVER_VERSION,
    });
  });

  it.each(['0.128.0-rc1', '0.128.0-beta.5', '0.128.0+build.1'])(
    'accepts codex CLI version output with prerelease/build suffix %s',
    async (version) => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'codex') return '/opt/homebrew/bin/codex';
        return null;
      });
      vi.mocked(execFileAsync).mockResolvedValue({
        stdout: `codex-cli ${version}`,
        stderr: '',
      });

      const result = await resolveCodexModelListCommands();

      expect(result[0]).toEqual({
        command: '/opt/homebrew/bin/codex',
        argsPrefix: ['app-server', '--listen', 'stdio://'],
        usesNpx: false,
        source: 'codex-app-server',
        codexCliVersion: '0.128.0',
      });
    },
  );

  it.each(['codex-cli 0.128.0rc1', 'codex-cli version 0.128.0', 'codex-cli nope'])(
    'rejects malformed codex CLI version output %s',
    async (stdout) => {
      vi.mocked(findBinary).mockImplementation(async (name) => {
        if (name === 'codex') return '/opt/homebrew/bin/codex';
        return null;
      });
      vi.mocked(execFileAsync).mockResolvedValue({ stdout, stderr: '' });

      const result = await resolveCodexModelListCommands();

      expect(result.some((candidate) => candidate.source === 'codex-app-server')).toBe(false);
    },
  );

  it('orders model-listing candidates as managed, codex-acp, then npx bridge for old CLIs', async () => {
    vi.mocked(ensureManagedCodexAcp).mockResolvedValue({
      wrapperPath: '/managed/codex-acp.js',
      version: '0.13.0',
    });
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      if (name === 'npx') return '/usr/local/bin/npx';
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      return null;
    });
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: 'codex-cli 0.127.9',
      stderr: '',
    });

    const result = await resolveCodexModelListCommands();

    expect(result).toEqual([
      {
        command: process.execPath,
        argsPrefix: ['/managed/codex-acp.js'],
        usesNpx: false,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        source: 'managed-codex-acp',
      },
      { command: '/usr/local/bin/codex-acp', argsPrefix: [], usesNpx: false, source: 'codex-acp' },
      {
        command: '/usr/local/bin/npx',
        argsPrefix: ['-y', CODEX_ACP_NPX_PACKAGE],
        usesNpx: true,
        source: 'npx-codex-acp',
      },
    ]);
    expect(result.some((candidate) => candidate.argsPrefix.includes('app-server'))).toBe(false);
  });

  it('does not include the app-server candidate when the official codex CLI is old', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      return null;
    });
    vi.mocked(execFileAsync).mockResolvedValue({
      stdout: 'codex-cli 0.127.9',
      stderr: '',
    });

    const result = await resolveCodexModelListCommands();

    expect(result[0]).toEqual({
      command: '/usr/local/bin/codex-acp',
      argsPrefix: [],
      usesNpx: false,
      source: 'codex-acp',
    });
    expect(result).toHaveLength(1);
  });

  it('returns no app-server model-listing candidate when the official codex CLI is absent', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      return null;
    });

    const result = await resolveCodexModelListCommands();

    expect(result).toEqual([
      { command: '/usr/local/bin/codex-acp', argsPrefix: [], usesNpx: false, source: 'codex-acp' },
    ]);
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('falls back to a pinned @openai/codex npx package for the MCP server', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'npx') return '/usr/local/bin/npx';
      return null;
    });

    const result = await resolveCodexMcpCommand();
    expect(result).toEqual({
      command: '/usr/local/bin/npx',
      args: ['-y', CODEX_CLI_NPX_PACKAGE, 'mcp-server'],
      usesNpx: true,
    });
    expect(CODEX_CLI_NPX_PACKAGE).toMatch(/^@openai\/codex@\d+\.\d+\.\d+$/);
  });

  it('retries the app-server version probe after failed attempts', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      return null;
    });
    vi.mocked(execFileAsync)
      .mockRejectedValueOnce(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }))
      .mockResolvedValueOnce({ stdout: `codex-cli ${MINIMUM_CODEX_APP_SERVER_VERSION}`, stderr: '' });

    expect(await resolveCodexModelListCommands()).toEqual([]);

    const result = await resolveCodexModelListCommands();

    expect(result[0]).toEqual({
      command: '/opt/homebrew/bin/codex',
      argsPrefix: ['app-server', '--listen', 'stdio://'],
      usesNpx: false,
      source: 'codex-app-server',
      codexCliVersion: MINIMUM_CODEX_APP_SERVER_VERSION,
    });
    expect(execFileAsync).toHaveBeenCalledTimes(2);
  });
});
