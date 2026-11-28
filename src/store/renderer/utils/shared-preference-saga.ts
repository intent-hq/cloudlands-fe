/**
 * Saga side of a shared preference: it loads the value at boot, saves it on
 * change, and loads it again when another view of this app changes it. See
 * `$lib/utils/shared-preference` for why every per-app and per-host
 * preference goes through here.
 */
import type { Action, ActionPattern } from '@redux-saga/types';
import { buffers, eventChannel } from 'redux-saga';
import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  onSharedStorageChange,
  type SharedPreferenceFormat,
  type SharedPreferenceScope,
} from '$lib/utils/shared-preference';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageItem,
  setLocalStorageJSON,
} from './safe-local-storage-saga';

type SharedPreferenceSource = 'boot' | 'storage';

type Hydration = Action | readonly Action[] | null | undefined;

export interface SharedPreferenceSagaOptions<T> {
  /** A fixed key, or a saga for a key that depends on state (`null`: no key yet). */
  key: string | (() => SagaGenerator<string | null>);
  scope: SharedPreferenceScope;
  format?: SharedPreferenceFormat;
  /** `text` format only: the text to store. The default is `String(value)`. */
  serialize?: (value: T) => string;
  /** The stored value (parsed JSON, or the raw text) as `T`; `undefined` when it is not valid. */
  parse: (stored: unknown) => T | undefined;
  /**
   * The actions that put the stored value into the store; `undefined` means
   * nothing valid is stored. These actions never save the value back.
   */
  hydrate: (
    value: T | undefined,
    source: SharedPreferenceSource,
  ) => Hydration | SagaGenerator<Hydration>;
  /** The actions after which the value is saved. Needs `select` or `fromAction`. */
  persistOn?: ActionPattern;
  /** The value to save, read from the store; `undefined` skips the save. */
  select?: () => T | undefined | SagaGenerator<T | undefined>;
  /** The value to save, read from the action that asked for the save. Used instead of `select`. */
  fromAction?: (action: Action) => T | undefined;
}

const hydrationActions = new WeakSet<object>();

/** True for an action a shared preference dispatched to load a stored value. */
export function isSharedPreferenceHydration(action: unknown): boolean {
  return typeof action === 'object' && action !== null && hydrationActions.has(action);
}

function isSaga<R>(value: R | SagaGenerator<R>): value is SagaGenerator<R> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { next?: unknown }).next === 'function'
  );
}

function* resolveKey<T>(options: SharedPreferenceSagaOptions<T>): SagaGenerator<string | null> {
  return typeof options.key === 'string' ? options.key : yield* options.key();
}

/** Loads the stored value into the store. A failure is ignored: loading is best-effort. */
export function* hydrateSharedPreference<T>(
  options: SharedPreferenceSagaOptions<T>,
  source: SharedPreferenceSource = 'boot',
): SagaGenerator<void> {
  try {
    const key = yield* resolveKey(options);
    if (key === null) return;
    const stored: unknown =
      options.format === 'text'
        ? yield* call(getLocalStorageItem, key)
        : yield* call(getLocalStorageJSON<unknown>, key);
    // An asynchronous storage adapter can answer after the key changed.
    if (typeof options.key !== 'string' && (yield* resolveKey(options)) !== key) return;
    const value = stored === null || stored === undefined ? undefined : options.parse(stored);
    const result = options.hydrate(value, source);
    const hydration: Hydration = isSaga(result) ? yield* result : result;
    if (!hydration) return;
    const actions = Array.isArray(hydration)
      ? (hydration as readonly Action[])
      : [hydration as Action];
    for (const action of actions) {
      hydrationActions.add(action);
      yield* put(action);
    }
  } catch {
    // Malformed or unavailable storage must not stop the caller.
  }
}

/** Saves the current value. A failure is ignored: the watcher must stay alive. */
export function* persistSharedPreference<T>(
  options: SharedPreferenceSagaOptions<T>,
  action?: Action,
): SagaGenerator<void> {
  const { select: selectValue, fromAction } = options;
  if (!selectValue && !(fromAction && action)) return;
  try {
    const key = yield* resolveKey(options);
    if (key === null) return;
    let value: T | undefined;
    if (fromAction && action) {
      value = fromAction(action);
    } else if (selectValue) {
      const selected = selectValue();
      value = isSaga(selected) ? yield* selected : selected;
    }
    if (value === undefined) return;
    if (options.format === 'text') {
      yield* call(setLocalStorageItem, key, options.serialize?.(value) ?? String(value));
    } else {
      yield* call(setLocalStorageJSON, key, value);
    }
  } catch {
    // Storage failures are non-fatal.
  }
}

function* watchSharedPreferenceStorage<T>(
  options: SharedPreferenceSagaOptions<T>,
): SagaGenerator<void> {
  const changes = eventChannel<string>(
    (emit) => onSharedStorageChange((key) => emit(key ?? '')),
    buffers.expanding<string>(8),
  );
  try {
    while (true) {
      const changedKey = yield* take(changes);
      // '' means storage was cleared.
      if (changedKey !== '' && changedKey !== (yield* resolveKey(options))) continue;
      yield* hydrateSharedPreference(options, 'storage');
    }
  } finally {
    changes.close();
  }
}

/**
 * Follows a preference a non-saga module owns: `subscribe` reports each value
 * another view saved, and `hydrate` gives the action that puts it in the store.
 */
export function* followSharedPreference<T>(
  subscribe: (listener: (value: T) => void) => () => void,
  hydrate: (value: T) => Action,
): SagaGenerator<void> {
  const changes = eventChannel<{ value: T }>(
    (emit) => subscribe((value) => emit({ value })),
    buffers.sliding<{ value: T }>(1),
  );
  try {
    while (true) {
      const { value } = yield* take(changes);
      const action = hydrate(value);
      hydrationActions.add(action);
      yield* put(action);
    }
  } finally {
    changes.close();
  }
}

/** Saves on change and follows other views, without the boot load. */
export function* watchSharedPreference<T>(
  options: SharedPreferenceSagaOptions<T>,
): SagaGenerator<void> {
  if (options.persistOn && (options.select || options.fromAction)) {
    yield* takeEvery(options.persistOn, function* (action: Action) {
      // A loaded value is already in storage; saving it again can overwrite a newer one.
      if (!isSharedPreferenceHydration(action)) yield* persistSharedPreference(options, action);
    });
  }
  yield* fork(function* () {
    yield* watchSharedPreferenceStorage(options);
  });
}

/**
 * Loads the preference, then keeps it saved and in step with other views.
 * Run it with `yield*`: it returns after the boot load and leaves its watchers
 * attached to the calling saga.
 */
export function* sharedPreferenceSaga<T>(
  options: SharedPreferenceSagaOptions<T>,
): SagaGenerator<void> {
  yield* hydrateSharedPreference(options, 'boot');
  yield* watchSharedPreference(options);
}
