# Testing Redux Slices and Sagas

## 14. Testing

### The `vi.mock("typed-redux-saga")` boilerplate — REQUIRED for all saga tests

Every saga test **must** mock `typed-redux-saga` to map its generator-based `yield*` effects back to plain `redux-saga/effects` so that `expectSaga`/`testSaga` from `redux-saga-test-plan` can interpret them. This is the **#1 testing pitfall** — tests silently hang or fail without it.

The `vi.mock()` call must appear **before** any imports of saga modules (Vitest hoists it, but declaration order matters for readability and correctness):

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';

// ⚠️ MUST come before importing any saga module
vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
}));

// NOW safe to import saga modules
import { myHandler } from './my-saga';
import { myAction, myOtherAction } from '../my-slice';
```

**Only mock the effects your saga actually uses.** For example, if the saga only uses `fork`, you only need the `fork` entry in the mock.

### `expectSaga` — integration-style testing (most common)

Tests the saga's observable side effects without asserting step order:

```typescript
it('handles the action and dispatches result', async () => {
  await expectSaga(handleMyAction, myAction('input'))
    .withState({
      mySlice: { items: [], isLoading: false },
      providerSettings: { activeProviderId: 'codex' },
    })
    .put(setLoading(true))
    .call(fetchData, 'input')
    .put(setResults(['item1']))
    .silentRun(0);
});
```

**Key methods:**

| Method                                            | Purpose                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.withState(partialState)`                        | Provide the Redux state the saga will `select` from                                                      |
| `.put(action)`                                    | Assert the saga dispatches this exact action                                                             |
| `.put.like({ action: { type } })`                 | Assert a dispatch matching a partial shape                                                               |
| `.call(fn, ...args)`                              | Assert the saga calls this function with these args                                                      |
| `.provide([[matchers.call.fn(fn), returnValue]])` | Stub a `call` effect to return a value (use `import * as matchers from "redux-saga-test-plan/matchers"`) |
| `.dispatch(action)`                               | Dispatch an action mid-test (for sagas that `take`)                                                      |
| `.silentRun(0)`                                   | Run without timeout warnings; use `0` for sync sagas, `100` for async                                    |

### `testSaga` — step-by-step testing

Tests exact execution order. Best for orchestration sagas (fork trees):

```typescript
import { testSaga } from 'redux-saga-test-plan';

it('forks child sagas in order', () => {
  testSaga(rootSaga).next().fork(childSagaA).next().fork(childSagaB).next().isDone();
});

it('loads cached data from localStorage', () => {
  testSaga(loadCachedEditors)
    .next()
    .call(getLocalStorageItem, STORAGE_KEY)
    .next(JSON.stringify({ editors: [mockEditor], timestamp: 123 }))
    .put(fetchEditorsSuccess([mockEditor], 123))
    .next()
    .isDone();
});
```

### Reducer testing — pure functions, no mocks needed

Reducers are pure functions. Test them by calling `reducer(state, action)` and asserting the result:

```typescript
import { describe, it, expect } from 'vitest';
import { myReducer, addItem, removeItem, initialState } from './my-slice';

describe('myReducer', () => {
  it('returns initial state', () => {
    expect(myReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('adds an item', () => {
    const state = myReducer(initialState, addItem({ id: '1', name: 'Test' }));
    expect(getItem(state.items, '1')).toEqual({ id: '1', name: 'Test' });
  });

  it('does not mutate previous state', () => {
    const state = myReducer(initialState, addItem({ id: '1', name: 'Test' }));
    expect(initialState.items).toEqual(createCollection('id')); // unchanged
    expect(state).not.toBe(initialState);
  });

  it('returns same reference when nothing changes', () => {
    const state = myReducer(initialState, removeItem('nonexistent'));
    expect(state).toBe(initialState); // same reference = no re-render
  });
});
```

### Testing rules

- ✅ Use `expectSaga` for integration tests, `testSaga` for step-by-step order verification
- ✅ Use `vi.clearAllMocks()` and `localStorage.clear()` in `beforeEach`
- ✅ Mock external dependencies with `vi.mock("module", () => ({ ... }))`
- ✅ Use `import * as matchers from "redux-saga-test-plan/matchers"` with `.provide()` for stubbing calls
- ❌ Never import from `typed-redux-saga` in test assertions — use `redux-saga/effects` for matchers
- ❌ Never use real timers — use `.silentRun()` with short timeouts
- ❌ Never forget the `call` mock's `Array.isArray` guard — it handles `[context, method]` tuple calls used by `safe-local-storage-saga`
