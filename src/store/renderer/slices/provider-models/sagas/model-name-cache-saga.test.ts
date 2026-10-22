import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeLocalStorage } from '$lib/utils/safe-storage';
import { store } from '../../../store';
import { MODEL_NAMES_STORAGE_KEY } from '../model-name-cache';
import { selectLearnedModelDisplayName } from '../provider-models-selectors';
import { providerModelsCacheCleared, providerModelsLoaded } from '../provider-models-slice';
import { setAvailableModels } from '../../model/model-slice';
import { modelNameCacheSaga } from './model-name-cache-saga';

let dispose: () => void;
let cancel: () => void;
const boot = () => {
  dispose = store.init();
  cancel = store.runSaga(modelNameCacheSaga);
};
const lookup = (provider: string, id: string) =>
  selectLearnedModelDisplayName.select(store.state, provider, id);
const discover = (label = 'Remembered model', epoch = 0) =>
  store.dispatch(
    providerModelsLoaded(
      'pi',
      {
        models: [{ value: 'vendor/model', label, isDefault: true, effortLevels: ['high'] }],
      },
      epoch,
      'workspace-A',
    ),
  );

const storage = new Map<string, string>();
const read = (key: string) => storage.get(key) ?? null;
const write = (key: string, value: string) => {
  storage.set(key, value);
};
beforeEach(() => {
  storage.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation(read);
  vi.mocked(window.localStorage.setItem).mockImplementation(write);
});
afterEach(() => {
  cancel?.();
  dispose?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('model name persistence lifecycle', () => {
  it('learns, persists only names, then hydrates synchronously into a new store without catalogs', () => {
    boot();
    discover();
    expect(JSON.parse(window.localStorage.getItem(MODEL_NAMES_STORAGE_KEY)!)).toEqual({
      version: 1,
      names: { pi: { 'vendor/model': 'Remembered model' } },
    });
    cancel();
    dispose();
    boot();
    expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
    expect(lookup('pi', 'never-seen')).toBeUndefined();
    expect(store.state.providerModels.byProviderId).toEqual({});
    expect(store.state.providerModels.byWorkspaceId).toEqual({});
    expect(store.state.model.availableModels.ids).toEqual([]);
    const read = vi.spyOn(safeLocalStorage, 'getJSON');
    expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
    expect(read).not.toHaveBeenCalled();
  });

  it('writes active catalog updates but never overwrites storage on clears, stale responses or unchanged names', () => {
    boot();
    discover();
    const write = vi.spyOn(safeLocalStorage, 'setJSON');
    discover();
    store.dispatch(providerModelsCacheCleared());
    discover('Rejected name');
    expect(write).not.toHaveBeenCalled();
    expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
    store.dispatch(setAvailableModels([{ value: 'vendor/model', label: 'New name' }], 'pi'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(MODEL_NAMES_STORAGE_KEY)!).names.pi).toEqual({
      'vendor/model': 'New name',
    });
  });

  it.each(['not json', 'null', '{"version":999,"names":{"pi":{"x":"Wrong"}}}'])(
    'recovers from invalid storage: %s',
    (stored) => {
      window.localStorage.setItem(MODEL_NAMES_STORAGE_KEY, stored);
      boot();
      expect(lookup('pi', 'x')).toBeUndefined();
      discover();
      expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
      expect(JSON.parse(window.localStorage.getItem(MODEL_NAMES_STORAGE_KEY)!).version).toBe(1);
    },
  );

  it('keeps learning after denied reads and quota failures, then persists the full cache on recovery', () => {
    const get = vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error('quota');
    });
    boot();
    discover();
    expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
    get.mockImplementation(read);
    set.mockImplementation(write);
    store.dispatch(setAvailableModels([{ value: 'second', label: 'Second model' }], 'pi'));
    expect(JSON.parse(window.localStorage.getItem(MODEL_NAMES_STORAGE_KEY)!).names.pi).toEqual({
      'vendor/model': 'Remembered model',
      second: 'Second model',
    });
  });

  it('works in memory when there is no window', () => {
    vi.stubGlobal('window', undefined);
    boot();
    discover();
    expect(lookup('pi', 'vendor/model')).toBe('Remembered model');
  });
});
