---
name: core/sagas
description: >-
  Concise agent rules for typed-redux-saga work in this package. Use for saga
  watchers/workers, canonical saga ownership, Store saga registration/startup,
  Store-first saga startup, cancellation-friendly debounce, retryWithTimeout,
  wrapStreamingGenerator, and routing to saga-manager crash/restart guidance. For conceptual API
  explanations and examples, link to @augmentcode/themis/docs/SAGAS.md instead of duplicating them.
type: sub-skill
requires:
  - core
  - core/actions
  - core/state-integrity
triggers:
  - takeEvery saga
  - store.runSaga
  - saga manager
  - saga crash
  - debounce saga
  - retryWithTimeout
  - wrapStreamingGenerator
  - typed redux saga
---
# Sagas — agent implementation rules

Use this skill when editing saga code or writing instructions for saga changes. Keep this file short and operational; `@augmentcode/themis/docs/SAGAS.md` is the canonical human-facing guide for concepts, API shape, tradeoffs, and examples.

## Canonical references

- Human guide: `@augmentcode/themis/docs/SAGAS.md`
- Public API: `@augmentcode/themis/saga`; utility leaf exports include `@augmentcode/themis/utils/sagas/debounce-saga`, `@augmentcode/themis/utils/sagas/retry-with-timeout`, and `@augmentcode/themis/utils/sagas/wrap-async-generator`. Store-utility saga internals are implementation context only.
- Related skills: `core/actions`, `core/state-integrity`, `core/saga-manager`, `core/selector-channels`, `core/wait-for`, `core/testing`

## When to use sagas

- Use sagas for side effects, orchestration, persistence, timers, event listeners, and async workflows.
- Use selector-channel helpers when the trigger is a selector value change, not an action.
- Use `waitFor` for one-shot suspension until state reaches a predicate; do not use it for continuous monitoring.

## Do

- Use `typed-redux-saga` effects with `yield*` for every effect.
- Pass action creators directly to `take`, `takeEvery`, `takeLatest`, and `takeLeading`; do not pass `.type`.
- Read state through named selectors with `.effect(...)` inside sagas.
- Import the named selectors from the owning slice's `[slice]-selectors.ts` file; saga modules must not declare local `select*` functions/factories, even when they are not exported.
- Subscribe with concrete action creators, action-creator arrays, or selector-channel helpers; never use `take('*')` or other wildcard takes.
- Search before adding watchers: trigger action, worker name, registration name, and operation terms must have one canonical owner unless fan-out is intentional and documented.
- Start app-owned sagas explicitly with `store.runSaga(sagaFn)` after `store.init()`.
- Close manually-created channels in `finally`.
- Handle async action failures with `.failure(error)` and normalize non-`Error` throws.
- Keep retried work idempotent when using `retryWithTimeout`.
- Keep stream handlers passed to `wrapStreamingGenerator` package-generic; do not add app-specific logging/reporting dependencies to the utility.
- Configure optional saga monitoring through the third Store/ReactStore/StreamingStore constructor options object as `{ sagaMonitor: true }`; omitted or `false` monitors stay disabled.

## Don't

- Do not put side effects in reducers or selector predicates.
- Do not call `selector.select(store.state, ...)` from saga-reachable code; convert the helper path to generators or pass values in.
- Do not declare or factory-construct `select*` selectors inside saga modules, even as module-private locals; move them to the owning `[slice]-selectors.ts` and import them.
- Do not subscribe to every action with `take('*')`, `takeEvery('*', ...)`, or other wildcard patterns; it wakes the saga on every dispatch and is especially harmful during streaming flows where chunk actions fire continuously.
- Do not add a parallel watcher for an action already owned by another saga.
- Do not manually add or start `@internal_sagaManager`; it is package-owned and started by Store initialization.
- Do not import package-internal saga-manager files/actions such as `addCrash` or `clearCrashes` from app code; route crash-storage/restart questions to `core/saga-manager`.
- Do not assume `store.init()` auto-starts app sagas; start each app saga explicitly with `store.runSaga(sagaFn)`.
- Do not leave channels, retries, or long-running loops without cancellation/error paths.
- Do not introduce detached `spawn`; use attached `fork` so child work is cancelled when the parent fails or is cancelled.
- Do not monkey-patch redux-saga globally or replace Store-owned saga middleware to observe effects; pass `{ sagaMonitor: true }` in Store options instead.

