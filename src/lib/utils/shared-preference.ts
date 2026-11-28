/**
 * Preferences that every view of one app must agree on.
 *
 * Each host's view is its own renderer with its own store, but all share one
 * localStorage. A view that reads a preference only at boot keeps a stale copy
 * and later saves it over another view's change. A shared preference follows
 * the `storage` event, so a change in one view reaches every other open view.
 *
 * `scripts/check-local-storage-scope.mjs` fails any other localStorage write
 * that does not declare why it needs no sync.
 */
import { safeLocalStorage } from './safe-storage';

/**
 * `app`: one value for every host view of this app.
 * `host`: one value per backend (a backend-namespaced key), shared by that host's views.
 */
export type SharedPreferenceScope = 'app' | 'host';

/** `json` stores `JSON.stringify(value)`; `text` stores `String(value)`. */
export type SharedPreferenceFormat = 'json' | 'text';

interface SharedPreferenceOptions<T> {
  key: string;
  scope: SharedPreferenceScope;
  format?: SharedPreferenceFormat;
  /** `text` format only: the text to store. The default is `String(value)`. */
  serialize?: (value: T) => string;
  /** The stored value (parsed JSON, or the raw text) as `T`; `undefined` when it is not valid. */
  parse: (stored: unknown) => T | undefined;
}

interface SharedPreference<T> {
  readonly key: string;
  readonly scope: SharedPreferenceScope;
  /** The valid stored value, read from storage now. */
  read(): T | undefined;
  write(value: T): void;
  remove(): void;
  /** Calls `listener` with the stored value each time another view changes it. */
  subscribe(listener: (value: T | undefined) => void): () => void;
}

type StorageChangeListener = (key: string | null, newValue: string | null) => void;

const listeners = new Set<StorageChangeListener>();

function isLocalStorageEvent(event: StorageEvent): boolean {
  if (!event.storageArea) return true;
  try {
    return event.storageArea === window.localStorage;
  } catch {
    return true;
  }
}

function handleStorageEvent(event: StorageEvent): void {
  if (!isLocalStorageEvent(event)) return;
  for (const listener of [...listeners]) {
    try {
      listener(event.key, event.newValue);
    } catch {
      // One failing listener must not stop the others.
    }
  }
}

/**
 * Calls `listener` with the changed key and its new text each time another
 * view of this app writes localStorage. A `null` key means storage was
 * cleared; a `null` text means the key was removed.
 */
export function onSharedStorageChange(listener: StorageChangeListener): () => void {
  if (typeof window === 'undefined') return () => {};
  if (listeners.size === 0) window.addEventListener('storage', handleStorageEvent);
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) window.removeEventListener('storage', handleStorageEvent);
  };
}

/** Whether a storage change for `changedKey` can have changed `key`. */
export function sharedStorageChangeAffects(changedKey: string | null, key: string): boolean {
  return changedKey === null || changedKey === key;
}

function readSharedPreferenceValue<T>(
  options: Pick<SharedPreferenceOptions<T>, 'format' | 'parse'>,
  key: string,
): T | undefined {
  const stored: unknown =
    options.format === 'text' ? safeLocalStorage.getItem(key) : safeLocalStorage.getJSON(key);
  return stored === null || stored === undefined ? undefined : options.parse(stored);
}

function writeSharedPreferenceValue<T>(
  options: Pick<SharedPreferenceOptions<T>, 'format' | 'serialize'>,
  key: string,
  value: T,
): void {
  if (options.format === 'text') {
    safeLocalStorage.setItem(key, options.serialize?.(value) ?? String(value));
  } else {
    safeLocalStorage.setJSON(key, value);
  }
}

/** A shared preference for code outside sagas. Sagas use `sharedPreferenceSaga`. */
export function sharedPreference<T>(options: SharedPreferenceOptions<T>): SharedPreference<T> {
  const { key, scope } = options;
  return {
    key,
    scope,
    read: () => readSharedPreferenceValue(options, key),
    write: (value) => writeSharedPreferenceValue(options, key, value),
    remove: () => safeLocalStorage.removeItem(key),
    subscribe: (listener) =>
      onSharedStorageChange((changedKey) => {
        if (sharedStorageChangeAffects(changedKey, key)) {
          listener(readSharedPreferenceValue(options, key));
        }
      }),
  };
}
