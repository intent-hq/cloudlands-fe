import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The update saga lazy-imports svelte-sonner for its outcome toasts.
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('svelte-sonner', () => ({ toast }));

import {
  CONNECTION_CHANNELS,
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_AUTH_REJECTED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  CONNECTION_CERT_WARNINGS_EVENT,
  CONNECTION_PROTOCOL_MISMATCH_EVENT,
  KEYCHAIN_SYNC_STATUS_EVENT,
  LOCAL_CONNECTION_ID,
} from '$shared/types/connections';
import type { ConnectionRecord } from '$shared/types/connections';
import {
  addConnectionRequested,
  captureFingerprintRequested,
  connectionsReducer,
  forgetConnectionRequested,
  initialState,
  loadKeychainSyncStateRequested,
  openConnectionRequested,
  rotateConnectionSecretRequested,
  setKeychainSyncEnabledRequested,
  testConnectionRequested,
  updateConnectionRequested,
  updateBackendRequested,
} from '../connections-slice';
import { connectionsSaga } from './connections-saga';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';

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
  accent: 'blue',
  host: '10.0.0.5',
  port: 8443,
  fingerprint: 'AB:CD',
  isLocal: false,
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

let callbacks: Record<string, (payload: unknown) => void>;
let invoke: ReturnType<typeof vi.fn>;
let offById: ReturnType<typeof vi.fn>;

function start() {
  const channel = stdChannel();
  const dispatched: any[] = [];
  let state = { connections: initialState };
  const dispatch = (action: any) => {
    dispatched.push(action);
    state = { connections: connectionsReducer(state.connections, action) };
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, connectionsSaga);
  return { channel, dispatched, getState: () => state, task };
}

