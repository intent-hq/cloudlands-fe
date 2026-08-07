/**
 * Connections service tests — thunk→IPC wiring and push-event subscription.
 *
 * Asserts each thunk invokes its `connections:*` channel with the right params,
 * drives op-status through the slice, and that boot subscribes to the
 * `connections:changed` / `connections:cert-mismatch` pushes and folds them
 * into state. The Electron bridge is mocked via the mock IPC router.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerMockIpcHandler,
  mockInvoke,
  setMockIpcInvokeFallback,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import {
  CONNECTION_CHANNELS,
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  LOCAL_CONNECTION_ID,
} from '$shared/types/connections';
import type { ConnectionRecord, ConnectionCertMismatchEvent } from '$shared/types/connections';
import { store as appStore } from '$store/renderer/store';
import {
  loadConnections,
  captureFingerprint,
  addConnection,
  forgetConnection,
  switchConnection,
  disposeConnectionsService,
} from './connections-service';
import { certMismatchCleared } from '$store/renderer/slices/connections/connections-slice';

const LOCAL: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

const REMOTE: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

/** Captured push-event listeners registered via electronAPI.on. */
let eventHandlers: Map<string, (payload: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;

describe('connections-service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventHandlers = new Map();
    invoke = vi.fn((channel: string, ...args: unknown[]) => mockInvoke(channel, ...args));

    // Keep unrelated boot-time invokes (other middlewares) quiet.
    setMockIpcInvokeFallback(undefined);

    // Default connections handlers — individual tests override as needed.
    registerMockIpcHandler(CONNECTION_CHANNELS.LIST, async () => ({
      connections: [LOCAL],
      activeId: LOCAL_CONNECTION_ID,
    }));
    registerMockIpcHandler(CONNECTION_CHANNELS.CAPTURE_FINGERPRINT, async () => ({
      fingerprint: 'AB:CD',
    }));
    registerMockIpcHandler(CONNECTION_CHANNELS.ADD, async () => ({ connection: REMOTE }));
    registerMockIpcHandler(CONNECTION_CHANNELS.FORGET, async (arg) => ({
      id: (arg as { id: string }).id,
    }));
    registerMockIpcHandler(CONNECTION_CHANNELS.SWITCH, async (arg) => ({
      activeId: (arg as { id: string }).id,
    }));

    vi.stubGlobal('electronAPI', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(channel, handler);
        return `listener-${channel}`;
      }),
      off: vi.fn(),
    });

    appStore.init();
  });

  afterEach(() => {
    disposeConnectionsService();
    resetMockIpcRouter();
    appStore.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loadConnections invokes connections:list and stores the list + active id', async () => {
    registerMockIpcHandler(CONNECTION_CHANNELS.LIST, async () => ({
      connections: [LOCAL, REMOTE],
      activeId: 'remote-1',
    }));
    await loadConnections();
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.LIST);
    expect(appStore.state.connections.connections).toEqual([LOCAL, REMOTE]);
    expect(appStore.state.connections.activeId).toBe('remote-1');
  });

  it('captureFingerprint invokes the channel with host/port/token and returns the fingerprint', async () => {
    const params = { host: '10.0.0.5', port: 8443, token: 'secret' };
    const result = await captureFingerprint(params);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.CAPTURE_FINGERPRINT, params);
    expect(result).toEqual({ fingerprint: 'AB:CD' });
  });

  it('addConnection invokes connections:add, drives status idle→connecting→idle, returns the record', async () => {
    const params = {
      label: 'Studio Mac',
      host: '10.0.0.5',
      port: 8443,
      fingerprint: 'AB:CD',
      token: 'secret',
    };
    const record = await addConnection(params);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.ADD, params);
    expect(record).toEqual(REMOTE);
    expect(appStore.state.connections.status).toBe('idle');
    expect(appStore.state.connections.error).toBeNull();
  });

  it('addConnection records the error and rethrows on failure', async () => {
    registerMockIpcHandler(CONNECTION_CHANNELS.ADD, async () => {
      throw new Error('pairing rejected');
    });
    await expect(
      addConnection({ label: 'x', host: 'h', port: 1, fingerprint: 'f', token: 't' }),
    ).rejects.toThrow('pairing rejected');
    expect(appStore.state.connections.status).toBe('error');
    expect(appStore.state.connections.error).toBe('pairing rejected');
  });

  it('forgetConnection invokes connections:forget with the id', async () => {
    await forgetConnection('remote-1');
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.FORGET, { id: 'remote-1' });
  });

  it('switchConnection invokes connections:switch and drives status back to idle', async () => {
    await switchConnection('remote-1');
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.SWITCH, { id: 'remote-1' });
    expect(appStore.state.connections.status).toBe('idle');
  });

  it('switchConnection records the error and rethrows on failure', async () => {
    registerMockIpcHandler(CONNECTION_CHANNELS.SWITCH, async () => {
      throw new Error('no such connection');
    });
    await expect(switchConnection('nope')).rejects.toThrow('no such connection');
    expect(appStore.state.connections.status).toBe('error');
    expect(appStore.state.connections.error).toBe('no such connection');
  });

  describe('boot subscriptions', () => {
    it('subscribes to the changed + cert-mismatch pushes on first dispatch', () => {
      // A dispatch routes through the middleware, booting the service.
      appStore.dispatch(certMismatchCleared());
      expect(eventHandlers.has(CONNECTIONS_CHANGED_EVENT)).toBe(true);
      expect(eventHandlers.has(CONNECTION_CERT_MISMATCH_EVENT)).toBe(true);
    });

    it('folds a connections:changed push into the list + active id', () => {
      appStore.dispatch(certMismatchCleared());
      eventHandlers.get(CONNECTIONS_CHANGED_EVENT)!({
        connections: [LOCAL, REMOTE],
        activeId: 'remote-1',
      });
      expect(appStore.state.connections.connections).toEqual([LOCAL, REMOTE]);
      expect(appStore.state.connections.activeId).toBe('remote-1');
    });

    it('folds a connections:cert-mismatch push into the slice', () => {
      appStore.dispatch(certMismatchCleared());
      const event: ConnectionCertMismatchEvent = {
        id: 'remote-1',
        host: '10.0.0.5',
        port: 8443,
        expectedFingerprint: 'AB:CD',
        actualFingerprint: 'EF:01',
      };
      eventHandlers.get(CONNECTION_CERT_MISMATCH_EVENT)!(event);
      expect(appStore.state.connections.certMismatch).toEqual(event);
    });
  });
});
