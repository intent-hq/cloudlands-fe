import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('$lib/electron-bridge');
vi.mock('$lib/utils/platform-capabilities', () => ({ isElectronPlatform: () => false }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/client', async () => {
  const { LiveModelsClient } = await import('$lib/client/live/live-models-client');
  return { appClient: { models: new LiveModelsClient() } };
});
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: vi.fn() } }));

import { backendRequest } from '$lib/client/live/backend-transport';
import { notify } from '$lib/components/patterns/notify';
import { store } from '../../../store';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { modelReloadSaga } from '../../model/sagas/model-reload-saga';
import { hydrateDefaultProvider, reloadModelsForProvider } from '../../model/model-slice';
import { selectAvailableModels } from '../../model/model-selectors';
import { getModelsForProvider } from '../../model/model-utils';
import {
  providerModelsCacheCleared,
  providerModelsObserved,
  providerModelsReleased,
  providerModelsRequested,
} from '../provider-models-slice';
import {
  selectProviderModelsCacheEntry,
  selectProviderModelsRequests,
} from '../provider-models-selectors';

const request = vi.mocked(backendRequest);
const reply = (providerId: string, id: string) => ({
  providerId,
  source: providerId,
  models: [{ id, name: id, isDefault: true }],
});
const cache = (providerId = 'codex') =>
  selectProviderModelsCacheEntry.select(store.state, providerId);
const status = (providerId = 'codex') =>
  selectProviderModelsRequests.select(store.state)[providerId];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
let dispose: () => void;
let cancel: () => void;

beforeAll(async () => {
  await import('../../../seeders/model-catalog-bridge-seeder');
});
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  vi.mocked(notify.warning).mockClear();
  dispose = store.init();
  store.dispatch(
    providerCatalogLoaded({
      providers: ['codex', 'auggie'].map((id) => ({
        id,
        displayName: id,
        shortName: id,
        command: id,
        visible: true,
        canBeDisabled: true,
      })),
    }),
  );
  cancel = store.runSaga(modelReloadSaga);
});
afterEach(() => {
  cancel();
  dispose();
  vi.useRealTimers();
});

describe('registered model reload owner: picker catalogs', () => {
  it('keeps a shared read alive until the final observer releases and cancels debounce on teardown', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(providerModelsObserved('first', ['codex']));
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('first'));
    await vi.advanceTimersByTimeAsync(50);
    expect(status().status).toBe('loading');
    expect(request).toHaveBeenCalledExactlyOnceWith('models.list', { providerId: 'codex' });
    store.dispatch(providerModelsReleased('second'));
    expect(status().status).toBe('cancelled');
    finish(reply('codex', 'late'));
    await settle();
    expect(cache()).toBeUndefined();
    store.dispatch(providerModelsObserved('brief', ['codex']));
    store.dispatch(providerModelsReleased('brief'));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('cancels attached reads when the registered owner stops', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    cancel();
    expect(status().status).toBe('cancelled');
    finish(reply('codex', 'late'));
    await settle();
    expect(cache()).toBeUndefined();
  });

  it('settles silent retry failures and empty catalogs with one warning, then permits retry', async () => {
    request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ providerId: 'codex', models: [] })
      .mockResolvedValueOnce(reply('codex', 'recovered'));
    store.dispatch(providerModelsRequested('codex', 'silentRetry'));
    await settle();
    expect(status()).toMatchObject({ status: 'error', mode: 'silentRetry' });
    expect(notify.warning).toHaveBeenCalledTimes(1);
    store.dispatch(providerModelsRequested('codex', 'silentRetry'));
    await settle();
    expect(status().status).toBe('success');
    expect(notify.warning).toHaveBeenCalledTimes(2);
    expect(cache()).toBeUndefined();
    store.dispatch(providerModelsRequested('codex', 'silentRetry'));
    await settle();
    expect(cache()?.models[0].value).toBe('recovered');
    expect(notify.warning).toHaveBeenCalledTimes(2);
    expect(request.mock.calls).toEqual(
      Array.from({ length: 3 }, () => ['models.list', { providerId: 'codex' }]),
    );
  });

  it('coalesces mounted readers and preserves exact wire refresh, warning and stale results', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(providerModelsObserved('first', ['codex']));
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([['models.list', { providerId: 'codex' }]]);
    finish({ ...reply('codex', 'old'), warning: 'last-good catalog', stale: true });
    await settle();
    expect(cache()).toMatchObject({
      models: [{ value: 'old', label: 'old' }],
      warning: 'last-good catalog',
      stale: true,
    });
    expect(status().status).toBe('success');

    request.mockResolvedValue(reply('codex', 'fresh'));
    store.dispatch(providerModelsRequested('codex', 'refresh'));
    expect(status()).toMatchObject({ status: 'loading', mode: 'refresh' });
    await settle();
    expect(request.mock.calls.at(-1)).toEqual([
      'models.list',
      { providerId: 'codex', forceRefresh: true },
    ]);
    expect(cache()?.models[0].value).toBe('fresh');
    expect(cache()?.warning).toBeUndefined();
  });

  it('forced refresh wins over a delayed background reply and membership changes', async () => {
    let finishOld!: (value: unknown) => void;
    let finishRefresh!: (value: unknown) => void;
    request.mockImplementation((_method, params) => {
      if ((params as { providerId: string }).providerId === 'auggie')
        return Promise.resolve(reply('auggie', 'other'));
      return new Promise((resolve) => {
        if ((params as { forceRefresh?: boolean }).forceRefresh) finishRefresh = resolve;
        else finishOld = resolve;
      });
    });
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsRequested('codex', 'refresh'));
    store.dispatch(providerModelsObserved('picker', ['codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(50);
    finishRefresh(reply('codex', 'fresh'));
    await settle();
    finishOld(reply('codex', 'stale'));
    await settle();
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'codex', forceRefresh: true }],
      ['models.list', { providerId: 'auggie' }],
    ]);
    expect(cache()?.models[0].value).toBe('fresh');
  });

  it('invalidations during a fetch produce one non-overlapping trailing fetch', async () => {
    let finish!: (value: unknown) => void;
    request
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(reply('codex', 'reconnected'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsCacheCleared());
    store.dispatch(providerModelsCacheCleared());
    store.dispatch(providerModelsCacheCleared());
    expect(request).toHaveBeenCalledTimes(1);
    finish(reply('codex', 'stale'));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache()?.models[0].value).toBe('reconnected');
    expect(status().epoch).toBe(3);
  });

  it('settles failures for retry and cancels released observers without late cache writes', async () => {
    request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply('codex', 'retry'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(status()).toMatchObject({ status: 'error', error: expect.stringContaining('offline') });
    store.dispatch(providerModelsRequested('codex', 'retry'));
    await settle();
    expect(cache()?.models[0].value).toBe('retry');
    let finish!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(providerModelsRequested('codex', 'refresh'));
    store.dispatch(providerModelsReleased('picker'));
    expect(status().status).toBe('cancelled');
    finish(reply('codex', 'late'));
    await settle();
    expect(cache()?.models[0].value).toBe('retry');
    store.dispatch(providerModelsCacheCleared());
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('preserves the unchanged reload action and standalone model utility caller', async () => {
    request.mockResolvedValue(reply('codex', 'selected'));
    store.dispatch(hydrateDefaultProvider('codex'));
    store.dispatch(reloadModelsForProvider());
    await settle();
    expect(selectAvailableModels.select(store.state)[0].value).toBe('selected');
    expect(await getModelsForProvider('codex')).toEqual([
      { value: 'selected', label: 'selected', isDefault: true },
    ]);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'codex' }],
    ]);
  });
});
