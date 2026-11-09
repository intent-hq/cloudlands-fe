import { vi, type Mock } from 'vitest';

export interface LocalStorageMock extends Storage {
  getItem: Mock<Storage['getItem']>;
  setItem: Mock<Storage['setItem']>;
  removeItem: Mock<Storage['removeItem']>;
  clear: Mock<Storage['clear']>;
  key: Mock<Storage['key']>;
  /** Clears the backing store AND resets all mock call history. */
  reset(): void;
  /** Clears the backing store without recording a call or touching call history. */
  clearValues(): void;
}

/**
 * Creates a functional in-memory localStorage mock backed by a Map.
 * All methods are `vi.fn()` wrappers with real implementations,
 * so tests can both spy on calls AND get real storage behavior.
 * Like Web Storage, stored keys are enumerable own properties
 * (`Object.keys(localStorage)`) and the methods are not.
 */
export function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>();
  const mock = {} as LocalStorageMock;

  const sync = (key: string): void => {
    if (Object.prototype.hasOwnProperty.call(methods, key) || key === 'length') return;
    if (store.has(key)) {
      Object.defineProperty(mock, key, {
        value: store.get(key),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      delete (mock as unknown as Record<string, unknown>)[key];
    }
  };

  const clearValues = (): void => {
    const keys = Array.from(store.keys());
    store.clear();
    keys.forEach(sync);
  };

  const getItem = vi.fn((key: string): string | null => {
    return store.get(String(key)) ?? null;
  });

  const setItem = vi.fn((key: string, value: string): void => {
    store.set(String(key), String(value));
    sync(String(key));
  });

  const removeItem = vi.fn((key: string): void => {
    store.delete(String(key));
    sync(String(key));
  });

  const clear = vi.fn((): void => {
    clearValues();
  });

  const key = vi.fn((index: number): string | null => {
    const keys = Array.from(store.keys());
    return keys[index] ?? null;
  });

  const methods = {
    getItem,
    setItem,
    removeItem,
    clear,
    key,
    clearValues,
    reset() {
      clearValues();
      getItem.mockClear();
      setItem.mockClear();
      removeItem.mockClear();
      clear.mockClear();
      key.mockClear();
    },
  };

  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(mock, name, {
      value,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(mock, 'length', {
    get: () => store.size,
    enumerable: false,
    configurable: true,
  });

  return mock;
}

/**
 * The in-memory localStorage that src/test-setup.ts installs on `window` for every test file.
 * Values are cleared before each test; use it to reach the spies and `reset()` with types.
 */
export function sharedLocalStorageMock(): LocalStorageMock {
  return window.localStorage as LocalStorageMock;
}
