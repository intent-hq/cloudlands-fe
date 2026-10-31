/**
 * `backend:status` payload builder: one builder for every per-backend push, so
 * a new field reaches every site at once.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { DaemonStartupState } from '$shared/daemon-startup';
import {
  buildBackendStatusPayload,
  type BackendStatusPayload,
  type BackendStatusSource,
} from '../backend-status-payload';
import { __resetConnectionModeForTesting } from '../connection-mode';

afterEach(() => {
  __resetConnectionModeForTesting();
});

const STARTING: DaemonStartupState = { state: 'starting', snapshot: null, available: true };

function source(overrides: Partial<BackendStatusSource> = {}): BackendStatusSource {
  return {
    getStatus: () => 'connecting',
    getConfig: () => ({ transport: 'uds', socketPath: '/tmp/intentd.sock' }),
    getConnectedVia: () => null,
    getReconnectAttempts: () => 3,
    getStartupState: () => STARTING,
    isConnectionLimited: () => true,
    getConnectionLimitRetryAfterMs: () => 30_000,
    ...overrides,
  };
}

describe('buildBackendStatusPayload', () => {
  it('carries every per-backend field from the live client', () => {
    const payload = buildBackendStatusPayload(source(), {
      pinnedVersion: '1.2.3',
      updateMarker: { daemonUpdateDisconnectedAt: 1_000 },
    });
    expect(payload).toEqual({
      status: 'connecting',
      transport: { mode: 'sidecar-uds', target: '/tmp/intentd.sock', pinnedVersion: '1.2.3' },
      reconnectAttempts: 3,
      daemonStartup: STARTING,
      connectionLimited: true,
      connectionLimitRetryAfterMs: 30_000,
      daemonUpdateDisconnectedAt: 1_000,
    } satisfies BackendStatusPayload);
  });

  it('omits the update marker when the backend has none', () => {
    const payload = buildBackendStatusPayload(source(), { pinnedVersion: null, updateMarker: {} });
    expect(payload).not.toHaveProperty('daemonUpdateDisconnectedAt');
  });

  it('reports the event status over the client status and merges extras', () => {
    const payload = buildBackendStatusPayload(source({ getStatus: () => 'disconnected' }), {
      pinnedVersion: null,
      updateMarker: {},
      status: 'connected',
      extras: { reconnected: true },
    });
    expect(payload.status).toBe('connected');
    expect(payload.reconnected).toBe(true);
  });

  it('keeps sidecar markers and their reason', () => {
    const payload = buildBackendStatusPayload(source(), {
      pinnedVersion: null,
      updateMarker: {},
      extras: { sidecarGaveUp: true, reason: 'crash loop' },
    });
    expect(payload).toMatchObject({ sidecarGaveUp: true, reason: 'crash loop' });
  });

  it('defaults the per-backend getters a partial IPC test double omits', () => {
    const partial = {
      ...source(),
      getStartupState: undefined,
      isConnectionLimited: undefined,
      getConnectionLimitRetryAfterMs: undefined,
    } as unknown as BackendStatusSource;
    const payload = buildBackendStatusPayload(partial, { pinnedVersion: null, updateMarker: {} });
    expect(payload).toMatchObject({
      daemonStartup: null,
      connectionLimited: false,
      connectionLimitRetryAfterMs: null,
    });
  });
});
