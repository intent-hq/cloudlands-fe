import { safeLocalStorage } from "$lib/utils/safe-storage";
import { call, type SagaGenerator } from "typed-redux-saga";

export function* getLocalStorageItem(key: string): SagaGenerator<string | null> {
  return yield* call([safeLocalStorage, safeLocalStorage.getItem], key);
}

export function* setLocalStorageItem(
  key: string,
  value: string
): SagaGenerator<void> {
  yield* call([safeLocalStorage, safeLocalStorage.setItem], key, value);
}

export function* removeLocalStorageItem(key: string): SagaGenerator<void> {
  yield* call([safeLocalStorage, safeLocalStorage.removeItem], key);
}