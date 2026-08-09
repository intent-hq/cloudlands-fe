---
name: core/local-storage
description: >-
  App-local safe localStorage access from sagas. getLocalStorageItem /
  setLocalStorageItem / removeLocalStorageItem / getLocalStorageKeysWithPrefix
  (plus getLocalStorageJSON / setLocalStorageJSON) wrap window.localStorage in
  try/catch so quota and private-browsing errors cannot crash a saga. Covers the init-saga pattern
  (load defaults on startup, merge with persisted JSON) and the persistence-
  saga pattern (takeEvery on write actions → read selector → setLocalStorage-
  Item). These helpers are example/app-local utilities, not package exports.
  Never call window.localStorage directly from a saga or component.
type: sub-skill
requires:
  - core
  - core/sagas
triggers:
  - localStorage saga
  - persist preference
  - init saga
  - set local storage
---
# localStorage — safe access from sagas

> Use a concrete app-local helper module such as `examples/utils/safe-local-storage-saga.ts` — never call `window.localStorage` directly in sagas or components, and do not import localStorage helpers from the package.

Source: `../SKILL.md §15`, `examples/utils/safe-local-storage-saga.ts`.

## API

```typescript
import {
  getLocalStorageItem,     // yield* call(getLocalStorageItem, key) → string | null
  setLocalStorageItem,     // yield* call(setLocalStorageItem, key, value)
  removeLocalStorageItem,  // yield* call(removeLocalStorageItem, key)
  getLocalStorageKeysWithPrefix, // yield* call(getLocalStorageKeysWithPrefix, prefix) → string[]
  getLocalStorageJSON,     // yield* call(getLocalStorageJSON<T>, key) → T | undefined
  setLocalStorageJSON,     // yield* call(setLocalStorageJSON, key, value)
} from "../utils/safe-local-storage-saga";
```

Every helper is wrapped in try/catch at the saga layer — quota errors, `SecurityError` in private browsing, key enumeration failures, and JSON-parse failures are swallowed. Reads return `null` / `undefined` on failure, prefix key reads return `[]`, and writes become no-ops.

### Signatures

```typescript
function* getLocalStorageItem(key: string): SagaGenerator<string | null>;
function* setLocalStorageItem(key: string, value: string): SagaGenerator<void>;
function* removeLocalStorageItem(key: string): SagaGenerator<void>;
function* getLocalStorageKeysWithPrefix(prefix: string): SagaGenerator<string[]>;
function* getLocalStorageJSON<T>(key: string): SagaGenerator<T | undefined>;
function* setLocalStorageJSON(key: string, value: unknown): SagaGenerator<void>;
```

## Core Patterns

### 1. Init saga — load defaults on startup

```typescript
const STORAGE_KEY = "my-feature-settings";
const defaults = { theme: "dark", fontSize: 14 };

function* loadFromLocalStorage() {
  try {
    const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (stored) return { ...defaults, ...JSON.parse(stored) };
  } catch {
    /* Ignore parse errors */
  }
  return defaults;
}

export function* initSaga() {
  const settings = yield* call(loadFromLocalStorage);
  yield* put(loadSettings(settings));
}
```

> The { ...defaults, ...JSON.parse(stored) } merge keeps older payloads working when new fields are added.

### 2. Persistence saga — watch actions, save on change

```typescript
function* persistValue() {
  try {
    const value = yield* selectMyValue.effect();
    yield* call(setLocalStorageItem, STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Ignore storage errors */
  }
}

export function* persistenceSaga() {
  yield* takeEvery([setMyValue], persistValue);
}
```

### 3. Remove a key

```typescript
yield* call(removeLocalStorageItem, STORAGE_KEY);
```

### 4. Using the JSON helpers

```typescript
// Read a typed value — returns undefined if missing or unparseable
const prefs = yield* call(getLocalStorageJSON<UserPrefs>, PREFS_KEY);

// Write a typed value
yield* call(setLocalStorageJSON, PREFS_KEY, nextPrefs);
```

### 5. Listing keys by prefix

```typescript
const draftKeys = yield* call(getLocalStorageKeysWithPrefix, "drafts/");
for (const key of draftKeys) {
  yield* call(removeLocalStorageItem, key);
}
```

## Rules

- ✅ Always use a concrete app-local saga helper module (for example `examples/utils/safe-local-storage-saga.ts`).
- ✅ Keep storage keys as constants at the top of the file.
- ✅ Use `getLocalStorageKeysWithPrefix(prefix)` for helper-safe key enumeration.
- ❌ Never import localStorage helpers from `@augmentcode/themis/saga` or package utility subpaths.
- ❌ **Never** call `window.localStorage` directly in sagas.
- ❌ **Never** put localStorage calls in components — they belong in sagas.
- ❌ Never assume localStorage always succeeds — it can throw on quota or in private browsing.

## Common Mistakes

### ❌ Calling `window.localStorage` directly in a saga

**Mechanism:** Bypasses the safe wrappers that swallow quota / security errors; private-browsing users see the saga crash.

```typescript
// WRONG
yield* call([window.localStorage, "setItem"], key, value);
```

```typescript
// CORRECT
yield* call(setLocalStorageItem, key, value);
```

Source: `../SKILL.md §15`. Priority: **HIGH**.

### ❌ Calling localStorage from a component

**Mechanism:** Side effects belong in sagas; a component write cannot be replayed, logged, or tested like a saga.

```typescript
// WRONG — component lifecycle/effect code writes storage directly
function persistThemeFromComponent(theme: string) {
  window.localStorage.setItem("theme", theme);
}
```

```typescript
// CORRECT — saga watching the action
yield* takeEvery(setTheme, function* () {
  const theme = yield* selectTheme.effect();
  yield* call(setLocalStorageItem, "theme", theme);
});
```

Source: `../SKILL.md §15`. Priority: **HIGH**.

### ❌ Assuming `JSON.parse` will never throw

**Mechanism:** Corrupt or legacy payloads crash the init saga and leave the app in an empty state; wrap parse in try/catch and fall through to defaults.

```typescript
// WRONG
const stored = yield* call(getLocalStorageItem, KEY);
if (stored) return JSON.parse(stored);
```

```typescript
// CORRECT
try {
  const stored = yield* call(getLocalStorageItem, KEY);
  if (stored) return { ...defaults, ...JSON.parse(stored) };
} catch {
  /* ignore */
}
return defaults;
```

Source: `../SKILL.md §15`. Priority: **MEDIUM**.

## See also

- `core/sagas` — `takeEvery` patterns and the saga lifecycle this code runs in.
- `core/core-policy` — rule that side effects live in sagas, not components.
- `core/state-serialization` — keep state JSON-serializable so `JSON.stringify` round-trips cleanly.