describe('connectionsSaga', () => {
  beforeEach(() => {
    callbacks = {};
    toast.success.mockClear();
    toast.info.mockClear();
    toast.error.mockClear();
    toast.warning.mockClear();
    toast.dismiss.mockClear();
    invoke = vi.fn(async (channel: string, params?: unknown) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return {
          connections: [LOCAL],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        };
      if (channel === CONNECTION_CHANNELS.CAPTURE_FINGERPRINT)
        return { fingerprint: 'AB:CD', tokenValid: true };
      if (channel === CONNECTION_CHANNELS.ADD) return { connection: REMOTE, switched: false };
      if (channel === CONNECTION_CHANNELS.UPDATE)
        return { status: 'updated', connection: { ...REMOTE, ...(params as object) } };
      if (channel === CONNECTION_CHANNELS.TEST)
        return { status: 'success', fingerprint: REMOTE.fingerprint };
      if (channel === CONNECTION_CHANNELS.ROTATE_SECRET)
        return { status: 'updated', connection: REMOTE };
      if (channel === CONNECTION_CHANNELS.OPEN)
        return { status: 'opened', id: (params as { id: string }).id };
      if (channel === CONNECTION_CHANNELS.FORGET) return { id: (params as { id: string }).id };
      throw new Error(`unexpected channel ${channel}`);
    });
    offById = vi.fn();
    vi.stubGlobal('electronAPI', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        callbacks[channel] = handler;
        return `listener-${channel}`;
      }),
      offById,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('hydrates the initial list, replays sticky mismatch, and preserves the exact list request', async () => {
    const mismatch = {
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2',
    };
    invoke.mockImplementation(async (channel: string) =>
      channel === CONNECTION_CHANNELS.LIST
        ? {
            connections: [LOCAL, REMOTE],
            activeId: LOCAL.id,
            windowBackendId: REMOTE.id,
            protocolMismatch: mismatch,
          }
        : { fingerprint: 'AB:CD' },
    );
    const run = start();
    await settle();

    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.LIST);
    expect(getItems(run.getState().connections.connections)).toEqual([LOCAL, REMOTE]);
    expect(run.getState().connections.activeId).toBe(LOCAL.id);
    expect(run.getState().connections.windowBackendId).toBe(REMOTE.id);
    expect(run.getState().connections.protocolMismatch).toEqual(mismatch);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('boot-origin replay latches the mismatch with the modal suppressed', async () => {
    const mismatch = {
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2',
      origin: 'boot',
    };
    invoke.mockImplementation(async (channel: string) =>
      channel === CONNECTION_CHANNELS.LIST
        ? {
            connections: [LOCAL, REMOTE],
            activeId: REMOTE.id,
            windowBackendId: REMOTE.id,
            protocolMismatch: mismatch,
          }
        : { fingerprint: 'AB:CD' },
    );
    const run = start();
    await settle();

    // Origin carried through the replay: menu warning state latched, modal
    // pre-dismissed (boot restore is not modal-worthy).
    expect(run.getState().connections.protocolMismatch).toEqual(mismatch);
    expect(run.getState().connections.protocolMismatchModalDismissed).toBe(true);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('passes through token-free saved-secret guidance for an exact test request', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return {
          connections: [LOCAL, REMOTE],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        };
      if (channel === CONNECTION_CHANNELS.TEST) return { status: 'secret-unavailable' };
      throw new Error(`unexpected channel ${channel}`);
    });
    const run = start();
    await settle();
    const params = { id: REMOTE.id, host: '10.0.0.99', port: 9443 };
    const action = testConnectionRequested(params);

    run.channel.put(action);

    await expect(action.promise).resolves.toEqual({ status: 'secret-unavailable' });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.TEST, params);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('replays a sticky auth rejection from the initial list fetch', async () => {
    const authRejected = { id: 'remote-1', host: '10.0.0.5', port: 8443, statusCode: 401 };
    invoke.mockImplementation(async (channel: string) =>
      channel === CONNECTION_CHANNELS.LIST
        ? {
            connections: [LOCAL, REMOTE],
            activeId: REMOTE.id,
            windowBackendId: REMOTE.id,
            authRejected,
          }
        : { fingerprint: 'AB:CD' },
    );
    const run = start();
    await settle();

    expect(run.getState().connections.authRejected).toEqual(authRejected);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('replays a sticky cert mismatch from the initial list fetch', async () => {
    // Boot-wide restore: the pooled client's mismatch fired before this window
    // existed, so the one-shot push was lost — the initial list replays it and
    // the blocking trust modal still shows.
    const certMismatch = {
      id: 'remote-1',
      host: '10.0.0.5',
      port: 8443,
      expectedFingerprint: 'AA:BB',
      actualFingerprint: 'EE:FF',
    };
    invoke.mockImplementation(async (channel: string) =>
      channel === CONNECTION_CHANNELS.LIST
        ? {
            connections: [LOCAL, REMOTE],
            activeId: REMOTE.id,
            windowBackendId: REMOTE.id,
            certMismatch,
          }
        : { fingerprint: 'AB:CD' },
    );
    const run = start();
    await settle();

    expect(run.getState().connections.certMismatch).toEqual(certMismatch);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('sends exact command payloads and settles each awaitable action with contract responses', async () => {
    const run = start();
    await settle();

    const capture = captureFingerprintRequested({
      host: REMOTE.host!,
      port: REMOTE.port!,
      token: 'secret',
    });
    run.channel.put(capture);
    await expect(capture.promise).resolves.toEqual({ fingerprint: 'AB:CD', tokenValid: true });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.CAPTURE_FINGERPRINT, {
      host: REMOTE.host,
      port: REMOTE.port,
      token: 'secret',
    });

    const add = addConnectionRequested({
      label: REMOTE.label,
      host: REMOTE.host!,
      port: REMOTE.port!,
      fingerprint: REMOTE.fingerprint!,
      token: 'secret',
    });
    run.channel.put(add);
    await expect(add.promise).resolves.toEqual({ connection: REMOTE, switched: false });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.ADD, {
      label: REMOTE.label,
      host: REMOTE.host,
      port: REMOTE.port,
      fingerprint: REMOTE.fingerprint,
      token: 'secret',
    });

    const update = updateConnectionRequested({
      id: REMOTE.id,
      label: 'Editing Mac',
      accent: null,
    });
    run.channel.put(update);
    await expect(update.promise).resolves.toEqual({
      status: 'updated',
      connection: { ...REMOTE, id: REMOTE.id, label: 'Editing Mac', accent: null },
    });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE, {
      id: REMOTE.id,
      label: 'Editing Mac',
      accent: null,
    });

    const test = testConnectionRequested({ id: REMOTE.id, host: '10.0.0.99', port: 9443 });
    run.channel.put(test);
    await expect(test.promise).resolves.toEqual({
      status: 'success',
      fingerprint: REMOTE.fingerprint,
    });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.TEST, {
      id: REMOTE.id,
      host: '10.0.0.99',
      port: 9443,
    });

    const rotate = rotateConnectionSecretRequested({ id: REMOTE.id, token: 'replacement' });
    run.channel.put(rotate);
    await expect(rotate.promise).resolves.toEqual({ status: 'updated', connection: REMOTE });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.ROTATE_SECRET, {
      id: REMOTE.id,
      token: 'replacement',
    });

    const open = openConnectionRequested(REMOTE.id);
    run.channel.put(open);
    await expect(open.promise).resolves.toEqual({ status: 'opened', id: REMOTE.id });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.OPEN, { id: REMOTE.id });

    const forget = forgetConnectionRequested(REMOTE.id);
    run.channel.put(forget);
    await expect(forget.promise).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.FORGET, { id: REMOTE.id });
    expect(run.getState().connections.status).toBe('idle');

    run.task.cancel();
    await run.task.toPromise();
  });

  it('settles concurrent update, test, and secret-rotation actions independently', async () => {
    const releases = new Map<string, (value: unknown) => void>();
    const results: Record<string, unknown> = {
      [CONNECTION_CHANNELS.UPDATE]: { status: 'updated', connection: REMOTE },
      [CONNECTION_CHANNELS.TEST]: { status: 'success', fingerprint: REMOTE.fingerprint },
      [CONNECTION_CHANNELS.ROTATE_SECRET]: { status: 'updated', connection: REMOTE },
    };
    invoke.mockImplementation(async (channel: string, params?: unknown) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if ((params as { id?: string } | undefined)?.id === 'remote-pending') {
        return new Promise((resolve) => releases.set(channel, resolve));
      }
      return results[channel];
    });
    const run = start();
    await settle();

    const pairs = [
      [
        CONNECTION_CHANNELS.UPDATE,
        updateConnectionRequested({ id: 'remote-pending', label: 'Pending', accent: 'blue' }),
        updateConnectionRequested({ id: 'remote-second', label: 'Second', accent: 'violet' }),
      ],
      [
        CONNECTION_CHANNELS.TEST,
        testConnectionRequested({ id: 'remote-pending', host: 'pending.local', port: 5181 }),
        testConnectionRequested({ id: 'remote-second', host: 'second.local', port: 5181 }),
      ],
      [
        CONNECTION_CHANNELS.ROTATE_SECRET,
        rotateConnectionSecretRequested({ id: 'remote-pending', token: 'pending' }),
        rotateConnectionSecretRequested({ id: 'remote-second', token: 'second' }),
      ],
    ] as const;

    for (const [channel, first, second] of pairs) {
      run.channel.put(first);
      await vi.waitFor(() => expect(releases.has(channel)).toBe(true));
      run.channel.put(second);
      await expect(second.promise).resolves.toEqual(results[channel]);
      releases.get(channel)!(results[channel]);
      await expect(first.promise).resolves.toEqual(results[channel]);
    }

    run.task.cancel();
    await run.task.toPromise();
  });

  it('passes through token-free open guidance without leaking an IPC exception', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return {
          connections: [LOCAL, REMOTE],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        };
      if (channel === CONNECTION_CHANNELS.OPEN) return { status: 'secret-unavailable' };
      throw new Error(`unexpected channel ${channel}`);
    });
    const run = start();
    await settle();
    const action = openConnectionRequested(REMOTE.id);

    run.channel.put(action);

    await expect(action.promise).resolves.toEqual({ status: 'secret-unavailable' });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.OPEN, { id: REMOTE.id });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('folds all push events and removes every listener on cancellation', async () => {
    const run = start();
    await settle();
    expect(Object.keys(callbacks).sort()).toEqual([
      CONNECTION_AUTH_REJECTED_EVENT,
      CONNECTION_CERT_MISMATCH_EVENT,
      CONNECTION_CERT_WARNINGS_EVENT,
      CONNECTIONS_CHANGED_EVENT,
      CONNECTION_PROTOCOL_MISMATCH_EVENT,
      KEYCHAIN_SYNC_STATUS_EVENT,
    ]);

    callbacks[CONNECTIONS_CHANGED_EVENT]!({
      connections: [LOCAL, REMOTE],
      activeId: LOCAL.id,
      windowBackendId: REMOTE.id,
    });
    callbacks[CONNECTION_CERT_MISMATCH_EVENT]!({
      id: REMOTE.id,
      host: REMOTE.host,
      port: REMOTE.port,
      expectedFingerprint: 'AB:CD',
      actualFingerprint: 'EF:01',
    });
    callbacks[CONNECTION_PROTOCOL_MISMATCH_EVENT]!({
      id: REMOTE.id,
      host: REMOTE.host,
      port: REMOTE.port,
      localProtocolVersion: '1',
      remoteProtocolVersion: '2',
    });
    callbacks[CONNECTION_AUTH_REJECTED_EVENT]!({
      id: REMOTE.id,
      host: REMOTE.host,
      port: REMOTE.port,
      statusCode: 401,
    });
    callbacks[CONNECTION_CERT_WARNINGS_EVENT]!({
      id: REMOTE.id,
      warnings: [{ host: '10.0.0.6', expectedFingerprint: 'AB:CD', actualFingerprint: 'EF:01' }],
    });
    await settle();

    expect(getItems(run.getState().connections.connections)).toEqual([LOCAL, REMOTE]);
    expect(run.getState().connections.activeId).toBe(LOCAL.id);
    expect(run.getState().connections.windowBackendId).toBe(REMOTE.id);
    expect(run.getState().connections.certMismatch?.actualFingerprint).toBe('EF:01');
    expect(run.getState().connections.protocolMismatch?.remoteProtocolVersion).toBe('2');
    expect(run.getState().connections.authRejected).toEqual({
      id: REMOTE.id,
      host: REMOTE.host,
      port: REMOTE.port,
      statusCode: 401,
    });
    expect(getItems(run.getState().connections.certWarnings[REMOTE.id])).toEqual([
      { host: '10.0.0.6', expectedFingerprint: 'AB:CD', actualFingerprint: 'EF:01' },
    ]);

    run.task.cancel();
    await run.task.toPromise();
    expect(offById.mock.calls).toEqual([
      [CONNECTIONS_CHANGED_EVENT, `listener-${CONNECTIONS_CHANGED_EVENT}`],
      [CONNECTION_CERT_MISMATCH_EVENT, `listener-${CONNECTION_CERT_MISMATCH_EVENT}`],
      [CONNECTION_CERT_WARNINGS_EVENT, `listener-${CONNECTION_CERT_WARNINGS_EVENT}`],
      [CONNECTION_PROTOCOL_MISMATCH_EVENT, `listener-${CONNECTION_PROTOCOL_MISMATCH_EVENT}`],
      [CONNECTION_AUTH_REJECTED_EVENT, `listener-${CONNECTION_AUTH_REJECTED_EVENT}`],
      [KEYCHAIN_SYNC_STATUS_EVENT, `listener-${KEYCHAIN_SYNC_STATUS_EVENT}`],
    ]);
  });

  it('rejects a failed operation and records its status error', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.OPEN) throw new Error('no such connection');
      return {};
    });
    const run = start();
    await settle();
    const action = openConnectionRequested('missing');
    run.channel.put(action);
    await expect(action.promise).rejects.toThrow('no such connection');
    expect(run.getState().connections.status).toBe('error');
    expect(run.getState().connections.error).toBe('no such connection');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('takes only the leading same-action request while other action owners remain independent', async () => {
    let resolveAdd: ((value: { connection: ConnectionRecord }) => void) | undefined;
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.ADD)
        return await new Promise<{ connection: ConnectionRecord }>((resolve) => {
          resolveAdd = resolve;
        });
      if (channel === CONNECTION_CHANNELS.CAPTURE_FINGERPRINT) return { fingerprint: 'AB:CD' };
      return {};
    });
    const run = start();
    await settle();

    const first = addConnectionRequested({
      label: REMOTE.label,
      host: REMOTE.host!,
      port: REMOTE.port!,
      fingerprint: REMOTE.fingerprint!,
      token: 'secret',
    });
    const ignored = addConnectionRequested({
      label: 'ignored',
      host: REMOTE.host!,
      port: REMOTE.port!,
      fingerprint: REMOTE.fingerprint!,
      token: 'secret',
    });
    run.channel.put(first);
    await settle();
    run.channel.put(ignored);

    const capture = captureFingerprintRequested({ host: REMOTE.host!, port: REMOTE.port! });
    run.channel.put(capture);
    await expect(capture.promise).resolves.toEqual({ fingerprint: 'AB:CD' });
    expect(
      invoke.mock.calls.filter(([channel]) => channel === CONNECTION_CHANNELS.ADD),
    ).toHaveLength(1);

    resolveAdd?.({ connection: REMOTE });
    await expect(first.promise).resolves.toEqual({ connection: REMOTE });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rejects an active awaitable request when the root saga is cancelled', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.OPEN) return await new Promise(() => {});
      return {};
    });
    const run = start();
    await settle();
    const action = openConnectionRequested(REMOTE.id);
    run.channel.put(action);
    await settle();

    run.task.cancel();
    await run.task.toPromise();
    await expect(action.promise).rejects.toThrow('Connection open was cancelled');
    expect(run.getState().connections.error).toBe('Connection open was cancelled');
  });

  it('loads the keychain-sync state and stores it (T4)', async () => {
    const syncState = { supported: true, enabled: false, status: null };
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.SYNC_GET_STATE) return syncState;
      return {};
    });
    const run = start();
    await settle();

    const action = loadKeychainSyncStateRequested();
    run.channel.put(action);
    await expect(action.promise).resolves.toEqual(syncState);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.SYNC_GET_STATE);
    expect(run.getState().connections.keychainSync).toEqual(syncState);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('sets the keychain-sync pref with the exact wire params and stores the result (T4)', async () => {
    const syncState = { supported: true, enabled: true, status: { state: 'active' } };
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.SYNC_SET_ENABLED) return syncState;
      return {};
    });
    const run = start();
    await settle();

    const action = setKeychainSyncEnabledRequested(true);
    run.channel.put(action);
    await expect(action.promise).resolves.toEqual(syncState);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.SYNC_SET_ENABLED, { enabled: true });
    expect(run.getState().connections.keychainSync).toEqual(syncState);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('folds a sync-status push into an already-loaded sync state (T4)', async () => {
    const syncState = { supported: true, enabled: true, status: { state: 'active' } };
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.SYNC_GET_STATE) return syncState;
      return {};
    });
    const run = start();
    await settle();

    const load = loadKeychainSyncStateRequested();
    run.channel.put(load);
    await load.promise;

    const status = { state: 'unavailable', reason: 'unavailable', message: 'keychain locked' };
    callbacks[KEYCHAIN_SYNC_STATUS_EVENT]!(status);
    await settle();

    expect(run.getState().connections.keychainSync).toEqual({
      supported: true,
      enabled: true,
      status,
    });

    run.task.cancel();
    await run.task.toPromise();
  });

  it('requests a backend update and toasts success', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) return { ok: true, version: '0.10.0' };
      return {};
    });
    const run = start();
    await settle();

    const action = updateBackendRequested('remote-1');
    run.channel.put(action);
    await expect(action.promise).resolves.toEqual({ ok: true, version: '0.10.0' });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE_BACKEND, { id: 'remote-1' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    run.task.cancel();
    await run.task.toPromise();
  });

  it('handles concurrent updates to different backends (takeEvery, not takeLeading)', async () => {
    // The first backend's RPC stays pending until we release it; the second
    // action arrives while the first is in flight and must not be dropped.
    let releaseFirst!: (value: { ok: true; version: '0.10.0' }) => void;
    const firstResult = new Promise<{ ok: true; version: '0.10.0' }>((resolve) => {
      releaseFirst = resolve;
    });
    invoke.mockImplementation(async (channel: string, params?: unknown) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) {
        return (params as { id: string }).id === 'remote-1'
          ? firstResult
          : { ok: true, version: '0.10.0' };
      }
      return {};
    });
    const run = start();
    await settle();

    const first = updateBackendRequested('remote-1');
    const second = updateBackendRequested('remote-2');
    run.channel.put(first);
    run.channel.put(second);
    // The second settles while the first is still awaiting its RPC.
    await expect(second.promise).resolves.toEqual({ ok: true, version: '0.10.0' });
    releaseFirst({ ok: true, version: '0.10.0' });
    await expect(first.promise).resolves.toEqual({ ok: true, version: '0.10.0' });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE_BACKEND, { id: 'remote-1' });
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE_BACKEND, { id: 'remote-2' });
    expect(toast.success).toHaveBeenCalledTimes(2);

    run.task.cancel();
    await run.task.toPromise();
  });

  it('shows progress rather than success while main is verifying the restart, and cleans up on cancellation', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === CONNECTION_CHANNELS.UPDATE_BACKEND
        ? new Promise(() => {})
        : { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id },
    );
    const run = start();
    await settle();
    const action = updateBackendRequested('remote-1');
    const rejected = expect(action.promise).rejects.toThrow('cancelled');
    run.channel.put(action);
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
    run.task.cancel();
    await run.task.toPromise();
    await rejected;
    expect(toast.dismiss).toHaveBeenCalledWith('connections-update-remote-1');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(['invalid-pin', 'invalid-ack', 'timeout', 'busy', 'version-mismatch'])(
    'never announces completion for %s',
    async (reason) => {
      invoke.mockImplementation(async (channel: string) =>
        channel === CONNECTION_CHANNELS.UPDATE_BACKEND
          ? { ok: false, reason, version: '0.10.0', actualVersion: '0.11.0' }
          : { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id },
      );
      const run = start();
      await settle();
      const action = updateBackendRequested('remote-1');
      run.channel.put(action);
      await expect(action.promise).resolves.toMatchObject({ ok: false, reason });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.success).not.toHaveBeenCalled();
      run.task.cancel();
      await run.task.toPromise();
    },
  );

  it('toasts a specific error per structured update failure and resolves the action', async () => {
    const results: Array<{ ok: false; reason: string; message?: string }> = [
      { ok: false, reason: 'unsupported' },
      { ok: false, reason: 'not-connected' },
      { ok: false, reason: 'failed', message: 'daemon is not sitter-supervised' },
    ];
    let index = 0;
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) return results[index++];
      return {};
    });
    const run = start();
    await settle();

    for (const expected of results) {
      const action = updateBackendRequested('remote-1');
      run.channel.put(action);
      // A structured failure resolves (no throw) — the toast carries the news.
      await expect(action.promise).resolves.toEqual(expected);
    }
    expect(toast.error).toHaveBeenCalledTimes(3);
    // The daemon's message is embedded in the failed-toast text.
    expect(String(toast.error.mock.calls[2]![0])).toContain('daemon is not sitter-supervised');
    expect(toast.success).not.toHaveBeenCalled();

    run.task.cancel();
    await run.task.toPromise();
  });

  it('rejects the update action and toasts on an IPC-level failure', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL, REMOTE], activeId: LOCAL.id, windowBackendId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) throw new Error('bridge unavailable');
      return {};
    });
    const run = start();
    await settle();

    const action = updateBackendRequested('remote-1');
    run.channel.put(action);
    await expect(action.promise).rejects.toThrow('bridge unavailable');
    expect(toast.error).toHaveBeenCalledTimes(1);

    run.task.cancel();
    await run.task.toPromise();
  });

  describe('daemon-behind-pin toast on connect', () => {
    const BEHIND = {
      ...REMOTE,
      daemonVersion: '0.9.0',
      updateSupported: true,
      exactVersionUpdateSupported: true,
    };
    // The toast is scoped to the window's own backend, so the simulated
    // window is bound to the behind remote unless a test overrides it.
    const changed = (
      connections: ConnectionRecord[],
      connectedIds: string[],
      pinnedVersion?: string,
      windowBackendId: string = BEHIND.id,
    ) =>
      callbacks[CONNECTIONS_CHANGED_EVENT]!({
        connections,
        activeId: LOCAL.id,
        windowBackendId,
        connectedIds,
        ...(pinnedVersion !== undefined ? { pinnedVersion } : {}),
      });

    it('offers manual guidance for a legacy sitter, then enables Update on a live exact capability refresh', async () => {
      const run = start();
      await settle();
      changed([LOCAL, { ...BEHIND, exactVersionUpdateSupported: false }], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      expect(toast.warning.mock.calls[0][1].action).toBeUndefined();
      expect(toast.warning.mock.calls[0][1].description).toEqual(expect.any(String));
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(2));
      expect(toast.warning.mock.calls[1][1].action.onClick).toEqual(expect.any(Function));
      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts once on the transition to connected, not on re-broadcasts', async () => {
      const run = start();
      await settle();

      // v-prefixed reported versions must not double the template's own "v".
      const vBehind = { ...BEHIND, daemonVersion: 'v0.9.0' };
      changed([LOCAL, vBehind], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      const [message, options] = toast.warning.mock.calls[0]!;
      expect(String(message)).toContain('Studio Mac');
      expect(String(message)).toContain('v0.9.0');
      expect(String(message)).toContain('v0.10.0');
      expect(String(message)).not.toContain('vv');
      expect(options.id).toBe(`connections-daemon-behind-${BEHIND.id}`);
      // Sticky: never auto-dismisses — dismissal is programmatic.
      expect(options.duration).toBe(Number.POSITIVE_INFINITY);
      expect(options.action.label).toEqual(expect.any(String));

      // Same connected pool re-broadcast: no second toast, and the sticky
      // toast still applies — no dismissal either.
      changed([LOCAL, vBehind], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).toHaveBeenCalledTimes(1);
      expect(toast.dismiss).not.toHaveBeenCalled();

      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts again after a disconnect/reconnect cycle', async () => {
      const run = start();
      await settle();

      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      changed([LOCAL, BEHIND], [], '0.10.0');
      await settle();
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(2));

      run.task.cancel();
      await run.task.toPromise();
    });

    it('dismisses the sticky toast when the tracked backend disconnects', async () => {
      const run = start();
      await settle();

      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      expect(toast.dismiss).not.toHaveBeenCalled();

      changed([LOCAL, BEHIND], [], '0.10.0');
      await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledTimes(1));
      expect(toast.dismiss).toHaveBeenCalledWith(`connections-daemon-behind-${BEHIND.id}`);

      // The toast was already dismissed: a further disconnected re-broadcast
      // must not dismiss again.
      changed([LOCAL, BEHIND], [], '0.10.0');
      await settle();
      expect(toast.dismiss).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('dismisses the sticky toast when the daemon comes back at/above the pin', async () => {
      const run = start();
      await settle();

      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      // The version refresh (e.g. after a successful update) re-evaluates the
      // still-connected backend as no longer behind the pin.
      changed([LOCAL, { ...BEHIND, daemonVersion: '0.10.0' }], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledTimes(1));
      expect(toast.dismiss).toHaveBeenCalledWith(`connections-daemon-behind-${BEHIND.id}`);
      expect(toast.warning).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('keeps the sticky toast through inconclusive re-broadcasts while connected', async () => {
      const run = start();
      await settle();

      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      // Still connected, but the broadcast lost its verdict inputs (e.g. a
      // refresh raced the fire-and-forget captures): no daemonVersion, no
      // pinnedVersion, no updateSupported. None of these may dismiss.
      changed([LOCAL, { ...BEHIND, daemonVersion: undefined }], [BEHIND.id], '0.10.0');
      await settle();
      changed([LOCAL, BEHIND], [BEHIND.id], undefined);
      await settle();
      changed([LOCAL, { ...BEHIND, updateSupported: undefined }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.dismiss).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledTimes(1);

      // A later conclusive verdict (back at the pin) still dismisses.
      changed([LOCAL, { ...BEHIND, daemonVersion: '0.10.0' }], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.dismiss).toHaveBeenCalledTimes(1));
      expect(toast.dismiss).toHaveBeenCalledWith(`connections-daemon-behind-${BEHIND.id}`);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('never dismisses when no toast was raised', async () => {
      const run = start();
      await settle();

      // Evaluated but suppressed (updateSupported: false): no toast raised,
      // so its disconnect must not fire a spurious dismiss.
      changed([LOCAL, { ...BEHIND, updateSupported: false }], [BEHIND.id], '0.10.0');
      await settle();
      changed([LOCAL, { ...BEHIND, updateSupported: false }], [], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.dismiss).not.toHaveBeenCalled();

      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts on the version-bearing follow-up when the connect broadcast precedes the capture', async () => {
      const run = start();
      await settle();

      // The fire-and-forget daemonVersion capture hasn't landed yet: the
      // first 'connected' broadcast carries no version — inconclusive, so the
      // id must NOT count as evaluated.
      changed([LOCAL, { ...BEHIND, daemonVersion: null }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // The capture's write/broadcast arrives: still counts as the transition.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      // Unchanged re-broadcast after the conclusive one: silent.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('never toasts a behind daemon that reports updateSupported: false', async () => {
      const run = start();
      await settle();

      changed([LOCAL, { ...BEHIND, updateSupported: false }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // Re-broadcasts of the same conclusive state stay silent too.
      changed([LOCAL, { ...BEHIND, updateSupported: false }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts when the flag refreshes false→true at an unchanged daemonVersion', async () => {
      const run = start();
      await settle();

      // A stale/conclusive false is evaluated but suppressed.
      changed([LOCAL, { ...BEHIND, updateSupported: false }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // The fire-and-forget capture then flips the flag with the SAME
      // daemonVersion: the refresh must re-evaluate and toast exactly once.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      // Unchanged re-broadcast after the toast: silent.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts on the flag-bearing follow-up when the connect broadcast precedes the updateSupported capture', async () => {
      const run = start();
      await settle();

      // The fire-and-forget updateSupported capture hasn't landed yet:
      // unknown is inconclusive, so the id must NOT count as evaluated.
      changed([LOCAL, { ...BEHIND, updateSupported: null }], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // The capture's write/broadcast arrives: still counts as the transition.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      run.task.cancel();
      await run.task.toPromise();
    });

    it('announces an already-connected behind backend once at startup hydration', async () => {
      invoke.mockImplementation(async (channel: string) => {
        if (channel === CONNECTION_CHANNELS.LIST)
          return {
            connections: [LOCAL, BEHIND],
            activeId: LOCAL.id,
            windowBackendId: BEHIND.id,
            connectedIds: [BEHIND.id],
            pinnedVersion: '0.10.0',
          };
        return {};
      });
      const run = start();
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));

      // The first post-hydration broadcast of the same pool stays silent —
      // the hydration announcement seeded the tracker.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await settle();
      expect(toast.warning).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('stays silent for equal/newer/unknown versions, missing pin, local sidecar, and not-connected', async () => {
      const run = start();
      await settle();

      const equal = { ...BEHIND, id: 'remote-eq', daemonVersion: '0.10.0' };
      const newer = { ...BEHIND, id: 'remote-new', daemonVersion: '0.11.0' };
      const unknown = { ...BEHIND, id: 'remote-unk', daemonVersion: null };
      const notConnected = { ...BEHIND, id: 'remote-off', daemonVersion: '0.9.0' };
      const pool = [LOCAL, equal, newer, unknown, notConnected];
      const connectedIds = [equal.id, newer.id, unknown.id];
      // One broadcast per window-backend binding: each candidate is evaluated
      // as the window's own backend and must still stay silent.
      for (const own of [LOCAL.id, equal.id, newer.id, unknown.id, notConnected.id]) {
        changed(pool, connectedIds, '0.10.0', own);
      }
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // Behind but no pinned version reported: silent.
      changed([LOCAL, BEHIND], [BEHIND.id]);
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      run.task.cancel();
      await run.task.toPromise();
    });

    it("never toasts a behind daemon that is not the window's own backend", async () => {
      const run = start();
      await settle();

      // Window bound to the local backend: another backend's behind daemon
      // is not this window's to announce.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0', LOCAL.id);
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // Window bound to a different remote: same silence.
      const other = { ...REMOTE, id: 'remote-2', daemonVersion: '0.10.0' };
      changed([LOCAL, BEHIND, other], [BEHIND.id, other.id], '0.10.0', other.id);
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // The skipped backend was never marked evaluated: the window that owns
      // it still announces on its own broadcast.
      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0', BEHIND.id);
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      expect(toast.warning.mock.calls[0]![1].id).toBe(`connections-daemon-behind-${BEHIND.id}`);

      run.task.cancel();
      await run.task.toPromise();
    });

    it('dispatches updateBackendRequested for the right id when Update is clicked', async () => {
      invoke.mockImplementation(async (channel: string) => {
        if (channel === CONNECTION_CHANNELS.LIST)
          return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
        if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) return { ok: true, version: '0.10.0' };
        return {};
      });
      const run = start();
      await settle();

      changed([LOCAL, BEHIND], [BEHIND.id], '0.10.0');
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      const [, options] = toast.warning.mock.calls[0]!;
      options.action.onClick();
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE_BACKEND, {
          id: BEHIND.id,
        }),
      );
      // The outcome surfaces via the existing per-result update toast.
      await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

      run.task.cancel();
      await run.task.toPromise();
    });

    it('toasts the local entry once its adopted external daemon is captured behind the pin', async () => {
      const run = start();
      await settle();

      // Sidecar-shaped local record (no captured version/flag): inconclusive,
      // silent, and not marked evaluated.
      changed([LOCAL], [LOCAL.id], '0.10.0', LOCAL.id);
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      // The external-daemon capture enriches the local record: toast once.
      const localExternal = {
        ...LOCAL,
        daemonVersion: '0.9.0',
        updateSupported: true,
        exactVersionUpdateSupported: true,
      };
      changed([localExternal], [LOCAL.id], '0.10.0', LOCAL.id);
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      const [message, options] = toast.warning.mock.calls[0]!;
      expect(String(message)).toContain('This machine (local)');
      expect(String(message)).toContain('v0.9.0');
      expect(String(message)).toContain('v0.10.0');
      expect(options.id).toBe(`connections-daemon-behind-${LOCAL.id}`);

      // Unchanged re-broadcast: silent.
      changed([localExternal], [LOCAL.id], '0.10.0', LOCAL.id);
      await settle();
      expect(toast.warning).toHaveBeenCalledTimes(1);

      run.task.cancel();
      await run.task.toPromise();
    });

    it("names the local entry's toast via the localized label, not the persisted fallback", async () => {
      const run = start();
      await settle();

      // The main-process record's `label` is an untranslated English
      // fallback — the toast must use the localized message instead (same as
      // DeviceRow), so a divergent persisted label never leaks through.
      const localExternal = {
        ...LOCAL,
        label: 'persisted-fallback-label',
        daemonVersion: '0.9.0',
        updateSupported: true,
        exactVersionUpdateSupported: true,
      };
      changed([localExternal], [LOCAL.id], '0.10.0', LOCAL.id);
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      const [message] = toast.warning.mock.calls[0]!;
      expect(String(message)).toContain('This machine (local)');
      expect(String(message)).not.toContain('persisted-fallback-label');

      run.task.cancel();
      await run.task.toPromise();
    });

    it("dispatches updateBackendRequested for the local entry when its toast's Update is clicked", async () => {
      invoke.mockImplementation(async (channel: string) => {
        if (channel === CONNECTION_CHANNELS.LIST)
          return { connections: [LOCAL], activeId: LOCAL.id, windowBackendId: LOCAL.id };
        if (channel === CONNECTION_CHANNELS.UPDATE_BACKEND) return { ok: true, version: '0.10.0' };
        return {};
      });
      const run = start();
      await settle();

      const localExternal = {
        ...LOCAL,
        daemonVersion: '0.9.0',
        updateSupported: true,
        exactVersionUpdateSupported: true,
      };
      changed([localExternal], [LOCAL.id], '0.10.0', LOCAL.id);
      await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
      const [, options] = toast.warning.mock.calls[0]!;
      options.action.onClick();
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.UPDATE_BACKEND, {
          id: LOCAL.id,
        }),
      );
      // The outcome surfaces via the existing per-result update toast.
      await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));

      run.task.cancel();
      await run.task.toPromise();
    });

    it('never toasts the local entry when its external daemon reports updateSupported: false', async () => {
      const run = start();
      await settle();

      const localExternal = { ...LOCAL, daemonVersion: '0.9.0', updateSupported: false };
      changed([localExternal], [LOCAL.id], '0.10.0', LOCAL.id);
      await settle();
      expect(toast.warning).not.toHaveBeenCalled();

      run.task.cancel();
      await run.task.toPromise();
    });
  });
});
