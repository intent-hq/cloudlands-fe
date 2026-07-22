/**
 * Tests for connection-mode state and the renderer-safe transport payload.
 *
 * `formatTransportInfo` must report the real connection mode for UDS
 * transports (sidecar-uds vs external-uds) and sanitize WS URLs.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetConnectionModeForTesting,
  getConnectionMode,
  setConnectionMode,
} from '../connection-mode';
import { formatTransportInfo } from '../transport-info';

afterEach(() => {
  __resetConnectionModeForTesting();
});

describe('connection-mode', () => {
  it('defaults to unknown before resolution', () => {
    expect(getConnectionMode()).toBe('unknown');
  });

  it('round-trips setConnectionMode/getConnectionMode', () => {
    setConnectionMode('sidecar');
    expect(getConnectionMode()).toBe('sidecar');
    setConnectionMode('external');
    expect(getConnectionMode()).toBe('external');
  });
});

describe('formatTransportInfo', () => {
  it('reports sidecar-uds for UDS when the mode is sidecar', () => {
    setConnectionMode('sidecar');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
    });
  });

  it('reports sidecar-uds for UDS while the mode is still unknown (legacy default)', () => {
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
    });
  });

  it('reports external-uds with the socket path when the mode is external', () => {
    setConnectionMode('external');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
    });
  });

  it('reports external-ws with a sanitized URL (strips userinfo + query)', () => {
    expect(
      formatTransportInfo({ transport: 'ws', wsUrl: 'ws://user:secret@127.0.0.1:5181/ws?token=abc' }),
    ).toEqual({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/ws' });
  });

  it('reports external-ws with undefined target for an unparsable WS URL', () => {
    expect(formatTransportInfo({ transport: 'ws', wsUrl: 'not-a-url' })).toEqual({
      mode: 'external-ws',
      target: undefined,
    });
  });

  it('treats the TCP stub as external-ws', () => {
    expect(formatTransportInfo({ transport: 'tcp', host: '10.0.0.1', port: 6000 })).toEqual({
      mode: 'external-ws',
      target: 'tcp:10.0.0.1:6000',
    });
  });
});
