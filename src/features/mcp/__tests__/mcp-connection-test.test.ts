import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the MCP connection test (PROTOCOL.md §5.22.2).
 *
 * `mcp-connection-test.ts` no longer fetches user-supplied MCP URLs from the
 * FE; the probe is delegated to the daemon via `mcp.testConnection` (v7.3).
 * These tests assert the exact request shape sent on the wire and feed back
 * PROTOCOL-shaped mock responses. RPC-level failures (daemon unreachable,
 * -32602) map to a local `{ status: 'error' }` result; probe outcomes are
 * always success responses per the contract.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

import { testMcpConnection } from '../main/mcp-connection-test';

describe('testMcpConnection ↔ daemon mcp.testConnection (PROTOCOL.md §5.22.2)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ status: 'connected', statusCode: 200 });
  });

  it('sends url-only params when headers and serverName are absent', async () => {
    await testMcpConnection('https://mcp.example.com/mcp');
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith('mcp.testConnection', {
      url: 'https://mcp.example.com/mcp',
    });
  });

  it('forwards headers and serverName on the wire', async () => {
    await testMcpConnection(
      'https://mcp.example.com/mcp',
      { Authorization: 'Bearer tok', 'X-Extra': '1' },
      'srv-linear',
    );
    expect(requestMock).toHaveBeenCalledWith('mcp.testConnection', {
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer tok', 'X-Extra': '1' },
      serverName: 'srv-linear',
    });
  });

  it('returns a connected result verbatim', async () => {
    requestMock.mockResolvedValueOnce({ status: 'connected', statusCode: 204 });
    await expect(testMcpConnection('https://mcp.example.com/mcp')).resolves.toEqual({
      status: 'connected',
      statusCode: 204,
    });
  });

  it('returns an auth_required result verbatim', async () => {
    requestMock.mockResolvedValueOnce({
      status: 'auth_required',
      statusCode: 401,
      errorMessage: 'authentication required (HTTP 401) — check configured headers',
    });
    await expect(
      testMcpConnection('https://mcp.example.com/mcp', undefined, 'srv-linear'),
    ).resolves.toEqual({
      status: 'auth_required',
      statusCode: 401,
      errorMessage: 'authentication required (HTTP 401) — check configured headers',
    });
  });

  it('returns a transport-failure error result verbatim (no statusCode)', async () => {
    requestMock.mockResolvedValueOnce({
      status: 'error',
      errorMessage: 'unreachable from daemon host: https://mcp.example.com/mcp',
    });
    await expect(testMcpConnection('https://mcp.example.com/mcp')).resolves.toEqual({
      status: 'error',
      errorMessage: 'unreachable from daemon host: https://mcp.example.com/mcp',
    });
  });

  it('maps an RPC failure to a local error result', async () => {
    requestMock.mockRejectedValueOnce(new Error('JSON-RPC request timed out: mcp.testConnection'));
    await expect(testMcpConnection('https://mcp.example.com/mcp')).resolves.toEqual({
      status: 'error',
      errorMessage: 'JSON-RPC request timed out: mcp.testConnection',
    });
  });
});
