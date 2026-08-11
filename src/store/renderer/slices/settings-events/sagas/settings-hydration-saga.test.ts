import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  apply: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { settings: { list: mocks.list, update: mocks.update } },
}));
vi.mock('$features/settings/settings-hydration-service', () => ({
  applySettingsChanges: mocks.apply,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.error }),
}));

import { BackendError } from '$lib/client/live/backend-transport-types';

import { settingsChangesReceived } from '../settings-events-slice';
import {
  SETTINGS_HYDRATION_RETRY_DELAYS_MS,
  hydrateSettingsOnceSaga,
  settingsHydrationSaga,
} from './settings-hydration-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('settingsHydrationSaga', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates once in source order without issuing a persistence write', async () => {
    mocks.list.mockResolvedValue([
      { path: 'providers.active', value: 'auggie', label: '', description: '' },
      { path: 'quickActions.defaultModel', value: 'fast', label: '', description: '' },
      { path: 'quickActions.typeOverrides', value: { commit: 'model' }, label: '', description: '' },
    ]);

    await runSaga({ dispatch: vi.fn() }, hydrateSettingsOnceSaga).toPromise();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith();
    expect(mocks.apply).toHaveBeenCalledWith([
      { path: 'providers.active', value: 'auggie' },
      { path: 'quickActions.defaultModel', value: 'fast' },
      { path: 'quickActions.typeOverrides', value: { commit: 'model' } },
    ]);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('treats an empty snapshot as a successful no-op', async () => {
    mocks.list.mockResolvedValue([]);
    await runSaga({ dispatch: vi.fn() }, hydrateSettingsOnceSaga).toPromise();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('retries a transport-failed boot read with bounded backoff until it lands (monorepo#1986)', async () => {
    vi.useFakeTimers();
    try {
      mocks.list
        .mockRejectedValueOnce(new Error('connect ENOENT intentd.sock'))
        .mockRejectedValueOnce(new Error('connect ENOENT intentd.sock'))
        .mockResolvedValue([
          { path: 'providers.enabled', value: { 'claude-code': true }, label: '', description: '' },
        ]);
      const task = runSaga({ dispatch: vi.fn() }, hydrateSettingsOnceSaga);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.list).toHaveBeenCalledTimes(1);
      expect(mocks.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[0]);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      expect(mocks.apply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SETTINGS_HYDRATION_RETRY_DELAYS_MS[1]);
      expect(mocks.list).toHaveBeenCalledTimes(3);
      expect(mocks.apply).toHaveBeenCalledWith([
        { path: 'providers.enabled', value: { 'claude-code': true } },
      ]);
      await task.toPromise();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a structured daemon error response', async () => {
    mocks.list.mockRejectedValue(
      new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    );
    await runSaga({ dispatch: vi.fn() }, hydrateSettingsOnceSaga).toPromise();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it('does not apply a boot read that settles after cancellation', async () => {
    let resolveList!: (value: unknown[]) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const task = runSaga({ dispatch: vi.fn() }, settingsHydrationSaga);
    task.cancel();
    await task.toPromise();
    resolveList([{ path: 'providers.active', value: 'late' }]);
    await Promise.resolve();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('buffers changes during boot hydration and applies each bundle atomically in order', async () => {
    let resolveList!: (value: unknown[]) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const input = stdChannel();
    const task = runSaga({ channel: input, dispatch: vi.fn() }, settingsHydrationSaga);
    input.put(settingsChangesReceived([{ path: 'first', value: 1 }]));
    input.put(
      settingsChangesReceived([
        { path: 'second.a', value: 2 },
        { path: 'second.b', value: 3 },
      ]),
    );
    resolveList([{ path: 'boot', value: 0 }]);
    await settle();

    expect(mocks.apply.mock.calls).toEqual([
      [[{ path: 'boot', value: 0 }]],
      [[{ path: 'first', value: 1 }]],
      [[
        { path: 'second.a', value: 2 },
        { path: 'second.b', value: 3 },
      ]],
    ]);
    task.cancel();
    await task.toPromise();
    input.put(settingsChangesReceived([{ path: 'late', value: 4 }]));
    await settle();
    expect(mocks.apply).toHaveBeenCalledTimes(3);
  });
});