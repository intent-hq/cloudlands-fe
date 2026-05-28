# localStorage Persistence

## 15. localStorage Persistence

### `safe-local-storage-saga` utilities

Always use the saga helpers from `$lib/store/utils/safe-local-storage-saga` — **never** call `window.localStorage` directly in sagas. These helpers wrap localStorage operations in `yield* call()` so they're testable with `expectSaga`/`testSaga`:

```typescript
import {
  getLocalStorageItem, // yield* call(getLocalStorageItem, key) → string | null
  setLocalStorageItem, // yield* call(setLocalStorageItem, key, value)
  removeLocalStorageItem, // yield* call(removeLocalStorageItem, key)
} from '$lib/store/utils/safe-local-storage-saga';
```

### Init saga pattern — load from localStorage on startup

```typescript
import { getLocalStorageItem } from '$lib/store/utils/safe-local-storage-saga';
import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { loadSettings } from '../my-slice';

const STORAGE_KEY = 'my-feature-settings';

const defaults = { theme: 'dark', fontSize: 14 };

function* loadFromLocalStorage(): SagaGenerator<typeof defaults> {
  try {
    const stored = yield* call(getLocalStorageItem, STORAGE_KEY);
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors — fall through to defaults
  }
  return defaults;
}

export function* initSaga() {
  const settings = yield* call(loadFromLocalStorage);
  yield* put(loadSettings(settings));
}
```

### Persistence saga pattern — watch and save on change

```typescript
import { setLocalStorageItem } from '$lib/store/utils/safe-local-storage-saga';
import { call, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { selectMyValue } from '../my-selectors';
import { setMyValue } from '../my-slice';

const STORAGE_KEY = 'my-feature-value';

function* persistValue(): SagaGenerator<void> {
  try {
    const value = yield* selectMyValue.effect();
    yield* call(setLocalStorageItem, STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage errors — localStorage can throw (quota, private browsing)
  }
}

export function* persistenceSaga() {
  yield* takeEvery([setMyValue.type], persistValue);
}
```

### Orchestration — combining init + persistence

```typescript
import { fork, type SagaGenerator } from 'typed-redux-saga';
import { initSaga } from './init-saga';
import { persistenceSaga } from './persistence-saga';

export function* myFeatureSaga(): SagaGenerator<void> {
  yield* fork(initSaga);
  yield* fork(persistenceSaga);
}
```

### localStorage rules

- ✅ Always use `getLocalStorageItem` / `setLocalStorageItem` / `removeLocalStorageItem` from `$lib/store/utils/safe-local-storage-saga`
- ✅ Use `typeof window === "undefined"` guard for SSR safety when accessing `window` properties
- ✅ Keep storage keys as constants at the top of the file
- ❌ Never call `window.localStorage` directly in sagas — use the saga helpers
- ❌ Never put localStorage calls in components — use init/persistence sagas
- ❌ Never assume localStorage always succeeds — it can throw on quota, private browsing, or SSR
