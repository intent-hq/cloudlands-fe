import { vi } from 'vitest';

export interface LocalStorageMock extends Storage {
  /** Clears the backing store AND resets all mock call history. */
  reset(): void;
}

/**
 * Creates a functional in-memory localStorage mock backed by a Map.
 * All methods are `vi.fn()` wrappers with real implementations,
 * so tests can both spy on calls AND get real storage behavior.
 */
export function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>();

  const getItem = vi.fn((key: string): string | null => {
    return store.get(key) ?? null;
  });

  const setItem = vi.fn((key: string, value: string): void => {
    store.set(key, String(value));
  });

  const removeItem = vi.fn((key: string): void => {
    store.delete(key);
  });

  const clear = vi.fn((): void => {
    store.clear();
  });

  const key = vi.fn((index: number): string | null => {
    const keys = Array.from(store.keys());
    return keys[index] ?? null;
  });

  const mock: LocalStorageMock = {
    getItem,
    setItem,
    removeItem,
    clear,
    key,
    get length() {
      return store.size;
    },
    reset() {
      store.clear();
      getItem.mockClear();
      setItem.mockClear();
      removeItem.mockClear();
      clear.mockClear();
      key.mockClear();
    },
  };

  return mock;
}

/**
 * Creates a localStorage mock and installs it on `window.localStorage`
 * via `Object.defineProperty`. Returns the mock for direct access.
 *
 * Works for both `window.localStorage` and `global.localStorage`
 * (they reference the same object in jsdom).
 */
export function installLocalStorageMock(): LocalStorageMock {
  const mock = createLocalStorageMock();

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: mock,
  });

  return mock;
}

