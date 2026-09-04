import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: vi.fn(),
  findBinaryStrict: vi.fn(),
  getCommonNpmPaths: vi.fn(() => []),
}));

import { findBinary, findBinaryStrict } from '../../../../shared/main/find-binary';
import {
  clearCodexCache,
  CODEX_CLI_NPX_PACKAGE,
  getCodexPath,
  isCodexInstalled,
  resolveCodexMcpCommand,
} from '../codex-resolver';

describe('codex-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCodexCache();
    vi.mocked(findBinary).mockResolvedValue(null);
    vi.mocked(findBinaryStrict).mockResolvedValue(null);
  });

  it('reports codex installed from the daemon-resolved codex CLI path', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) =>
      name === 'codex' ? '/opt/homebrew/bin/codex' : null,
    );
    vi.mocked(findBinaryStrict).mockImplementation(async (name) =>
      name === 'codex' ? '/opt/homebrew/bin/codex' : null,
    );

    expect(await isCodexInstalled()).toBe(true);
    expect(await getCodexPath()).toBe('/opt/homebrew/bin/codex');
  });

  it('reports codex uninstalled when the codex CLI does not resolve', async () => {
    expect(await isCodexInstalled()).toBe(false);
    expect(await getCodexPath()).toBeNull();
  });

  it('isCodexInstalled propagates a probe failure instead of reporting uninstalled', async () => {
    // A failed daemon RPC proves nothing about availability — the caller
    // (provider availability check) must see the failure, not available:false.
    vi.mocked(findBinaryStrict).mockRejectedValue(new Error('transport down'));

    await expect(isCodexInstalled()).rejects.toThrow('transport down');
    expect(findBinaryStrict).toHaveBeenCalledWith('codex', expect.any(Object));
  });

  it('getCodexPath stays on the lenient findBinary lookup', async () => {
    // Spawn-path consumers keep the lenient contract; the fold-to-null
    // behavior itself is pinned in find-binary.test.ts.
    vi.mocked(findBinary).mockResolvedValue(null);

    expect(await getCodexPath()).toBeNull();
    expect(findBinary).toHaveBeenCalledWith('codex', expect.any(Object));
  });

  it('caches the resolved codex CLI path until the cache is cleared', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) =>
      name === 'codex' ? '/opt/homebrew/bin/codex' : null,
    );

    await getCodexPath();
    await getCodexPath();
    expect(findBinary).toHaveBeenCalledTimes(1);

    clearCodexCache();
    await getCodexPath();
    expect(findBinary).toHaveBeenCalledTimes(2);
  });

  it('prefers a dedicated codex-mcp-server binary for the MCP server', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) =>
      name === 'codex-mcp-server' ? '/usr/local/bin/codex-mcp-server' : null,
    );

    expect(await resolveCodexMcpCommand()).toEqual({
      command: '/usr/local/bin/codex-mcp-server',
      args: [],
      usesNpx: false,
    });
  });

  it('falls back to the codex CLI mcp-server subcommand', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) =>
      name === 'codex' ? '/opt/homebrew/bin/codex' : null,
    );

    expect(await resolveCodexMcpCommand()).toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['mcp-server'],
      usesNpx: false,
    });
  });

  it('falls back to a pinned @openai/codex npx package for the MCP server', async () => {
    vi.mocked(findBinary).mockImplementation(async (name) =>
      name === 'npx' ? '/usr/local/bin/npx' : null,
    );

    const result = await resolveCodexMcpCommand();
    expect(result).toEqual({
      command: '/usr/local/bin/npx',
      args: ['-y', CODEX_CLI_NPX_PACKAGE, 'mcp-server'],
      usesNpx: true,
    });
    expect(CODEX_CLI_NPX_PACKAGE).toMatch(/^@openai\/codex@\d+\.\d+\.\d+$/);
  });

  it('returns null when no MCP server path resolves', async () => {
    expect(await resolveCodexMcpCommand()).toBeNull();
  });
});
