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
  getLocalUpdateSupported,
  getOrphanedSidecarInfo,
  setConnectionMode,
  setDaemonVersionInfo,
  setLocalUpdateSupported,
  setOrphanedSidecarInfo,
} from '../connection-mode';
import { computeDaemonVersionRefresh } from '../daemon-version-refresh';
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
    setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      daemonBuildCommit: '0123456789abcdef',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(getDaemonVersionInfo()).toEqual({
      daemonVersion: '0.2.0',
      daemonBuildCommit: '0123456789abcdef',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    __resetConnectionModeForTesting();
    expect(getDaemonVersionInfo()).toBeNull();
  });

  it('round-trips orphaned-sidecar info and clears it on reset (#2444)', () => {
    expect(getOrphanedSidecarInfo()).toBeNull();
    setOrphanedSidecarInfo({ pid: 4242, executablePath: '/app/resources/intentd/intentd' });
    expect(getOrphanedSidecarInfo()).toEqual({
      pid: 4242,
      executablePath: '/app/resources/intentd/intentd',
    });
    __resetConnectionModeForTesting();
    expect(getOrphanedSidecarInfo()).toBeNull();
  });

  it('round-trips the local updateSupported capture and clears it on reset', () => {
    expect(getLocalUpdateSupported()).toBeNull();
    setLocalUpdateSupported(true);
    expect(getLocalUpdateSupported()).toBe(true);
    setLocalUpdateSupported(false);
    expect(getLocalUpdateSupported()).toBe(false);
    setLocalUpdateSupported(null);
    expect(getLocalUpdateSupported()).toBeNull();
    setLocalUpdateSupported(true);
    __resetConnectionModeForTesting();
    expect(getLocalUpdateSupported()).toBeNull();
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

  it('includes daemon version, build commit, and mismatch for external UDS', () => {
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.2.0',
      daemonBuildCommit: '0123456789abcdef',
      pinnedVersion: '0.1.0',
      versionMismatch: true,
    });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      daemonVersion: '0.2.0',
      daemonBuildCommit: '0123456789abcdef',
      versionMismatch: true,
    });
  });

  it('reports versionMismatch false for external UDS when versions match', () => {
    setConnectionMode('external');
    setDaemonVersionInfo({
      daemonVersion: '0.1.0',
      pinnedVersion: '0.1.0',
      versionMismatch: false,
    });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      daemonVersion: '0.1.0',
      versionMismatch: false,
    });
  });

  it('marks external UDS as orphaned sidecar when the classification is set (#2444)', () => {
    setConnectionMode('external');
    setOrphanedSidecarInfo({ pid: 4242, executablePath: '/app/resources/intentd/intentd' });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      isOrphanedSidecar: true,
    });
  });

  it('omits isOrphanedSidecar once the classification is cleared (#2444)', () => {
    setConnectionMode('external');
    setOrphanedSidecarInfo({ pid: 4242, executablePath: '/app/resources/intentd/intentd' });
    setOrphanedSidecarInfo(null);
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
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

  it('includes the captured updateSupported flag for external UDS (true and false)', () => {
    setConnectionMode('external');
    setLocalUpdateSupported(true);
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      updateSupported: true,
    });
    setLocalUpdateSupported(false);
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      updateSupported: false,
    });
  });

  it('omits updateSupported for external UDS while the capture is unknown (null)', () => {
    setConnectionMode('external');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
    });
  });

  it('omits updateSupported for sidecar UDS even when the flag is set', () => {
    setConnectionMode('sidecar');
    setLocalUpdateSupported(true);
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' })).toEqual({
      mode: 'sidecar-uds',
      target: '/tmp/i.sock',
    });
  });

  it('reports external-ws with a sanitized URL (strips userinfo + query)', () => {
    expect(
      formatTransportInfo({
        transport: 'ws',
        wsUrl: 'ws://user:secret@127.0.0.1:5181/ws?token=abc',
      }),
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

  it('includes pinnedVersion for sidecar-uds when a pin is injected', () => {
    setConnectionMode('sidecar');
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' }, '0.1.0')).toEqual({
      mode: 'sidecar-uds',
      target: '/tmp/i.sock',
      pinnedVersion: '0.1.0',
    });
  });

  it('includes pinnedVersion for external-uds alongside the version handshake fields', () => {
    setConnectionMode('external');
    setDaemonVersionInfo({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' }, '0.1.0')).toEqual({
      mode: 'external-uds',
      target: '/tmp/i.sock',
      daemonVersion: '0.2.0',
      versionMismatch: true,
      pinnedVersion: '0.1.0',
    });
  });

  it('includes pinnedVersion for external-ws (ws, wss, and the TCP stub)', () => {
    expect(
      formatTransportInfo({ transport: 'ws', wsUrl: 'ws://127.0.0.1:5181/ws' }, '0.1.0'),
    ).toEqual({ mode: 'external-ws', target: 'ws://127.0.0.1:5181/ws', pinnedVersion: '0.1.0' });
    expect(formatTransportInfo({ transport: 'wss', host: 'h', port: 443 }, '0.1.0')).toEqual({
      mode: 'external-ws',
      target: 'wss:h:443',
      pinnedVersion: '0.1.0',
    });
    expect(
      formatTransportInfo({ transport: 'tcp', host: '10.0.0.1', port: 6000 }, '0.1.0'),
    ).toEqual({ mode: 'external-ws', target: 'tcp:10.0.0.1:6000', pinnedVersion: '0.1.0' });
  });

  it('reports connectedVia for a remote wss backend (tunnel win vs direct win)', () => {
    const config = { transport: 'wss' as const, host: 'h', port: 443 };
    expect(formatTransportInfo(config, '0.1.0', 'tunnel')).toEqual({
      mode: 'external-ws',
      target: 'wss:h:443',
      connectedVia: 'tunnel',
      pinnedVersion: '0.1.0',
    });
    expect(formatTransportInfo(config, null, 'direct')).toEqual({
      mode: 'external-ws',
      target: 'wss:h:443',
      connectedVia: 'direct',
    });
  });

  it('omits connectedVia for wss when the race winner is unknown (single-host dial, disconnected)', () => {
    expect(formatTransportInfo({ transport: 'wss', host: 'h', port: 443 }, null, null)).toEqual({
      mode: 'external-ws',
      target: 'wss:h:443',
    });
    expect(
      formatTransportInfo({ transport: 'wss', host: 'h', port: 443 }, null, undefined),
    ).toEqual({ mode: 'external-ws', target: 'wss:h:443' });
  });

  it('never reports connectedVia for UDS, loopback ws, or the TCP stub', () => {
    setConnectionMode('external');
    expect(
      formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' }, null, 'tunnel'),
    ).not.toHaveProperty('connectedVia');
    setConnectionMode('sidecar');
    expect(
      formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' }, null, 'tunnel'),
    ).not.toHaveProperty('connectedVia');
    expect(
      formatTransportInfo({ transport: 'ws', wsUrl: 'ws://127.0.0.1:5181/ws' }, null, 'tunnel'),
    ).not.toHaveProperty('connectedVia');
    expect(
      formatTransportInfo({ transport: 'tcp', host: '10.0.0.1', port: 6000 }, null, 'tunnel'),
    ).not.toHaveProperty('connectedVia');
  });

  it('omits pinnedVersion when the pin is null (missing/malformed pin file)', () => {
    expect(formatTransportInfo({ transport: 'uds', socketPath: '/tmp/i.sock' }, null)).toEqual({
      mode: 'sidecar-uds',
      target: '/tmp/i.sock',
    });
  });
});

