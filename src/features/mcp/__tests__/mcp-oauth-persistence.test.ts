import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for MCP OAuth token persistence (PROTOCOL.md §5.22).
 *
 * `mcp-oauth.ts` no longer touches `electron-store`; token bags are pushed to
 * the daemon via `mcp.oauth.set` / `mcp.oauth.delete`. The daemon never echoes
 * raw bag contents back over the wire (§5.22.1), so the module keeps an
 * in-memory cache for the current process lifetime — a restart drops it.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async () => {}) },
}));

vi.mock('express', () => {
  const factory = () => ({ get: vi.fn(), listen: vi.fn() });
  return { default: factory };
});

describe('mcp-oauth ↔ daemon mcp.oauth.* (PROTOCOL.md §5.22)', () => {
  beforeEach(() => {
    requestMock.mockClear();
    vi.resetModules();
  });

  it('clearMcpOAuthTokens forwards to mcp.oauth.delete', async () => {
    const { clearMcpOAuthTokens } = await import('../main/mcp-oauth');
    await clearMcpOAuthTokens('srv-linear');
    expect(requestMock).toHaveBeenCalledWith('mcp.oauth.delete', {
      serverId: 'srv-linear',
    });
  });

  it('clearMcpOAuthTokens tolerates daemon failure', async () => {
    requestMock.mockRejectedValueOnce(new Error('daemon down'));
    const { clearMcpOAuthTokens } = await import('../main/mcp-oauth');
    await expect(clearMcpOAuthTokens('srv-linear')).resolves.toBeUndefined();
  });

  it('getMcpOAuthTokensAsync only reads the in-memory cache (no daemon round-trip)', async () => {
    const { getMcpOAuthTokensAsync } = await import('../main/mcp-oauth');
    const result = await getMcpOAuthTokensAsync('srv-unknown');
    expect(result).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