## Implementation cues

- Default user-triggered fetch/search flows to `takeLatest`; use `takeEvery` only when every action must be processed and `takeLeading` when in-flight work should block newer triggers.
- Compose root sagas from focused watcher/worker functions rather than mixing unrelated concerns in one worker.
- For debounce, watch the real action with `takeLatest` and call `delay(ms)` inside the worker before the effect; use `takeLeading` plus trailing `delay(ms)` only for leading/windowed behavior.
- Do not add new wrapper-action debounce flows or recommend `debounceSaga`/`debounceWithKeySaga` for new work; those exports remain for compatibility only.
- For transient failures, use `retryWithTimeout` and branch on all outcomes: `success`, `retries-exhausted`, and `timeout`.
- For async generators, use `wrapStreamingGenerator` from saga code and handle stream errors locally at the call site if app reporting is needed.
- For saga lifetimes, call `store.runSaga(sagaFn)` from `onMount` when component/layout lifetime owns the work, or from services/tests when imperative control owns the returned cancel function. Use `store.dispose()` only for whole-Store teardown; it stops running saga tasks owned by the initialized Store context.
- For saga monitoring, keep the normal constructor shape and pass `new Store(reducers, middleware, { throttledSelectorFrequency, sagaMonitor: true })` or the equivalent `ReactStore`/`StreamingStore` options object.
- For saga manager crash records, cleanup, serialized storage, auto-restart, or backoff behavior, use the dedicated `core/saga-manager` skill instead of expanding this general saga checklist.

## Examples

### 1. Register one canonical action watcher and read state through selector effects

```ts
import { call, put, takeLatest } from "typed-redux-saga";

function* watchLoadTodos() {
  yield* takeLatest(loadTodos, loadTodosWorker);
}

function* loadTodosWorker() {
  const userId = yield* selectCurrentUserId.effect();
  const todos = yield* call(api.fetchTodos, userId);
  yield* put(loadTodosSuccess(todos));
}
```

### 2. Debounce trailing user input with takeLatest + delay

```ts
import { call, delay, put, takeLatest } from "typed-redux-saga";

function* watchSearchInput() {
  yield* takeLatest(searchInputChanged, function* searchAfterSettled(action) {
    yield* delay(300);
    const results = yield* call(api.search, action.payload[0]);
    yield* put(searchResultsLoaded(results));
  });
}
```

### 3. Debounce leading/windowed behavior with takeLeading + delay

```ts
import { call, delay, takeLeading } from "typed-redux-saga";

function* watchRefreshRequests() {
  yield* takeLeading(refreshRequested, function* refreshOncePerWindow(action) {
    try {
      yield* call(api.refresh, action.payload[0]);
    } finally {
      yield* delay(250);
    }
  });
}
```

### 4. Branch on every retryWithTimeout outcome

```ts
import { call, put } from "typed-redux-saga";
import { retryWithTimeout } from "@augmentcode/themis/saga";

function* syncRemoteState() {
  const outcome = yield* retryWithTimeout(
    function* () { yield* call(api.syncRemoteState); },
    { maxRetries: 2, timeoutMs: 30_000, getDelayMs: (attempt) => 500 * (attempt + 1) }
  );

  if (outcome === "retries-exhausted") yield* put(syncFailed("retry-limit"));
  if (outcome === "timeout") yield* put(syncFailed("timeout"));
}
```

### 5. Consume an async generator through wrapStreamingGenerator

