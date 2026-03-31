import { describe, it, expect } from 'vitest';
import {
  normalizeMcpServers,
  toAcpMcpServers,
  type NormalizedMcpServers,
} from '../main/universal-mcp-config';

describe('toAcpMcpServers', () => {
  it('should return an empty array for empty input', () => {
    expect(toAcpMcpServers({})).toEqual([]);
  });

  it('should convert a stdio server with env vars', () => {
    const normalized: NormalizedMcpServers = {
      'workspace-mcp': {
        kind: 'stdio',
        command: '/usr/bin/node',
        args: ['server.js', '--port', '3000'],
        env: { NODE_ENV: 'production', CUSTOM_VAR: 'some-value' }, // pragma: allowlist secret
      },
    };

    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'workspace-mcp',
      command: '/usr/bin/node',
      args: ['server.js', '--port', '3000'],
      env: [
        { name: 'NODE_ENV', value: 'production' },
        { name: 'CUSTOM_VAR', value: 'some-value' },
      ],
    });
    // Stdio servers must NOT have a `type` field — the claude-agent-acp adapter
    // uses `"type" in server` to discriminate between stdio and http/sse.
    expect('type' in result[0]).toBe(false);
  });

  it('should convert a stdio server with empty env and args', () => {
    const normalized: NormalizedMcpServers = {
      minimal: {
        kind: 'stdio',
        command: 'echo',
        args: [],
        env: {},
      },
    };

    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'minimal',
      command: 'echo',
      args: [],
      env: [],
    });
  });

  it('should convert an http server with headers', () => {
    const normalized: NormalizedMcpServers = {
      'remote-api': {
        kind: 'http',
        url: 'https://api.example.com/mcp',
        headers: { Authorization: 'Bearer token123', 'X-Custom': 'value' },
      },
    };

    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'remote-api',
      type: 'http',
      url: 'https://api.example.com/mcp',
      headers: [
        { name: 'Authorization', value: 'Bearer token123' },
        { name: 'X-Custom', value: 'value' },
      ],
    });
  });

  it('should convert an sse server without headers', () => {
    const normalized: NormalizedMcpServers = {
      'sse-server': {
        kind: 'sse',
        url: 'https://stream.example.com/events',
      },
    };

    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'sse-server',
      type: 'sse',
      url: 'https://stream.example.com/events',
      headers: [],
    });
    // ACP SDK requires headers to always be present (empty array when none)
    expect('headers' in result[0]).toBe(true);
  });

  it('should convert mixed server types preserving order', () => {
    const normalized: NormalizedMcpServers = {
      'local-mcp': {
        kind: 'stdio',
        command: 'node',
        args: ['mcp-server.cjs'],
        env: { PORT: '5179' },
      },
      'remote-http': {
        kind: 'http',
        url: 'https://remote.example.com/mcp',
        headers: { 'X-Token': 'abc' },
      },
      'remote-sse': {
        kind: 'sse',
        url: 'https://sse.example.com/stream',
      },
    };

    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('local-mcp');
    expect(result[1].name).toBe('remote-http');
    expect(result[2].name).toBe('remote-sse');

    // Verify stdio has no type, http/sse have type
    expect('type' in result[0]).toBe(false);
    expect('type' in result[1]).toBe(true);
    expect('type' in result[2]).toBe(true);
  });

  it('should work end-to-end with normalizeMcpServers', () => {
    const raw = {
      'my-server': {
        command: 'npx',
        args: ['-y', '@my/mcp-server'],
        env: { DEBUG: '1' },
      },
      'my-remote': {
        type: 'http' as const,
        url: 'https://example.com/mcp',
      },
    };

    const normalized = normalizeMcpServers(raw);
    const result = toAcpMcpServers(normalized);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'my-server',
      command: 'npx',
      args: ['-y', '@my/mcp-server'],
      env: [{ name: 'DEBUG', value: '1' }],
    });
    expect(result[1]).toEqual({
      name: 'my-remote',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: [],
    });
  });
});
