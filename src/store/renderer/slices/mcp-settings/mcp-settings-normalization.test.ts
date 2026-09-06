import { describe, expect, it } from 'vitest';
import {
  mapDaemonMcpState,
  normalizeDisabledServers,
  normalizeMcpServerStatus,
  normalizeMcpServersPayload,
  toMcpErrorMessage,
} from './mcp-settings-normalization';

describe('mcp-settings normalization', () => {
  it('maps daemon states (PROTOCOL §5.22) to FE badge statuses', () => {
    expect(mapDaemonMcpState('running')).toBe('connected');
    expect(mapDaemonMcpState('starting')).toBe('configured');
    expect(mapDaemonMcpState('stopped')).toBe('stopped');
    expect(mapDaemonMcpState('error')).toBe('error');
    expect(mapDaemonMcpState('warming-up')).toBeNull();
    expect(mapDaemonMcpState(undefined)).toBeNull();
  });

  it('converts object-shaped errors into stable string messages', () => {
    expect(toMcpErrorMessage({ message: 'Main process failed' }, 'fallback')).toBe(
      'Main process failed',
    );
    expect(toMcpErrorMessage({ code: 'E_MCP', reason: { retryable: false } }, 'fallback')).toBe(
      '{"retryable":false}',
    );

    const cyclic: { error?: unknown; self?: unknown } = {};
    cyclic.error = cyclic;
    cyclic.self = cyclic;
    expect(toMcpErrorMessage(cyclic, 'fallback')).toBe(
      '{"error":"[Circular]","self":"[Circular]"}',
    );
  });

  it('drops malformed server entries and narrows server fields', () => {
    const servers = normalizeMcpServersPayload({
      servers: [
        {
          name: 'valid-stdio',
          type: 'stdio',
          command: 'node',
          args: 'server --debug',
          env: { TOKEN: 'abc', BAD: 123 },
        },
        { name: 123, command: 'ignored' },
        'not-a-server',
        {
          name: 'valid-http',
          transport: 'sse',
          url: ' https://example.test/sse ',
          headers: { Authorization: 'Bearer token', BAD: false },
          authType: 'oauth',
        },
      ],
    });

    expect(servers).toEqual([
      {
        name: 'valid-stdio',
        type: 'stdio',
        command: 'node',
        args: ['server', '--debug'],
        env: { TOKEN: 'abc' },
      },
      {
        name: 'valid-http',
        type: 'sse',
        url: 'https://example.test/sse',
        headers: { Authorization: 'Bearer token' },
        authType: 'oauth',
      },
    ]);
  });

  it('normalizes disabled server names and connection statuses', () => {
    expect(normalizeDisabledServers(['alpha', 42, ' beta ', null])).toEqual({
      alpha: true,
      beta: true,
    });
    expect(normalizeMcpServerStatus('auth_required')).toBe('auth_required');
    expect(normalizeMcpServerStatus('stopped')).toBe('stopped');
    expect(normalizeMcpServerStatus({ status: 'error' })).toBeUndefined();
  });
});
