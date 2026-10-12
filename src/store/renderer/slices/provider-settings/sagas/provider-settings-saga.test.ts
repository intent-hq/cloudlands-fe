import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, cancelled, take } from 'typed-redux-saga';
import type { GenericAction } from '@themislib/themis/types';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';

const mocks = vi.hoisted(() => ({ update: vi.fn(), list: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { settings: { update: mocks.update, list: mocks.list } },
}));

import { BackendError } from '$lib/client/live/backend-transport-types';

import {
  enablementPersistRejected,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
  loadEnabledProvidersFromStorage,
} from '../provider-settings-slice';
import { hydrateDefaultProvider } from '../../model/model-slice';
import { settingsFieldsRefreshRequested } from '../../settings-events/settings-events-slice';
import { PROVIDER_SETTINGS_RETRY_DELAYS_MS, providerSettingsSaga } from './provider-settings-saga';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const cleanups: (() => Promise<void>)[] = [];

function harness({ canBeDisabled = true, enabled = true } = {}) {
  const dispose = store.init();
  const runtimeErrors: unknown[] = [];
  const recordError = (error: unknown) => runtimeErrors.push(error);
  store.traceStreams.runtimeError.onValue(recordError);
  const stops: (() => Promise<void>)[] = [];
  cleanups.push(async () => {
    const errors: unknown[] = [];
    for (const stop of [...stops].reverse()) {
      try {
        await stop();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      dispose();
    } catch (error) {
      errors.push(error);
    } finally {
      store.traceStreams.runtimeError.offValue(recordError);
    }
    expect({ runtimeErrors, cleanupErrors: errors }).toEqual({
      runtimeErrors: [],
      cleanupErrors: [],
    });
  });
  admitLegacyPrincipal();
  const connection = selectPrincipalConnectionContext.select(store.state);
  expect(connection).not.toBeNull();
  if (connection === null) throw new Error('Settings test requires an admitted connection');
  store.dispatch(hostExecutionConnectionChanged(connection));
  store.dispatch(
    providerCatalogLoaded({
      providers: [
        {
          id: 'codex',
          displayName: 'Codex',
          shortName: 'Codex',
          command: 'codex',
          canBeDisabled,
          visible: true,
        },
      ],
    }),
  );
  store.dispatch(loadEnabledProvidersFromStorage({ codex: enabled }));

  // Observe every application action, omitting only Store lifecycle instrumentation.
  const dispatch = vi.fn<(action: GenericAction) => void>();
  let recorderCancelled: boolean | null = null;
  const stopRecorder = store.runSaga(function* recordProviderTestActions() {
    try {
      while (true) {
        const action: GenericAction = yield* take('*');
        if (action.type !== 'sagaManager/startSaga' && action.type !== 'sagaManager/stopSaga') {
          dispatch(action);
        }
      }
    } finally {
      recorderCancelled = yield* cancelled();
    }
  });
  stops.push(async () => {
    stopRecorder();
    await settle();
    expect(recorderCancelled).toBe(true);
  });
  let ownerCancelled: boolean | null = null;
  const cancel = store.runSaga(function* providerSettingsTestOwner() {
    try {
      yield* call(providerSettingsSaga);
    } finally {
      ownerCancelled = yield* cancelled();
    }
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    cancel();
    await settle();
    expect(ownerCancelled).toBe(true);
  };
  stops.push(stop);
  return { send: store.dispatch, dispatch, stop, connection };
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0)) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  vi.useRealTimers();
  expect(errors).toEqual([]);
});

describe('providerSettingsSaga', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: {} },
      { path: 'quickActions.defaultModel', value: null },
      { path: 'quickActions.typeOverrides', value: {} },
      { path: 'quickActions.defaultReasoningEffort', value: null },
      { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
      { path: 'quickActions.providerSettings', value: {} },
    ]);
  });

  it('serializes partial active and enabled writes with exact post-state payloads', async () => {
    let release!: (value: unknown) => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness({ enabled: false });
    send(setActiveProvider('codex'));
    await settle();
    send(toggleProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
    ]);
    release([]);
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
      [[{ path: 'providers.enabled', value: { codex: true } }]],
    ]);
    await stop();
  });

  it('skips enabled persistence when the catalog says the reducer mutation is a no-op', async () => {
    const { send, stop } = harness({ canBeDisabled: false });
    send(toggleProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    await stop();
  });

  it('merges the click intent over the live map at write time after hydration replaced it (monorepo#1986)', async () => {
    let release!: (value: unknown) => void;
    mocks.update
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockResolvedValue([]);
    const { send, stop } = harness();
    send(setActiveProvider('codex'));
    await settle();
    send(setProviderEnabled({ providerId: 'claude-code', enabled: true }));
    await settle();
    // Boot hydration arrives while the write is queued behind the in-flight
    // provider write. The canonical reducer retains the pending click over
    // this stale snapshot, which has no claude-code entry.
    send(loadEnabledProvidersFromStorage({ auggie: true }));
    release([]);
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'model.defaultProvider', value: 'codex' }]],
      [[{ path: 'providers.enabled', value: { auggie: true, 'claude-code': true } }]],
    ]);
    await stop();
  });

  it('does not echo provider hydration actions', async () => {
    const { send, stop } = harness();
    send(hydrateDefaultProvider('codex'));
    await settle();

    expect(mocks.update.mock.calls).toEqual([]);
    await stop();
  });

  it('retains transport retry for enablement writes and drains that queue in order', async () => {
    vi.useFakeTimers();
    try {
      mocks.update.mockRejectedValueOnce(new Error('settings unavailable')).mockResolvedValue([]);
      const { send, stop } = harness();

      send(setProviderEnabled({ providerId: 'codex', enabled: false }));
      await vi.advanceTimersByTimeAsync(0);
      send(toggleProvider('codex'));
      await vi.advanceTimersByTimeAsync(0);
      // Enablement retains its existing retry policy; model/provider defaults do not.
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'providers.enabled', value: { codex: false } }]],
      ]);

      await vi.advanceTimersByTimeAsync(PROVIDER_SETTINGS_RETRY_DELAYS_MS[0]);
      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'providers.enabled', value: { codex: false } }]],
        [[{ path: 'providers.enabled', value: { codex: false } }]],
        [[{ path: 'providers.enabled', value: { codex: true } }]],
      ]);
      await stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    new Error('settings unavailable'),
  ])(
    'requests field recovery rather than retrying a default-provider failure (%s)',
    async (error) => {
      mocks.update.mockRejectedValue(error);
      const { send, dispatch, stop, connection } = harness();

      send(setActiveProvider('codex'));
      await settle();

      expect(mocks.update.mock.calls).toEqual([
        [[{ path: 'model.defaultProvider', value: 'codex' }]],
      ]);
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith();
      expect(dispatch).toHaveBeenCalledWith(
        settingsFieldsRefreshRequested(['model.defaultProvider'], connection),
      );
      await stop();
    },
  );

  it('retires the pending override when the daemon rejects an enablement write (monorepo#1986)', async () => {
    mocks.update.mockRejectedValue(
      new BackendError({ code: 'INVALID_PARAMS', message: 'invalid', rpcCode: -32602 }),
    );
    const { send, dispatch, stop } = harness();

    send(setProviderEnabled({ providerId: 'claude-code', enabled: true }));
    await settle();

    expect(mocks.update.mock.calls).toEqual([
      [[{ path: 'providers.enabled', value: { codex: true, 'claude-code': true } }]],
    ]);
    expect(dispatch).toHaveBeenCalledWith(enablementPersistRejected('claude-code', 1));
    await stop();
  });
});
