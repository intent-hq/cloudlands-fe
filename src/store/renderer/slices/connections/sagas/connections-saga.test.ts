import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONNECTION_CHANNELS,
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_AUTH_REJECTED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  CONNECTION_PROTOCOL_MISMATCH_EVENT,
  LOCAL_CONNECTION_ID,
} from '$shared/types/connections';
import type { ConnectionRecord } from '$shared/types/connections';
import {
  addConnectionRequested,
  captureFingerprintRequested,
  connectionsReducer,
  forgetConnectionRequested,
  initialState,
  switchConnectionRequested,
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
    invoke = vi.fn(async (channel: string, params?: unknown) => {
      if (channel === CONNECTION_CHANNELS.LIST)
        return { connections: [LOCAL], activeId: LOCAL_CONNECTION_ID };
      if (channel === CONNECTION_CHANNELS.CAPTURE_FINGERPRINT)
        return { fingerprint: 'AB:CD', tokenValid: true };
      if (channel === CONNECTION_CHANNELS.ADD) return { connection: REMOTE };
      if (channel === CONNECTION_CHANNELS.FORGET) return { id: (params as { id: string }).id };
      if (channel === CONNECTION_CHANNELS.SWITCH)
        return { activeId: (params as { id: string }).id };
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
        ? { connections: [LOCAL, REMOTE], activeId: REMOTE.id, protocolMismatch: mismatch }
        : { fingerprint: 'AB:CD' },
    );
    const run = start();
    await settle();

    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.LIST);
    expect(getItems(run.getState().connections.connections)).toEqual([LOCAL, REMOTE]);
    expect(run.getState().connections.activeId).toBe(REMOTE.id);
    expect(run.getState().connections.protocolMismatch).toEqual(mismatch);

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
    await expect(add.promise).resolves.toEqual(REMOTE);
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.ADD, {
      label: REMOTE.label,
      host: REMOTE.host,
      port: REMOTE.port,
      fingerprint: REMOTE.fingerprint,
      token: 'secret',
    });

    const forget = forgetConnectionRequested(REMOTE.id);
    run.channel.put(forget);
    await expect(forget.promise).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.FORGET, { id: REMOTE.id });

    const switchAction = switchConnectionRequested(REMOTE.id);
    run.channel.put(switchAction);
    await expect(switchAction.promise).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith(CONNECTION_CHANNELS.SWITCH, { id: REMOTE.id });
    expect(run.getState().connections.status).toBe('idle');

    run.task.cancel();
    await run.task.toPromise();
  });

  it('folds all push events and removes every listener on cancellation', async () => {
    const run = start();
    await settle();
    expect(Object.keys(callbacks).sort()).toEqual([
      CONNECTION_AUTH_REJECTED_EVENT,
      CONNECTION_CERT_MISMATCH_EVENT,
      CONNECTIONS_CHANGED_EVENT,
      CONNECTION_PROTOCOL_MISMATCH_EVENT,
    ]);

    callbacks[CONNECTIONS_CHANGED_EVENT]!({ connections: [LOCAL, REMOTE], activeId: REMOTE.id });
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
    await settle();

    expect(getItems(run.getState().connections.connections)).toEqual([LOCAL, REMOTE]);
    expect(run.getState().connections.activeId).toBe(REMOTE.id);
    expect(run.getState().connections.certMismatch?.actualFingerprint).toBe('EF:01');
    expect(run.getState().connections.protocolMismatch?.remoteProtocolVersion).toBe('2');
    expect(run.getState().connections.authRejected).toEqual({
      id: REMOTE.id,
      host: REMOTE.host,
      port: REMOTE.port,
      statusCode: 401,
    });

    run.task.cancel();
    await run.task.toPromise();
    expect(offById.mock.calls).toEqual([
      [CONNECTIONS_CHANGED_EVENT, `listener-${CONNECTIONS_CHANGED_EVENT}`],
      [CONNECTION_CERT_MISMATCH_EVENT, `listener-${CONNECTION_CERT_MISMATCH_EVENT}`],
      [CONNECTION_PROTOCOL_MISMATCH_EVENT, `listener-${CONNECTION_PROTOCOL_MISMATCH_EVENT}`],
      [CONNECTION_AUTH_REJECTED_EVENT, `listener-${CONNECTION_AUTH_REJECTED_EVENT}`],
    ]);
  });

  it('rejects a failed operation and records its status error', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === CONNECTION_CHANNELS.LIST) return { connections: [LOCAL], activeId: LOCAL.id };
      if (channel === CONNECTION_CHANNELS.SWITCH) throw new Error('no such connection');
      return {};
    });
    const run = start();
    await settle();
    const action = switchConnectionRequested('missing');
    run.channel.put(action);
    await expect(action.promise).rejects.toThrow('no such connection');
    expect(run.getState().connections.status).toBe('error');
    expect(run.getState().connections.error).toBe('no such connection');
    run.task.cancel();
    await run.task.toPromise();
  });
});