describe('computeDaemonVersionRefresh (#3448)', () => {
  const local = {
    isLocalBackend: true,
    transport: 'uds' as const,
    connectionMode: 'external' as const,
    pinnedVersion: '0.1.0',
    current: { daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false },
  };

  it('refreshes to the new server.version with a recomputed versionMismatch (daemon upgrade)', () => {
    expect(
      computeDaemonVersionRefresh({ ...local, helloResult: { server: { version: '0.2.0' } } }),
    ).toEqual({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
  });

  it('clears versionMismatch when the daemon comes back matching the pin', () => {
    expect(
      computeDaemonVersionRefresh({
        ...local,
        current: { daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true },
        helloResult: { server: { version: '0.1.0' } },
      }),
    ).toEqual({ daemonVersion: '0.1.0', pinnedVersion: '0.1.0', versionMismatch: false });
  });

  it('returns null for a remote backend hello (must not overwrite local info)', () => {
    expect(
      computeDaemonVersionRefresh({
        ...local,
        isLocalBackend: false,
        transport: 'wss',
        helloResult: { server: { version: '9.9.9' } },
      }),
    ).toBeNull();
  });

  it('returns null when the transport is not UDS or the mode is not external', () => {
    const hello = { helloResult: { server: { version: '0.2.0' } } };
    expect(computeDaemonVersionRefresh({ ...local, ...hello, transport: 'ws' })).toBeNull();
    expect(
      computeDaemonVersionRefresh({ ...local, ...hello, connectionMode: 'sidecar' }),
    ).toBeNull();
    expect(
      computeDaemonVersionRefresh({ ...local, ...hello, connectionMode: 'unknown' }),
    ).toBeNull();
  });

  it('returns null for a missing or malformed server.version (fail-safe)', () => {
    expect(computeDaemonVersionRefresh({ ...local, helloResult: undefined })).toBeNull();
    expect(computeDaemonVersionRefresh({ ...local, helloResult: null })).toBeNull();
    expect(computeDaemonVersionRefresh({ ...local, helloResult: {} })).toBeNull();
    expect(computeDaemonVersionRefresh({ ...local, helloResult: { server: {} } })).toBeNull();
    expect(
      computeDaemonVersionRefresh({ ...local, helloResult: { server: { version: 42 } } }),
    ).toBeNull();
    expect(
      computeDaemonVersionRefresh({ ...local, helloResult: { server: { version: '' } } }),
    ).toBeNull();
  });

  it('returns null when the recomputed info equals the stored info (no broadcast churn)', () => {
    expect(
      computeDaemonVersionRefresh({ ...local, helloResult: { server: { version: '0.1.0' } } }),
    ).toBeNull();
  });

  it('fills in version info when none is stored yet (current === null)', () => {
    expect(
      computeDaemonVersionRefresh({
        ...local,
        current: null,
        helloResult: { server: { version: '0.2.0' } },
      }),
    ).toEqual({ daemonVersion: '0.2.0', pinnedVersion: '0.1.0', versionMismatch: true });
  });

  it('reports versionMismatch false when the pin is null (comparison unknown)', () => {
    expect(
      computeDaemonVersionRefresh({
        ...local,
        pinnedVersion: null,
        current: null,
        helloResult: { server: { version: '0.2.0' } },
      }),
    ).toEqual({ daemonVersion: '0.2.0', pinnedVersion: null, versionMismatch: false });
  });

  it('reports versionMismatch false for an unparsable daemon version (comparison unknown)', () => {
    expect(
      computeDaemonVersionRefresh({
        ...local,
        current: null,
        helloResult: { server: { version: 'not-semver' } },
      }),
    ).toEqual({ daemonVersion: 'not-semver', pinnedVersion: '0.1.0', versionMismatch: false });
  });
});
