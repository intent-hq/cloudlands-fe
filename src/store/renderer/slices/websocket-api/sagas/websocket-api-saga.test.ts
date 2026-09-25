import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import {
  settingsEventsReducer,
  settingsFormOpened,
  settingsFormClosed,
  settingsFormRequestSettled,
} from '../../settings-events/settings-events-slice';
import { websocketApiRequested } from '../websocket-api-slice';
import {
  selectSettingsForm,
  selectSettingsFormOperation,
} from '../../settings-events/settings-events-selectors';
import {
  registerWebsocketCredentials,
  readWebsocketToken,
} from '$features/settings/websocket-api-credentials';
import { websocketApiSaga } from './websocket-api-saga';
import { selfPublicationRequested } from '../../connections/connections-slice';
import { select } from 'typed-redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  pairing: vi.fn(),
  rotate: vi.fn(),
  notify: vi.fn(),
  qr: vi.fn(),
}));
vi.mock('$lib/client', () => {
  const client = {
    settings: { list: mocks.list, update: mocks.update },
    server: { pairingInfo: mocks.pairing, rotateToken: mocks.rotate },
  };
  return { appClient: client, localMachineClient: client };
});
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: mocks.notify, error: mocks.notify },
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }));
vi.mock('$store/renderer/store', () => ({
  store: {
    createSelector: (fn: (...args: any[]) => any) =>
      Object.assign(fn, {
        select: fn,
        effect: function* (...args: any[]) {
          return yield* select(fn, ...args);
        },
      }),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const identity = { formId: 'api', sessionId: 'first' };
const request = (requestId: string, resource = 'save') => ({ ...identity, requestId, resource });
const fixture = {
  token: 'synthetic-secret',
  port: 5181,
  certFingerprint: 'AA:BB',
  localIps: ['192.0.2.10'],
  hostname: 'fixture',
  path: '/ws',
};

describe('API request lifetime', () => {
  let state: { settingsEvents: ReturnType<typeof settingsEventsReducer> };
  let task: Task;
  let dispatch: (action: any) => void;
  let actions: any[];
  let diagnostics: unknown[];
  let publications: ReturnType<typeof selfPublicationRequested>[];
  beforeEach(() => {
    vi.resetAllMocks();
    state = { settingsEvents: settingsEventsReducer(undefined, { type: '@@init' }) };
    actions = [];
    diagnostics = [];
    publications = [];
    const channel = stdChannel();
    dispatch = (action) => {
      actions.push(action);
      state = { settingsEvents: settingsEventsReducer(state.settingsEvents, action) };
      channel.put(action);
      if (action.type === selfPublicationRequested.type) publications.push(action);
    };
    task = runSaga(
      {
        channel,
        dispatch,
        getState: () => state,
        sagaMonitor: {
          effectResolved: (_id, result) => {
            if (result instanceof Error) diagnostics.push(result.message);
            else if (!(result instanceof Promise)) diagnostics.push(result);
          },
          effectRejected: (_id, error) =>
            diagnostics.push(error instanceof Error ? error.message : error),
        },
      },
      websocketApiSaga,
    );
    dispatch(settingsFormOpened(identity, 'websocket-api'));
    registerWebsocketCredentials(identity.formId, identity.sessionId, () => {});
    mocks.list.mockResolvedValue([
      { path: 'server.wsApi.enabled', value: false },
      { path: 'server.wsApi.port', value: 5181 },
    ]);
  });
  afterEach(async () => {
    task.cancel();
    await task.toPromise();
    vi.useRealTimers();
  });

  it('stays busy until composed publication finishes and skips obsolete queued session writes', async () => {
    const first = deferred<{ path: string; value: boolean }[]>();
    mocks.update
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue([{ path: 'server.wsApi.enabled', value: false }]);
    dispatch(
      websocketApiRequested(request('first'), {
        kind: 'toggle',
        enabled: false,
        connectionId: 'local',
      }),
    );
    dispatch(
      websocketApiRequested(request('queued'), { kind: 'port', port: 5182, connectionId: 'local' }),
    );
    dispatch(settingsFormClosed(identity));
    const next = { ...identity, sessionId: 'next' };
    dispatch(settingsFormOpened(next, 'websocket-api'));
    const latest = { ...next, requestId: 'latest', resource: 'save' };
    dispatch(
      websocketApiRequested(latest, { kind: 'toggle', enabled: false, connectionId: 'local' }),
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    first.resolve([{ path: 'server.wsApi.enabled', value: false }]);
    await vi.waitFor(() => expect(publications).toHaveLength(1));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    dispatch(publications[0].success(undefined));
    await vi.waitFor(() => expect(publications).toHaveLength(2));
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'server.wsApi.enabled', value: false }]],
      [[{ path: 'server.wsApi.enabled', value: false }]],
    ]);
    expect(selectSettingsFormOperation.select(state as never, next, 'save')?.status).toBe(
      'pending',
    );
    dispatch(publications[1].success(undefined));
    await vi.waitFor(() =>
      expect(selectSettingsFormOperation.select(state as never, next, 'save')?.status).toBe(
        'succeeded',
      ),
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('keeps token and QR bytes outside Redux, outcomes and saga result diagnostics', async () => {
    mocks.list.mockResolvedValue([{ path: 'server.wsApi.enabled', value: true }]);
    mocks.pairing.mockResolvedValue(fixture);
    dispatch(
      websocketApiRequested(request('load', 'load'), { kind: 'load', connectionId: 'local' }),
    );
    await vi.waitFor(() => expect(publications).toHaveLength(1));
    dispatch(publications[0].success(undefined));
    await vi.waitFor(() =>
      expect(selectSettingsForm.select(state as never, identity)?.loaded).toBe(true),
    );
    mocks.qr.mockResolvedValue('synthetic-qr-bytes');
    dispatch(websocketApiRequested(request('qr', 'qr'), { kind: 'qr', connectionId: 'local' }));
    await vi.waitFor(() =>
      expect(selectSettingsFormOperation.select(state as never, identity, 'qr')?.status).toBe(
        'succeeded',
      ),
    );
    expect(readWebsocketToken(request('read'))).toBe(fixture.token);
    const recorded = JSON.stringify({ state, actions, diagnostics }, (_key, value) =>
      typeof value === 'function' ? undefined : value,
    );
    expect(recorded.includes(fixture.token)).toBe(false);
    expect(recorded.includes('synthetic-qr-bytes')).toBe(false);
    task.cancel();
    expect(readWebsocketToken(request('read'))).toBe('');
  });

  it('ignores a closed session pairing completion and settles cancellation', async () => {
    mocks.list.mockResolvedValue([{ path: 'server.wsApi.enabled', value: true }]);
    const late = deferred<typeof fixture>();
    mocks.pairing.mockReturnValue(late.promise);
    const load = request('late', 'load');
    dispatch(websocketApiRequested(load, { kind: 'load', connectionId: 'local' }));
    await vi.waitFor(() => expect(mocks.pairing).toHaveBeenCalledTimes(1));
    dispatch(settingsFormClosed(identity));
    late.resolve(fixture);
    await Promise.resolve();
    await Promise.resolve();
    expect(readWebsocketToken(load)).toBe('');
    expect(publications).toHaveLength(0);
    expect(
      actions.some(
        (action) =>
          action.type === settingsFormRequestSettled.type &&
          action.payload[1].status === 'cancelled',
      ),
    ).toBe(true);
  });

  it('does not notify a closed form after its active token publication completes', async () => {
    mocks.rotate.mockResolvedValue({ token: fixture.token });
    dispatch(websocketApiRequested(request('rotate'), { kind: 'rotate', connectionId: 'local' }));
    await vi.waitFor(() => expect(publications).toHaveLength(1));
    dispatch(settingsFormClosed(identity));
    dispatch(publications[0].success(undefined));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(readWebsocketToken(request('read'))).toBe('');
  });

  it('expires QR credentials at 30 seconds and cancels the old deadline on reopen', async () => {
    vi.useFakeTimers();
    let qr = '';
    registerWebsocketCredentials(identity.formId, identity.sessionId, (value) => {
      qr = value.qrDataUrl;
    });
    mocks.list.mockResolvedValue([{ path: 'server.wsApi.enabled', value: true }]);
    mocks.pairing.mockResolvedValue(fixture);
    dispatch(
      websocketApiRequested(request('load', 'load'), { kind: 'load', connectionId: 'local' }),
    );
    await vi.advanceTimersByTimeAsync(0);
    dispatch(publications[0].success(undefined));
    await vi.advanceTimersByTimeAsync(0);
    mocks.qr.mockResolvedValue('synthetic-qr');
    dispatch(websocketApiRequested(request('qr-1', 'qr'), { kind: 'qr', connectionId: 'local' }));
    await vi.advanceTimersByTimeAsync(29000);
    expect(qr.length > 0).toBe(true);
    dispatch(
      websocketApiRequested(request('close', 'qr'), { kind: 'closeQr', connectionId: 'local' }),
    );
    expect(qr).toBe('');
    dispatch(websocketApiRequested(request('qr-2', 'qr'), { kind: 'qr', connectionId: 'local' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(qr.length > 0).toBe(true);
    await vi.advanceTimersByTimeAsync(29000);
    expect(qr).toBe('');
  });

  it('sanitizes rejected credential calls before saga rejection diagnostics and outcomes', async () => {
    mocks.rotate.mockRejectedValue(new Error(`Rejected ${fixture.token}`));
    dispatch(websocketApiRequested(request('rotate'), { kind: 'rotate', connectionId: 'local' }));
    await vi.waitFor(() =>
      expect(selectSettingsFormOperation.select(state as never, identity, 'save')?.status).toBe(
        'failed',
      ),
    );
    const recorded = JSON.stringify({ state, actions, diagnostics });
    expect(recorded.includes(fixture.token)).toBe(false);
  });
});
