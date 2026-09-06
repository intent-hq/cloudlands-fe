import { describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const storage = new Map<string, string>();
let throwOnRead = false;

vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => {
      if (throwOnRead) throw new Error('storage unavailable');
      return storage.get(key) ?? null;
    },
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    keysWithPrefix: (prefix: string) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
    getJSON: <T>(key: string) => {
      const value = storage.get(key);
      return value === undefined ? undefined : (JSON.parse(value) as T);
    },
    setJSON: (key: string, value: unknown) => storage.set(key, JSON.stringify(value)),
  },
}));

import {
  getLocalStorageItem,
  getLocalStorageJSON,
  getLocalStorageKeysWithPrefix,
  removeLocalStorageItem,
  setLocalStorageItem,
  setLocalStorageJSON,
} from './safe-local-storage-saga';

describe('safe local-storage saga utilities', () => {
  it('round-trips values and enumerates keys through saga effects', async () => {
    storage.clear();
    storage.set('saga:existing', 'value');

    function* root() {
      yield* setLocalStorageItem('saga:item', 'text');
      yield* setLocalStorageJSON('saga:json', { enabled: true });
      const text = yield* getLocalStorageItem('saga:item');
      const json = yield* getLocalStorageJSON<{ enabled: boolean }>('saga:json');
      const keys = yield* getLocalStorageKeysWithPrefix('saga:');
      yield* removeLocalStorageItem('saga:item');
      return { text, json, keys };
    }

    const task = runSaga({ dispatch: () => {}, getState: () => ({}) }, root);
    await expect(task.toPromise()).resolves.toEqual({
      text: 'text',
      json: { enabled: true },
      keys: ['saga:existing', 'saga:item', 'saga:json'],
    });
    expect(storage.has('saga:item')).toBe(false);
  });

  it('returns safe fallbacks when storage is unavailable', async () => {
    throwOnRead = true;
    try {
      function* root() {
        return yield* getLocalStorageItem('saga:missing');
      }
      const task = runSaga({ dispatch: () => {}, getState: () => ({}) }, root);
      await expect(task.toPromise()).resolves.toBeNull();
    } finally {
      throwOnRead = false;
    }
  });
});