```ts
import { put } from "typed-redux-saga";
import { wrapStreamingGenerator } from "@augmentcode/themis/saga";

function* streamMessages(stream: AsyncGenerator<MessageChunk, MessageChunk | null, unknown>) {
  yield* wrapStreamingGenerator(
    stream,
    function* (chunk) { yield* put(messageChunkReceived(chunk)); },
    { timeoutMs: 30_000, onError: (error) => reportStreamError(error) }
  );
}
```

### 6. ❌ Bad: duplicate watchers with different cancellation semantics for one trigger

```ts
// BAD: two watchers own the same action, so stale takeEvery work can race takeLatest.
function* watchTodosTwice() {
  yield* takeLatest(loadTodos, refreshTodosWorker);
  yield* takeEvery(loadTodos, auditAndRefreshTodosWorker);
}

function* watchTodosOnce() {
  yield* takeLatest(loadTodos, function* loadTodosOnce(action) {
    yield* call(refreshTodosWorker, action);
    yield* call(auditLoadTodos, action.payload[0]);
  });
}
```

### 7. ❌ Bad: local selector declarations in a saga module

```ts
// BAD: selector logic lives in the saga file, even when it is not exported.
const selectVisibleTodos = (state: AppState) => state.todos.visible;
const selectTodoById = (todoId: string) => (state: AppState) => state.todos.map[todoId];

function* watchVisibleTodos() {
  const visible = yield* select(selectVisibleTodos);
  const todo = yield* select(selectTodoById("first"));
  // ...
}

// GOOD: import named selectors from the slice's selectors file and use .effect(...).
import { selectVisibleTodos, selectTodoById } from "./todos-selectors";

function* watchVisibleTodosGood() {
  const visible = yield* selectVisibleTodos.effect();
  const todo = yield* selectTodoById.effect("first");
}
```

### 8. ❌ Bad: wildcard `take('*')` that wakes the saga on every dispatch

```ts
// BAD: subscribes to every action; especially harmful during streaming flows
// because each chunk action wakes the worker and starves intended work.
function* watchAnything() {
  while (true) {
    const action = yield* take("*");
    yield* call(audit, action);
  }
}

// GOOD: take the concrete trigger actions, or react to a selector value.
function* watchUserEvents() {
  yield* takeEvery([userLoggedIn, userLoggedOut], auditUserEventWorker);
}

function* watchReady() {
  yield* takeLatestFromSelector(selectIsReady, function* ({ payload }) {
    if (payload) yield* call(syncReadyState);
  });
}
```

## Verification cues

- Add or update saga tests with the package testing patterns; see `core/testing`.
- Check for duplicate watchers/registrations with targeted searches before and after edits.
- Verify `.effect(...)` selector reads are mockable with `expectSaga.provide()` when tests cover saga state reads.
- Run the smallest relevant test target when documentation examples changed.

## Common mistakes to prevent

- Plain `yield` with `typed-redux-saga`; use `yield*`.
- Passing `myAction.type` to watcher effects; pass `myAction`.
- Adding a second watcher or Store registration for an existing trigger/name.
- Forgetting `finally` for `channel.close()`.
- Treating saga-manager internals as app-owned sagas.
- Using `spawn` or wrapper-action debounce helpers for new saga work.
- Declaring `select*` selectors locally inside a saga module instead of importing them from `[slice]-selectors.ts`.
- Using `take('*')`, `takeEvery('*', ...)`, or similar wildcard patterns instead of concrete action creators or selector-channel helpers.

## See also

- `@augmentcode/themis/docs/SAGAS.md` — full saga concepts, APIs, and examples.
- `core/saga-manager` — package-owned crash tracking, cleanup, serialized crash storage, `store.runSaga` lifecycle, restart, and backoff mechanics.
- `core/selector-channels` — selector change watchers and selector-backed channels.
- `core/wait-for` — one-shot selector predicate waits.
- `core/channel-effects` — generic `EventChannel` consumers.
- `core/local-storage` — persistence saga helpers.
- `core/testing` — saga test setup and mocks.
