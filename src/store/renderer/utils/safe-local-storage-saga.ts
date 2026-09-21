import { call, type SagaGenerator } from 'typed-redux-saga';

import { safeLocalStorage } from '$lib/utils/safe-storage';

export function* getLocalStorageItem(key: string): SagaGenerator<string | null> {
  try {
    return yield* call([safeLocalStorage, safeLocalStorage.getItem], key);
  } catch {
    return null;
  }
}

export function* getLocalStorageJSON<T>(key: string): SagaGenerator<T | undefined> {
  try {
    return (yield* call([safeLocalStorage, safeLocalStorage.getJSON], key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export function* setLocalStorageItem(key: string, value: string): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.setItem], key, value);
  } catch {
    // safeLocalStorage handles storage failures; preserve saga-level safety too.
  }
}

export function* setLocalStorageJSON(key: string, value: unknown): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.setJSON], key, value);
  } catch {
    // safeLocalStorage handles serialization and storage failures.
  }
}

export function* removeLocalStorageItem(key: string): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.removeItem], key);
  } catch {
    // safeLocalStorage handles storage failures.
  }
}

export function* getLocalStorageKeysWithPrefix(prefix: string): SagaGenerator<string[]> {
  try {
    return yield* call([safeLocalStorage, safeLocalStorage.keysWithPrefix], prefix);
  } catch {
    return [];
  }
}
