import { describe, expect, it, vi } from 'vitest';
import { JsonRpcError, relayErrorMessage } from './json-rpc-errors';

describe('relayErrorMessage', () => {
  const detail = 'UNIQUE constraint failed: interrupted_agent.agent_id';

  it.each([detail, { detail }])('formats the normalized RPC cause from %j', (data) => {
    const error = new JsonRpcError({ code: -32603, message: 'Internal error', data });
    expect(relayErrorMessage(error)).toBe(`Internal error: ${detail}`);
    expect(error.message).toBe('Internal error');
  });

  it.each([
    undefined,
    null,
    {},
    { detail: '' },
    { detail: ' \n ' },
    { detail: 42 },
    { detail: ['private'] },
    { detail: { password: 'private' } },
    ['private'],
  ])('keeps the generic message for missing or malformed detail: %j', (data) => {
    expect(
      relayErrorMessage(new JsonRpcError({ code: -32603, message: 'Internal error', data })),
    ).toBe('Internal error');
  });

  it('preserves ordinary messages and avoids repeating the generic message', () => {
    expect(relayErrorMessage(new Error('archive checksum mismatch'))).toBe(
      'archive checksum mismatch',
    );
    expect(relayErrorMessage('connection closed')).toBe('connection closed');
    expect(
      relayErrorMessage(
        new JsonRpcError({ code: -32603, message: 'Internal error', data: 'Internal error' }),
      ),
    ).toBe('Internal error');
    expect(
      relayErrorMessage(
        new JsonRpcError({ code: -32602, message: 'invalid archive', data: { detail } }),
      ),
    ).toBe('invalid archive');
  });

  it('never stringifies arbitrary error or detail objects', () => {
    const toString = vi.fn(() => 'private-payload');
    expect(relayErrorMessage({ token: 'private-payload', toString })).not.toContain(
      'private-payload',
    );
    expect(
      relayErrorMessage(
        new JsonRpcError({
          code: -32603,
          message: 'Internal error',
          data: { detail: { toString } },
        }),
      ),
    ).toBe('Internal error');
    expect(toString).not.toHaveBeenCalled();
  });

  it('keeps cancellation classification independent of the RPC detail', () => {
    expect(relayErrorMessage(new Error('cancelled'))).toBe('cancelled');
    expect(
      relayErrorMessage(
        new JsonRpcError({ code: -32603, message: 'Internal error', data: 'cancelled' }),
      ),
    ).toBe('Internal error: cancelled');
  });

  it.each([
    'Authorization: Bearer private-marker',
    'Authorization: Basic private-marker',
    'TOKEN=private-marker',
    '--password="private-marker"',
    'https://user:private-marker@host/import?api_key=private-marker#private-marker',
    'https://host/import?%74oken=private-marker',
    '{"password":"private-marker"}',
    'secret = "private-marker"',
    '-----BEGIN PRIVATE KEY-----\nprivate-marker\n-----END PRIVATE KEY-----',
  ])('redacts credentials from messages and RPC details: %s', (text) => {
    const errors = [
      new Error(`${detail}; ${text}`),
      new JsonRpcError({ code: -32603, message: 'Internal error', data: `${detail}; ${text}` }),
    ];
    for (const error of errors) {
      expect(relayErrorMessage(error)).toContain(detail);
      expect(relayErrorMessage(error)).not.toContain('private-marker');
    }
  });

  it('bounds the sanitized diagnostic and prevents control characters in log lines', () => {
    const error = new JsonRpcError({
      code: -32603,
      message: 'Internal error',
      data: `${detail}\n\u0000${'x'.repeat(5000)}`,
    });
    const text = relayErrorMessage(error);
    expect(text).toContain(detail);
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text).not.toMatch(/[\r\n\u0000]/);
  });
});
