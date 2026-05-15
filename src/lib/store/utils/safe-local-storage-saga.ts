import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  call,
  type SagaGenerator,
} from "typed-redux-saga";

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

export function* setLocalStorageItem(
  key: string,
  value: string
): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.setItem], key, value);
  } catch {
    // safeLocalStorage.setItem already handles errors internally,
    // but catch here too for saga-level safety.
  }
}

export function* setLocalStorageJSON(key: string, value: unknown): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.setJSON], key, value);
  } catch {
    // safeLocalStorage.setJSON already handles errors internally,
    // but catch here too for saga-level safety.
  }
}

export function* removeLocalStorageItem(key: string): SagaGenerator<void> {
  try {
    yield* call([safeLocalStorage, safeLocalStorage.removeItem], key);
  } catch {
    // safeLocalStorage.removeItem already handles errors internally,
    // but catch here too for saga-level safety.
  }
}

export function* getLocalStorageKeysWithPrefix(prefix: string): SagaGenerator<string[]> {
  try {
    return yield* call([safeLocalStorage, safeLocalStorage.keysWithPrefix], prefix);
  } catch {
    return [];
  }
}