import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../codex-acp-manager', () => ({
  ensureManagedCodexAcp: vi.fn(),
}));

import { findBinary } from '../../../../shared/main/find-binary';
import { ensureManagedCodexAcp } from '../codex-acp-manager';
import {
  clearCodexCache,
  resolveCodexCommand,
  resolveCodexModelListCommands,
} from '../codex-resolver';

describe('codex-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCodexCache();
    vi.mocked(ensureManagedCodexAcp).mockRejectedValue(new Error('managed unavailable'));
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

  it('orders model-listing candidates as managed, codex-acp, then npx bridge', async () => {
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
        argsPrefix: ['-y', '@zed-industries/codex-acp'],
        usesNpx: true,
        source: 'npx-codex-acp',
      },
    ]);
    expect(result.some((candidate) => candidate.argsPrefix.includes('app-server'))).toBe(false);
  });

  it('does not include the official codex CLI for model-listing', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      if (name === 'codex-acp') return '/usr/local/bin/codex-acp';
      return null;
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

  it('returns no model-listing candidates when only the official codex CLI is available', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) => {
      if (name === 'codex') return '/opt/homebrew/bin/codex';
      return null;
    });

    const result = await resolveCodexModelListCommands();

    expect(result).toEqual([]);
  });
});
