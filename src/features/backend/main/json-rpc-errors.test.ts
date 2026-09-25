import { describe, expect, it, vi } from 'vitest';
import { JsonRpcError, relayErrorMessage } from './json-rpc-errors';
import * as credentials from '../../../shared/utils/sanitize-credentials';
import * as pairing from '../../deeplink/utils/scrub-token';

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
    'token="Bearer private-marker"',
    "secret='two words private-marker'",
    '%74oken="Bearer private-marker"',
    'token="escaped \\"quote\\" private-marker"',
    'token="unterminated private-marker',
    '--password "unterminated private-marker',
    'Cookie: session=private-marker; another=private-marker',
    'Set-Cookie: session=private-marker; HttpOnly',
    'Authorization: Digest username="demo", response="private-marker"',
    'Proxy-Authorization: Custom private-marker more-private-marker',
    '{"Authorization":"Digest username=\\"demo\\", response=\\"private-marker\\""}',
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

  it('prevents control characters in bounded log diagnostics', () => {
    const error = new JsonRpcError({
      code: -32603,
      message: 'Internal error',
      data: `${detail}\n\u0000more context`,
    });
    const text = relayErrorMessage(error);
    expect(text).toContain(detail);
    expect(text.length).toBeLessThanOrEqual(2048);
    expect(text).not.toMatch(/[\r\n\u0000]/);
  });

  it('discards oversized fields before the expensive scrubbers run', () => {
    const command = credentials.sanitizeCommandForDisplay;
    const scrub = pairing.scrubToken;
    // Guard the expensive seams, so a regression fails deterministically
    // without spending quadratic time on the large fixture.
    const commandSpy = vi
      .spyOn(credentials, 'sanitizeCommandForDisplay')
      .mockImplementation((value) => {
        expect(value.length).toBeLessThanOrEqual(4096);
        return command(value);
      });
    const pairingSpy = vi.spyOn(pairing, 'scrubToken').mockImplementation((value) => {
      expect(value.length).toBeLessThanOrEqual(4096);
      return scrub(value);
    });
    try {
      const huge = `token="private-marker ${'x'.repeat(1_000_000)}"`;
      for (const data of [huge, { detail: huge }]) {
        expect(
          relayErrorMessage(new JsonRpcError({ code: -32603, message: 'Internal error', data })),
        ).toBe('Internal error');
      }
      for (const error of [new Error(huge), huge]) {
        const text = relayErrorMessage(error);
        expect(text).not.toContain('private-marker');
        expect(text.length).toBeLessThanOrEqual(2048);
      }
      expect(commandSpy).not.toHaveBeenCalled();
      expect(pairingSpy).not.toHaveBeenCalled();
    } finally {
      commandSpy.mockRestore();
      pairingSpy.mockRestore();
    }
  });

  it.each([
    'token="Bearer private-marker',
    '--password "two words private-marker',
    'Authorization: Digest response="private-marker',
    'Cookie: session=private-marker',
    '-----BEGIN PRIVATE KEY-----private-marker',
  ])('never exposes a credential crossing the output boundary: %s', (credential) => {
    for (const length of [2047, 2048, 2049, 8192]) {
      const text = relayErrorMessage(new Error(`${detail}; ${credential}`.padEnd(length, 'x')));
      expect(text).not.toContain('private-marker');
      expect(text.length).toBeLessThanOrEqual(2048);
    }
  });
});
