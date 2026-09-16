import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  getUserRule: vi.fn(),
  pairingInfo: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      list: mocks.list,
      get: vi.fn(),
      update: mocks.update,
      getUserRule: mocks.getUserRule,
      updateUserRule: vi.fn(),
    },
    server: { pairingInfo: mocks.pairingInfo, rotateToken: vi.fn() },
    system: { capabilities: vi.fn() },
  },
}));

import {
  getServerPairingInfoRequested,
  getUserRuleRequested,
  listSettingsRequested,
  updateSettingsRequested,
} from '../settings-events-slice';
import { settingsOperationsSaga } from './settings-operations-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('settingsOperationsSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes settings.list through the saga and resolves the async action', async () => {
    const response = [{ path: 'workspaceApi.toonOutput', value: true }];
    mocks.list.mockResolvedValue(response);
    const input = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel: input, dispatch: (action) => dispatched.push(action) },
      settingsOperationsSaga,
    );

    input.put(listSettingsRequested());
    await settle();

    expect(mocks.list).toHaveBeenCalledWith();
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: listSettingsRequested.success.type,
        payload: { request: [undefined, expect.any(Number)], response },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('passes the exact atomic settings.update payload and protocol response', async () => {
    const changes = [{ path: 'server.wsApi.enabled', value: true }];
    mocks.update.mockResolvedValue(changes);
    const input = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel: input, dispatch: (action) => dispatched.push(action) },
      settingsOperationsSaga,
    );

    input.put(updateSettingsRequested(changes));
    await settle();

    expect(mocks.update).toHaveBeenCalledWith(changes);
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: updateSettingsRequested.success.type,
        payload: { request: [changes, undefined, expect.any(Number)], response: changes },
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('runs same-key updates concurrently and correlates newer-first successes', async () => {
    const earlierChanges = [{ path: 'server.wsApi.enabled', value: false }];
    const newerChanges = [{ path: 'server.wsApi.enabled', value: true }];
    const earlierResult = deferred<typeof earlierChanges>();
    const newerResult = deferred<typeof newerChanges>();
    mocks.update
      .mockReturnValueOnce(earlierResult.promise)
      .mockReturnValueOnce(newerResult.promise);
    const input = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel: input, dispatch: (action) => dispatched.push(action) },
      settingsOperationsSaga,
    );

    input.put(updateSettingsRequested(earlierChanges, 'same-key'));
    input.put(updateSettingsRequested(newerChanges, 'same-key'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([[earlierChanges], [newerChanges]]);
    newerResult.resolve(newerChanges);
    await settle();
    earlierResult.resolve(earlierChanges);
    await settle();

    const successes = dispatched.filter(
      (action) => action.type === updateSettingsRequested.success.type,
    );
    expect(successes.map((action) => action.payload.response)).toEqual([
      newerChanges,
      earlierChanges,
    ]);
    expect(successes.map((action) => action.payload.request.at(-1))).toEqual([
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(successes[0].payload.request.at(-1)).not.toBe(successes[1].payload.request.at(-1));
    task.cancel();
    await task.toPromise();
  });

  it('preserves request correlation when cancellation dispatches failure', async () => {
    const changes = [{ path: 'server.wsApi.enabled', value: true }];
    mocks.update.mockReturnValue(new Promise(() => {}));
    const input = stdChannel();
    const dispatched: any[] = [];
    const request = updateSettingsRequested(changes, 'cancel-key');
    void request.promise.catch(() => {});
    const task = runSaga(
      { channel: input, dispatch: (action) => dispatched.push(action) },
      settingsOperationsSaga,
    );

    input.put(request);
    await settle();
    task.cancel();
    await task.toPromise();

    const failure = dispatched.find(
      (action) => action.type === updateSettingsRequested.failure.type,
    );
    expect(failure.payload.request).toEqual([changes, 'cancel-key', expect.any(Number)]);
    expect(failure.payload.error).toEqual(new Error('Settings request was cancelled'));
  });

  it('owns rules.get and local-only pairing reads', async () => {
    const rule = { enabled: true, content: 'Be concise', updatedAt: 1 };
    const pairing = {
      token: 'redacted-test-token',
      certFingerprint: 'AA:BB',
      port: 5181,
      path: '/ws',
      localIps: ['127.0.0.1'],
      hostname: 'test-host',
    };
    mocks.getUserRule.mockResolvedValue(rule);
    mocks.pairingInfo.mockResolvedValue(pairing);
    const input = stdChannel();
    const task = runSaga({ channel: input, dispatch: vi.fn() }, settingsOperationsSaga);

    input.put(getUserRuleRequested('base-system-prompt'));
    input.put(getServerPairingInfoRequested());
    await settle();

    expect(mocks.getUserRule).toHaveBeenCalledWith('base-system-prompt');
    expect(mocks.pairingInfo).toHaveBeenCalledWith();
    task.cancel();
    await task.toPromise();
  });
});
