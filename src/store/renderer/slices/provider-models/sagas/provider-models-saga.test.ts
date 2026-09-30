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
import { selectAvailableModels, selectLoadError } from '../../model/model-selectors';
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
const cache = (providerId = 'codex', workspaceId?: string) =>
  selectProviderModelsCacheEntry.select(store.state, providerId, workspaceId);
const status = (providerId = 'codex', workspaceId?: string) =>
  selectProviderModelsRequests.select(store.state, workspaceId)[providerId];
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
  it('isolates concurrent direct, A and B catalogs, errors and forced refreshes on the wire', async () => {
    const releases = new Map<string, (value: ReturnType<typeof reply>) => void>();
    request.mockImplementation(
      (_method, params) =>
        new Promise((resolve) => {
          const { workspaceId } = params as { workspaceId?: string };
          releases.set(workspaceId ?? 'direct', resolve);
        }),
    );
    store.dispatch(providerModelsObserved('direct', ['codex']));
    store.dispatch(providerModelsObserved('A', ['codex'], 'A'));
    store.dispatch(providerModelsObserved('B', ['codex'], 'B'));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'B' }],
    ]);
    releases.get('B')!(reply('codex', 'B-model'));
    await settle();
    expect(cache('codex', 'B')?.models[0].value).toBe('B-model');
    expect(status('codex', 'A')?.status).toBe('loading');
    expect(status()?.status).toBe('loading');
    releases.get('A')!(reply('codex', 'A-model'));
    releases.get('direct')!(reply('codex', 'direct-model'));
    await settle();
    request.mockRejectedValueOnce(new Error('A failed'));
    store.dispatch(providerModelsRequested('codex', 'refresh', 'A'));
    await settle();
    expect(request).toHaveBeenLastCalledWith('models.list', {
      providerId: 'codex',
      workspaceId: 'A',
      forceRefresh: true,
    });
    expect(status('codex', 'A')?.error).toBe('codex: A failed');
    expect(status('codex', 'B')?.error).toBeUndefined();
    expect(status()?.error).toBeUndefined();
    expect(cache()?.models[0].value).toBe('direct-model');
    expect(cache('codex', 'A')?.models[0].value).toBe('A-model');
    expect(cache('codex', 'B')?.models[0].value).toBe('B-model');
    expect(selectLoadError.select(store.state)).toBeNull();
  });

  it('releases only the old workspace flight and rejects its late result after the observer switches', async () => {
    let releaseA!: (value: ReturnType<typeof reply>) => void;
    request.mockImplementation((_method, params) => {
      const { workspaceId } = params as { workspaceId?: string };
      return workspaceId === 'A'
        ? new Promise((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve(reply('codex', 'B-model'));
    });
    store.dispatch(providerModelsObserved('picker', ['codex'], 'A'));
    await vi.advanceTimersByTimeAsync(50);
    expect(status('codex', 'A')?.status).toBe('loading');
    store.dispatch(providerModelsObserved('picker', ['codex'], 'B'));
    await vi.advanceTimersByTimeAsync(50);
    expect(status('codex', 'A')?.status).toBe('cancelled');
    expect(status('codex', 'B')?.status).toBe('success');
    releaseA(reply('codex', 'stale-A'));
    await settle();
    expect(cache('codex', 'A')).toBeUndefined();
    expect(cache('codex', 'B')?.models[0].value).toBe('B-model');
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'B' }],
    ]);
  });

  it('deduplicates workspace membership without postponing admission or clearing another workspace failure', async () => {
    request.mockImplementation((_method, params) => {
      const { workspaceId } = params as { workspaceId?: string };
      return workspaceId === 'A'
        ? Promise.reject(new Error('A unavailable'))
        : Promise.resolve(reply('codex', 'B-model'));
    });
    store.dispatch(providerModelsObserved('A1', ['codex'], 'A'));
    store.dispatch(providerModelsObserved('B1', ['codex'], 'B'));
    await vi.advanceTimersByTimeAsync(25);
    store.dispatch(providerModelsObserved('A2', ['codex'], 'A'));
    store.dispatch(providerModelsReleased('A1'));
    await vi.advanceTimersByTimeAsync(25);
    expect(request).toHaveBeenCalledTimes(2);
    expect(status('codex', 'A')?.error).toBe('codex: A unavailable');
    store.dispatch(providerModelsObserved('A2', ['codex'], 'A'));
    store.dispatch(providerModelsObserved('B2', ['codex'], 'B'));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(2);
    store.dispatch(providerModelsRequested('codex', 'silentRetry', 'A'));
    await settle();
    expect(status('codex', 'A')?.error).toBe('codex: A unavailable');
    expect(status('codex', 'B')?.error).toBeUndefined();
    request.mockResolvedValueOnce(reply('codex', 'A-recovered'));
    store.dispatch(providerModelsRequested('codex', 'retry', 'A'));
    await settle();
    expect(status('codex', 'A')?.error).toBeUndefined();
    expect(cache('codex', 'A')?.models[0].value).toBe('A-recovered');
    expect(cache('codex', 'B')?.models[0].value).toBe('B-model');
    expect(request.mock.calls.slice(2)).toEqual([
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'A', forceRefresh: true }],
    ]);
  });

  it('clears scoped caches and coalesces invalidation independently for each workspace flight', async () => {
    const releases: Array<(value: ReturnType<typeof reply>) => void> = [];
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    store.dispatch(providerModelsObserved('A', ['codex'], 'A'));
    store.dispatch(providerModelsObserved('B', ['codex'], 'B'));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsCacheCleared());
    store.dispatch(providerModelsCacheCleared());
    releases[0](reply('codex', 'stale-A'));
    releases[1](reply('codex', 'stale-B'));
    await settle();
    expect(request).toHaveBeenCalledTimes(4);
    expect(cache('codex', 'A')).toBeUndefined();
    expect(cache('codex', 'B')).toBeUndefined();
    releases[2](reply('codex', 'fresh-A'));
    releases[3](reply('codex', 'fresh-B'));
    await settle();
    expect(cache('codex', 'A')?.models[0].value).toBe('fresh-A');
    expect(cache('codex', 'B')?.models[0].value).toBe('fresh-B');
    store.dispatch(providerModelsCacheCleared());
    expect(cache('codex', 'A')).toBeUndefined();
    expect(cache('codex', 'B')).toBeUndefined();
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'B' }],
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'B' }],
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
      ['models.list', { providerId: 'codex', workspaceId: 'B' }],
    ]);
  });

  it('does not refetch settled catalogs on shared release, identical observation, or no-op release', async () => {
    request.mockResolvedValue(reply('codex', 'cached'));
    store.dispatch(providerModelsObserved('first', ['codex']));
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    const cached = cache();
    const settled = status();

    store.dispatch(providerModelsReleased('first'));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('missing'));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([['models.list', { providerId: 'codex' }]]);
    expect(cache()).toBe(cached);
    expect(status()).toBe(settled);
  });

  it('loads initial missing catalogs after debounce without postponing for identical membership', async () => {
    request.mockResolvedValue(reply('codex', 'initial'));
    store.dispatch(providerModelsObserved('first', ['codex']));
    await vi.advanceTimersByTimeAsync(25);
    store.dispatch(providerModelsObserved('first', ['codex']));
    store.dispatch(providerModelsObserved('second', ['codex']));
    store.dispatch(providerModelsReleased('first'));
    store.dispatch(providerModelsReleased('missing'));
    await vi.advanceTimersByTimeAsync(24);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request.mock.calls).toEqual([['models.list', { providerId: 'codex' }]]);
    expect(cache()?.models[0].value).toBe('initial');
  });

  it('fetches only new missing membership and reuses settled catalogs across removal and remount', async () => {
    request.mockImplementation((_method, params) => {
      const { providerId } = params as { providerId: string };
      return Promise.resolve(reply(providerId, providerId));
    });
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('picker', ['codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'auggie' }],
    ]);
    store.dispatch(providerModelsObserved('picker', ['auggie', 'codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('picker'));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('remounted', ['codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache()?.models[0].value).toBe('codex');
    expect(cache('auggie')?.models[0].value).toBe('auggie');
  });

  it('retains every new missing member across a debounced membership burst', async () => {
    request.mockImplementation((_method, params) => {
      const { providerId } = params as { providerId: string };
      return Promise.resolve(reply(providerId, providerId));
    });
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(25);
    store.dispatch(providerModelsObserved('picker', ['codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(49);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'auggie' }],
    ]);
  });

  it('drops released pending members without losing the remaining debounced admission', async () => {
    request.mockResolvedValue(reply('auggie', 'remaining'));
    store.dispatch(providerModelsObserved('brief', ['codex']));
    store.dispatch(providerModelsObserved('remaining', ['auggie']));
    await vi.advanceTimersByTimeAsync(25);
    store.dispatch(providerModelsReleased('brief'));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([['models.list', { providerId: 'auggie' }]]);
    expect(cache()).toBeUndefined();
    expect(cache('auggie')?.models[0].value).toBe('remaining');
  });

  it('cancels pending observation work on owner teardown and admits existing membership on restart', async () => {
    request.mockResolvedValue(reply('codex', 'restarted'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(25);
    cancel();
    await vi.advanceTimersByTimeAsync(50);
    expect(request).not.toHaveBeenCalled();
    cancel = store.runSaga(modelReloadSaga);
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([['models.list', { providerId: 'codex' }]]);
    expect(cache()?.models[0].value).toBe('restarted');
  });

  it('does not implicitly retry a settled failure for unchanged membership or unrelated member changes', async () => {
    request
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply('auggie', 'unaffected'))
      .mockResolvedValueOnce(reply('codex', 'recovered'));
    store.dispatch(providerModelsObserved('first', ['codex']));
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    const failed = status();
    expect(failed).toMatchObject({ status: 'error', error: expect.stringContaining('offline') });
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('first'));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('missing'));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('second', ['codex', 'auggie']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('second', ['auggie', 'codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsObserved('second', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(status()).toBe(failed);
    expect(cache()).toBeUndefined();
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'auggie' }],
    ]);

    store.dispatch(providerModelsRequested('codex', 'retry'));
    await settle();
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'auggie' }],
      ['models.list', { providerId: 'codex', forceRefresh: true }],
    ]);
    expect(status()).toMatchObject({ status: 'success', error: undefined });
    expect(cache()?.models[0].value).toBe('recovered');
  });

  it.each(['error', 'cancelled'] as const)(
    'fetches newly re-observed missing catalogs after a prior %s, including a membership burst',
    async (priorStatus) => {
      let finish!: (value: unknown) => void;
      if (priorStatus === 'error') request.mockRejectedValueOnce(new Error('offline'));
      else
        request.mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve;
          }),
        );
      store.dispatch(providerModelsObserved('picker', ['codex']));
      await vi.advanceTimersByTimeAsync(50);
      store.dispatch(providerModelsReleased('picker'));
      expect(status().status).toBe(priorStatus);
      request.mockImplementation((_method, params) => {
        const { providerId } = params as { providerId: string };
        return Promise.resolve(reply(providerId, 'recovered'));
      });
      store.dispatch(providerModelsObserved('picker', ['codex']));
      await vi.advanceTimersByTimeAsync(25);
      store.dispatch(providerModelsObserved('picker', ['codex', 'auggie']));
      await vi.advanceTimersByTimeAsync(50);
      if (priorStatus === 'cancelled') {
        finish(reply('codex', 'late'));
        await settle();
      }
      expect(request.mock.calls).toEqual([
        ['models.list', { providerId: 'codex' }],
        ['models.list', { providerId: 'codex' }],
        ['models.list', { providerId: 'auggie' }],
      ]);
      expect(cache()?.models[0].value).toBe('recovered');
    },
  );

  it('reuses an empty settled catalog until an independent cache clear reloads observed membership', async () => {
    request
      .mockResolvedValueOnce({ providerId: 'codex', models: [] })
      .mockResolvedValue(reply('codex', 'after-clear'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(cache()?.models).toEqual([]);
    store.dispatch(providerModelsReleased('picker'));
    store.dispatch(providerModelsObserved('remounted', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(1);
    store.dispatch(providerModelsCacheCleared());
    await settle();
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'codex' }],
    ]);
    expect(cache()?.models[0].value).toBe('after-clear');
  });

  it('fetches a cleared catalog on the next observation without requesting unobserved providers', async () => {
    request.mockResolvedValueOnce(reply('codex', 'old')).mockResolvedValue(reply('codex', 'new'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    store.dispatch(providerModelsReleased('picker'));
    store.dispatch(providerModelsCacheCleared());
    await vi.advanceTimersByTimeAsync(50);
    expect(cache()).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    store.dispatch(providerModelsObserved('remounted', ['codex']));
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex' }],
      ['models.list', { providerId: 'codex' }],
    ]);
    expect(cache()?.models[0].value).toBe('new');
  });

  it('joins a request already loading when membership arrives without retrying its later failure', async () => {
    let reject!: (reason: Error) => void;
    request.mockReturnValueOnce(
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
    );
    store.dispatch(providerModelsRequested('codex', 'refresh'));
    store.dispatch(providerModelsObserved('picker', ['codex']));
    reject(new Error('offline'));
    await settle();
    const failed = status();
    await vi.advanceTimersByTimeAsync(50);
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex', forceRefresh: true }],
    ]);
    expect(status()).toBe(failed);
    expect(failed).toMatchObject({ status: 'error', error: expect.stringContaining('offline') });
  });

  it.each(['retry', 'refresh', 'clear'] as const)(
    'does not duplicate an independent failed %s completed during the observation debounce',
    async (trigger) => {
      request.mockRejectedValue(new Error('offline'));
      store.dispatch(providerModelsObserved('picker', ['codex']));
      await vi.advanceTimersByTimeAsync(25);
      store.dispatch(
        trigger === 'clear'
          ? providerModelsCacheCleared()
          : providerModelsRequested('codex', trigger),
      );
      await settle();
      const failed = status();
      await vi.advanceTimersByTimeAsync(50);
      expect(request.mock.calls).toEqual([
        [
          'models.list',
          trigger !== 'clear'
            ? { providerId: 'codex', forceRefresh: true }
            : { providerId: 'codex' },
        ],
      ]);
      expect(status()).toBe(failed);
      expect(failed.status).toBe('error');
    },
  );

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

  it('preserves degraded catalog metadata through a silent retry', async () => {
    request.mockResolvedValue({
      ...reply('codex', 'older'),
      warning: 'probe failed; serving last-good models',
      stale: true,
    });
    store.dispatch(providerModelsRequested('codex', 'silentRetry', 'A'));
    await settle();
    expect(cache('codex', 'A')).toMatchObject({
      models: [{ value: 'older' }],
      warning: 'probe failed; serving last-good models',
      stale: true,
    });
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex', workspaceId: 'A' }],
    ]);
  });

  it('coalesces explicit retries and forces a fresh probe in the same workspace', async () => {
    let finish!: (value: unknown) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(providerModelsRequested('codex', 'retry', 'A'));
    store.dispatch(providerModelsRequested('codex', 'retry', 'A'));
    expect(request.mock.calls).toEqual([
      ['models.list', { providerId: 'codex', workspaceId: 'A', forceRefresh: true }],
    ]);
    finish(reply('codex', 'recovered'));
    await settle();
    expect(cache('codex', 'A')?.models[0].value).toBe('recovered');
    expect(cache('codex', 'B')).toBeUndefined();
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

  it.each(['silentRetry', 'retry'] as const)(
    'preserves a background failure through failed and empty silent retries, then recovers via %s',
    async (recoveryMode) => {
      request.mockImplementation((_method, params) =>
        (params as { providerId: string }).providerId === 'auggie'
          ? Promise.resolve(reply('auggie', 'unaffected'))
          : Promise.reject(new Error('background offline')),
      );
      store.dispatch(providerModelsObserved('picker', ['codex', 'auggie']));
      await vi.advanceTimersByTimeAsync(50);
      const failure = status().error;
      const otherRequest = status('auggie');
      const otherCache = cache('auggie');
      expect(failure).toContain('background offline');
      expect(selectLoadError.select(store.state, 'codex')).toBe(failure);

      let rejectRetry!: (reason: Error) => void;
      request.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
      );
      store.dispatch(providerModelsRequested('codex', 'silentRetry'));
      expect(status()).toMatchObject({ status: 'loading', error: failure });
      expect(selectLoadError.select(store.state, 'codex')).toBe(failure);
      rejectRetry(new Error('silent offline'));
      await settle();
      expect(status()).toMatchObject({ status: 'error', error: failure });
      expect(notify.warning).toHaveBeenCalledTimes(1);

      request.mockResolvedValueOnce({ providerId: 'codex', models: [] });
      store.dispatch(providerModelsRequested('codex', 'silentRetry'));
      await settle();
      expect(status()).toMatchObject({ status: 'success', error: failure });
      expect(cache()).toBeUndefined();
      expect(notify.warning).toHaveBeenCalledTimes(2);

      request.mockResolvedValueOnce(reply('codex', 'recovered'));
      store.dispatch(providerModelsRequested('codex', recoveryMode));
      await settle();
      expect(status()).toMatchObject({ status: 'success', error: undefined });
      expect(selectLoadError.select(store.state, 'codex')).toBeNull();
      expect(cache()?.models).toEqual([
        { value: 'recovered', label: 'recovered', isDefault: true },
      ]);
      expect(status('auggie')).toBe(otherRequest);
      expect(cache('auggie')).toBe(otherCache);
      expect(notify.warning).toHaveBeenCalledTimes(2);
      expect(request.mock.calls).toEqual([
        ['models.list', { providerId: 'codex' }],
        ['models.list', { providerId: 'auggie' }],
        ...Array.from({ length: 2 }, () => ['models.list', { providerId: 'codex' }]),
        [
          'models.list',
          { providerId: 'codex', ...(recoveryMode === 'retry' ? { forceRefresh: true } : {}) },
        ],
      ]);
    },
  );

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
