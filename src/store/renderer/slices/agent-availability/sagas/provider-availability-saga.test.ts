import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), clearCache: vi.fn(), catalog: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client', () => ({ appClient: { providers: { catalog: mocks.catalog } } }));
vi.mock('$features/providers/provider-availability.client', () => ({
  clearProviderAvailabilityCache: mocks.clearCache,
}));

import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';
import type { ProviderCatalogResult } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import {
  checkAllProvidersRequested,
  checkSingleProviderRequested,
  ensureProvidersChecked,
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
    await runSaga({ dispatch }, checkSingleProviderWorker, 'codex').toPromise();

    expect(mocks.invoke.mock.calls).toEqual([['providers:check-single', 'codex']]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'agentAvailability/checkSingleProviderSuccess',
        payload: ['codex', { available: true, authenticated: true }],
      },
    ]);
  });

  it('dispatches the exact failure action when a single probe rejects', async () => {
    mocks.invoke.mockRejectedValue(new Error('probe failed'));
    const dispatch = vi.fn();
    await runSaga({ dispatch }, checkSingleProviderWorker, 'codex').toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'agentAvailability/checkSingleProviderFailure', payload: ['codex'] },
    ]);
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
    const dispatch = vi.fn();
    const task = runSaga({ dispatch }, checkAllProvidersWorker);
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
      payload: ['codex', { available: true }],
    });
    resolvers.get('auggie')!({ success: true, data: { available: false } });
    await settle();
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({
      type: 'agentAvailability/checkSingleProviderSuccess',
      payload: ['auggie', { available: false }],
    });
    for (const id of ids.filter((id) => id !== 'codex' && id !== 'auggie')) {
      resolvers.get(id)!({ success: false });
    }
    await task.toPromise();

    expect(mocks.invoke.mock.calls).toEqual([
      ['providers:get-availability'],
      ...ids.map((id) => ['providers:check-single', id]),
    ]);
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls.at(-1)?.[0]).toEqual({
      type: 'agentAvailability/checkAllProvidersComplete',
      payload: [],
    });
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
      { channel, dispatch, getState: () => ({ agentAvailability: { hasCheckedOnce: false } }) },
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
    expect(mocks.clearCache).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'agentAvailability/checkAllProvidersComplete'),
    ).toEqual([]);
    expect(offById.mock.calls).toEqual([['backend:status', 'provider-listener']]);
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
      { channel, dispatch, getState: () => ({ agentAvailability: { hasCheckedOnce: false } }) },
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
      { channel, dispatch, getState: () => ({ agentAvailability: { hasCheckedOnce: false } }) },
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
        getState: () => ({ agentAvailability: { hasCheckedOnce: true } }),
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
