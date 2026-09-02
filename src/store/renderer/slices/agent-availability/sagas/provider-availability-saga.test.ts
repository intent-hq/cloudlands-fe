import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), catalog: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client', () => ({ appClient: { providers: { catalog: mocks.catalog } } }));

import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import {
  agentAvailabilityReducer,
  checkAllProvidersRequested,
  checkSingleProviderRequested,
  ensureProvidersChecked,
  initialState,
} from '../agent-availability-slice';
import {
  checkAllProvidersWorker,
  checkSingleProviderWorker,
  providerAvailabilitySaga,
} from './provider-availability-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('providerAvailabilitySaga', () => {
  const originalElectronApi = window.electronAPI;
  const catalog: ProviderCatalogResult = { providers: [], defaultProviderId: 'auggie' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue(catalog);
  });
  afterEach(() => {
    window.electronAPI = originalElectronApi;
  });

  it('sends the exact single-provider IPC request and dispatches its terminal result', async () => {
    mocks.invoke.mockResolvedValue({
      success: true,
      providerId: 'transport-provider-id',
      data: { available: true, authenticated: true },
      requestId: 'wire-only-request-id',
      diagnostics: { elapsedMs: 12 },
    });
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ agentAvailability: initialState }) },
      checkSingleProviderWorker,
      'codex',
    ).toPromise();

    expect(mocks.invoke.mock.calls).toEqual([['providers:check-single', 'codex']]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'agentAvailability/checkSingleProviderSuccess',
        payload: ['codex', { available: true, authenticated: true }, 0],
      },
    ]);
  });

  it('dispatches the exact failure action when a single probe rejects', async () => {
    mocks.invoke.mockRejectedValue(new Error('probe failed'));
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => ({ agentAvailability: initialState }) },
      checkSingleProviderWorker,
      'codex',
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'agentAvailability/checkSingleProviderFailure', payload: ['codex', 0] },
    ]);
  });

  it('preserves the last-known status when a recheck lands a probe-failure envelope', async () => {
    // Transient probe failure regression: the main process reports a daemon
    // RPC failure as success:false (never success:true with a fabricated
    // available:false), and the failure action must keep the previously
    // known available:true while settling the loading flag.
    mocks.invoke.mockResolvedValue({
      success: false,
      providerId: 'codex',
      error: 'transport down',
    });
    let sliceState = {
      ...initialState,
      providerStatusMap: { codex: { available: true, authenticated: true } },
    };
    const dispatch = vi.fn((action) => {
      sliceState = agentAvailabilityReducer(sliceState, action);
      return action;
    });
    sliceState = agentAvailabilityReducer(sliceState, checkSingleProviderRequested('codex'));
    await runSaga(
      { dispatch, getState: () => ({ agentAvailability: sliceState }) },
      checkSingleProviderWorker,
      'codex',
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'agentAvailability/checkSingleProviderFailure', payload: ['codex', 1] },
    ]);
    expect(sliceState.providerStatusMap['codex']).toEqual({
      available: true,
      authenticated: true,
    });
    expect(sliceState.providerLoadingMap['codex']).toBe(false);
  });

  it('fans out in parallel and forwards each provider as soon as its probe settles', async () => {
    const ids = Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID);
    const resolvers = new Map<string, (value: unknown) => void>();
    const npx = { resolvedPath: '/usr/bin/npx', version: '10.0.0', versionOk: true };
    mocks.invoke.mockImplementation((channel: string, providerId?: string) => {
      if (channel === 'providers:get-availability') {
        return Promise.resolve({ success: true, data: { npx } });
      }
      return new Promise((resolve) => {
        resolvers.set(providerId!, resolve);
      });
    });
    let sliceState = initialState;
    const dispatch = vi.fn((action) => {
      sliceState = agentAvailabilityReducer(sliceState, action);
      return action;
    });
    const task = runSaga(
      { dispatch, getState: () => ({ agentAvailability: sliceState }) },
      checkAllProvidersWorker,
    );
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'agentAvailability/setAllProvidersLoading',
        payload: [Object.fromEntries(ids.map((id) => [id, true]))],
      },
      {
        type: 'agentAvailability/setNpxStatus',
        payload: [{ resolvedPath: '/usr/bin/npx', version: '10.0.0', versionOk: true }],
      },
    ]);
    resolvers.get('codex')!({ success: true, data: { available: true } });
    await settle();
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({
      type: 'agentAvailability/checkSingleProviderSuccess',
      payload: ['codex', { available: true }, 1],
    });
    resolvers.get('auggie')!({ success: true, data: { available: false } });
    await settle();
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({
      type: 'agentAvailability/checkSingleProviderSuccess',
      payload: ['auggie', { available: false }, 1],
    });
    for (const id of ids.filter((id) => id !== 'codex' && id !== 'auggie')) {
      resolvers.get(id)!({ success: false });
    }
    await task.toPromise();

    expect(mocks.invoke.mock.calls).toEqual([
      ['providers:get-availability'],
      ...ids.map((id) => ['providers:check-single', id]),
    ]);
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({
      type: 'agentAvailability/checkAllProvidersComplete',
      payload: [],
    });
  });

  it('discards a stale in-flight probe result superseded by a newer successful check', async () => {
    // Install-mid-onboarding regression (false "No provider available" on
    // step 4): a slow probe from a sweep that started BEFORE the install
    // finished must not overwrite the available:true landed by a manual
    // recheck that started (and resolved) after it.
    const pendingBySequence: Array<(value: unknown) => void> = [];
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel !== 'providers:check-single') {
        return Promise.resolve({ success: true, data: {} });
      }
      return new Promise((resolve) => {
        pendingBySequence.push(resolve);
      });
    });
    let sliceState = initialState;
    const dispatch = vi.fn((action) => {
      sliceState = agentAvailabilityReducer(sliceState, action);
      return action;
    });
    const options = { dispatch, getState: () => ({ agentAvailability: sliceState }) };

    // Stale probe: starts while claude is not yet installed.
    sliceState = agentAvailabilityReducer(sliceState, checkSingleProviderRequested('claude-code'));
    const staleProbe = runSaga(options, checkSingleProviderWorker, 'claude-code');
    await settle();

    // Fresh probe: user finished the install and hit "Check again".
    sliceState = agentAvailabilityReducer(sliceState, checkSingleProviderRequested('claude-code'));
    const freshProbe = runSaga(options, checkSingleProviderWorker, 'claude-code');
    await settle();
    pendingBySequence[1]!({ success: true, data: { available: true, authenticated: true } });
    await freshProbe.toPromise();
    expect(sliceState.providerStatusMap['claude-code']).toEqual({
      available: true,
      authenticated: true,
    });

    // The stale probe settles LAST with its pre-install result — it must be
    // dropped, keeping the fresh available:true and the settled loading flag.
    pendingBySequence[0]!({ success: true, data: { available: false } });
    await staleProbe.toPromise();
    expect(sliceState.providerStatusMap['claude-code']).toEqual({
      available: true,
      authenticated: true,
    });
    expect(sliceState.providerLoadingMap['claude-code']).toBe(false);
  });

  it('coalesces connected/manual bulk requests and cleans up on cancellation', async () => {
    let emit!: (payload: { status: string }) => void;
    const offById = vi.fn();
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn((_channel, handler) => {
        emit = handler;
        return 'provider-listener';
      }),
      offById,
    };
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          agentAvailability: { hasCheckedOnce: false, providerCheckEpochMap: {} },
        }),
      },
      providerAvailabilitySaga,
    );
    await settle();
    emit({ status: 'connected' });
    channel.put(checkAllProvidersRequested());
    channel.put(ensureProvidersChecked());
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([['providers:get-availability']]);
    task.cancel();
    await task.toPromise();
    expect(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'agentAvailability/checkAllProvidersComplete'),
    ).toEqual([]);
    expect(offById.mock.calls).toEqual([['backend:status', 'provider-listener']]);
  });

  it('runs one trailing bulk check after repeated triggers arrive in flight', async () => {
    let emit!: (payload: { status: string }) => void;
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn((_channel, handler) => {
        emit = handler;
        return 'provider-listener';
      }),
      offById: vi.fn(),
    };
    let resolveFirstAvailability!: (value: unknown) => void;
    let availabilityCalls = 0;
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel !== 'providers:get-availability') {
        return Promise.resolve({ success: false });
      }
      availabilityCalls += 1;
      if (availabilityCalls === 1) {
        return new Promise((resolve) => {
          resolveFirstAvailability = resolve;
        });
      }
      return new Promise(() => {});
    });
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          agentAvailability: { hasCheckedOnce: false, providerCheckEpochMap: {} },
        }),
      },
      providerAvailabilitySaga,
    );

    await settle();
    channel.put(checkAllProvidersRequested());
    await settle();
    expect(availabilityCalls).toBe(1);
    emit({ status: 'connected' });
    channel.put(checkAllProvidersRequested());
    channel.put(checkAllProvidersRequested());
    channel.put(ensureProvidersChecked());
    await settle();
    expect(availabilityCalls).toBe(1);

    resolveFirstAvailability({ success: false });
    await vi.waitFor(() => expect(availabilityCalls).toBe(2));
    await settle();
    expect(availabilityCalls).toBe(2);
    expect(
      dispatch.mock.calls.filter(
        ([action]) => action.type === 'agentAvailability/checkAllProvidersComplete',
      ),
    ).toHaveLength(1);

    task.cancel();
    await task.toPromise();
  });

  it('owns exact catalog hydration at startup and after a connected status', async () => {
    let emit!: (payload: { status: string }) => void;
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn((_channel, handler) => {
        emit = handler;
        return 'provider-listener';
      }),
      offById: vi.fn(),
    };
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          agentAvailability: { hasCheckedOnce: false, providerCheckEpochMap: {} },
        }),
      },
      providerAvailabilitySaga,
    );
    await settle();

    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    expect(mocks.catalog).toHaveBeenCalledWith();
    expect(dispatch).toHaveBeenCalledWith(providerCatalogLoaded(catalog));

    emit({ status: 'connected' });
    await settle();
    expect(mocks.catalog).toHaveBeenCalledTimes(2);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === providerCatalogLoaded.type),
    ).toHaveLength(2);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === checkAllProvidersRequested.type),
    ).toHaveLength(1);

    task.cancel();
    await task.toPromise();
  });

  it('recovers catalog hydration on reconnect after an initial request failure', async () => {
    let emit!: (payload: { status: string }) => void;
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn((_channel, handler) => {
        emit = handler;
        return 'provider-listener';
      }),
      offById: vi.fn(),
    };
    mocks.catalog.mockRejectedValueOnce(new Error('daemon unavailable')).mockResolvedValue(catalog);
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    const channel = stdChannel();
    const dispatch = vi.fn((action) => channel.put(action));
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          agentAvailability: { hasCheckedOnce: false, providerCheckEpochMap: {} },
        }),
      },
      providerAvailabilitySaga,
    );
    await settle();

    expect(
      dispatch.mock.calls.filter(([action]) => action.type === providerCatalogLoaded.type),
    ).toEqual([]);
    emit({ status: 'connected' });
    await settle();
    expect(mocks.catalog).toHaveBeenCalledTimes(2);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === providerCatalogLoaded.type),
    ).toEqual([[providerCatalogLoaded(catalog)]]);

    task.cancel();
    await task.toPromise();
  });

  it('does not dispatch or install reconnect ownership after startup hydration is cancelled', async () => {
    let resolveCatalog!: (value: ProviderCatalogResult) => void;
    mocks.catalog.mockReturnValue(
      new Promise<ProviderCatalogResult>((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const on = vi.fn(() => 'provider-listener');
    window.electronAPI = { ...originalElectronApi, on, offById: vi.fn() };
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, providerAvailabilitySaga);
    await settle();

    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    task.cancel();
    resolveCatalog(catalog);
    await task.toPromise();

    expect(dispatch).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });

  it('skips ensure after hydration but manual single checks still bypass it', async () => {
    window.electronAPI = {
      ...originalElectronApi,
      on: vi.fn(() => 'provider-listener'),
      offById: vi.fn(),
    };
    mocks.invoke.mockResolvedValue({ success: false });
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: vi.fn(),
        getState: () => ({
          agentAvailability: { hasCheckedOnce: true, providerCheckEpochMap: {} },
        }),
      },
      providerAvailabilitySaga,
    );
    await settle();
    channel.put(ensureProvidersChecked());
    channel.put(checkSingleProviderRequested('codex'));
    await settle();

    expect(mocks.invoke.mock.calls).toEqual([['providers:check-single', 'codex']]);
    task.cancel();
    await task.toPromise();
  });
});
