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
  getDaemonVersionInfo,
  setConnectionMode,
  setDaemonVersionInfo,
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

  it('round-trips daemon version info and clears it on reset', () => {
    expect(getDaemonVersionInfo()).toBeNull();
    setDaemonVersionInfo({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    __resetConnectionModeForTesting();
    expect(getDaemonVersionInfo()).toBeNull();
  });
});

describe('formatTransportInfo', () => {
  it('reports sidecar-uds with the socket path when the mode is sidecar', () => {
    setConnectionMode('sidecar');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
      target: '/tmp/i.sock',
    });
  });

  it('reports sidecar-uds with the socket path while the mode is still unknown (legacy default)', () => {
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
      target: '/tmp/i.sock',
    });
  });

  it('reports external-uds with the socket path when the mode is external', () => {
    setConnectionMode('external');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
    });
  });

  it('includes daemonVersion and versionMismatch for external UDS when version info is set', () => {
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      daemonVersion: '0.2.0',
      versionMismatch: true,
    });
  });

  it('reports versionMismatch false for external UDS when versions match', () => {
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      daemonVersion: '0.1.0',
      versionMismatch: false,
    });
  });

  it('omits version fields for sidecar UDS even when version info is set', () => {
    setConnectionMode('sidecar');
    setDaemonVersionInfo({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
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
