---
name: svelte-redux-toolkit/sagas
description: >-
  Concise agent rules for typed-redux-saga work in this package. Use for saga
  watchers/workers, canonical saga ownership, Store saga registration/startup,
  Store-first saga startup, debounceSaga helpers, retryWithTimeout,
  wrapStreamingGenerator, and routing to saga-manager crash/restart guidance. For conceptual API
  explanations and examples, link to docs/SAGAS.md instead of duplicating them.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/actions
  - svelte-redux-toolkit/state-integrity
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

Use this skill when editing saga code or writing instructions for saga changes. Keep this file short and operational; `docs/SAGAS.md` is the canonical human-facing guide for concepts, API shape, tradeoffs, and examples.

## Canonical references

- Human guide: `docs/SAGAS.md`
- Source: `src/slices/store-utility/sagas/`, `src/utils/sagas/debounce-saga.ts`, `src/utils/sagas/retry-with-timeout.ts`, `src/utils/sagas/wrap-async-generator.ts` (`wrapStreamingGenerator` public export: `src/saga.ts` / `svelte-redux-toolkit/saga`)
- Related skills: `svelte-redux-toolkit/actions`, `svelte-redux-toolkit/state-integrity`, `svelte-redux-toolkit/saga-manager`, `svelte-redux-toolkit/selector-channels`, `svelte-redux-toolkit/waitFor`, `svelte-redux-toolkit/testing`

## When to use sagas

- Use sagas for side effects, orchestration, persistence, timers, event listeners, and async workflows.
- Use selector-channel helpers when the trigger is a selector value change, not an action.
- Use `waitFor` for one-shot suspension until state reaches a predicate; do not use it for continuous monitoring.

## Do

- Use `typed-redux-saga` effects with `yield*` for every effect.
- Pass action creators directly to `take`, `takeEvery`, `takeLatest`, and `takeLeading`; do not pass `.type`.
- Read state through named selectors with `.effect(...)` inside sagas.
- Search before adding watchers: trigger action, worker name, registration name, and operation terms must have one canonical owner unless fan-out is intentional and documented.
- Start app-owned sagas explicitly with `store.runSaga(sagaFn)` after `store.init()`.
- Close manually-created channels in `finally`.
- Handle async action failures with `.failure(error)` and normalize non-`Error` throws.
- Keep retried work idempotent when using `retryWithTimeout`.
- Keep stream handlers passed to `wrapStreamingGenerator` package-generic; do not add app-specific logging/reporting dependencies to the utility.

## Don't

- Do not put side effects in reducers or selector predicates.
- Do not call `selector.select(store.state, ...)` from saga-reachable code; convert the helper path to generators or pass values in.
- Do not add a parallel watcher for an action already owned by another saga.
- Do not manually add or start `@internal_sagaManager`; it is package-owned and started by Store initialization.
- Do not import package-internal saga-manager files/actions such as `addCrash` or `clearCrashes` from app code; route crash-storage/restart questions to `svelte-redux-toolkit/saga-manager`.
- Do not assume `store.init()` auto-starts registered app sagas.
- Do not leave channels, retries, or long-running loops without cancellation/error paths.

## Implementation cues

- Default user-triggered fetch/search flows to `takeLatest`; use `takeEvery` only when every action must be processed and `takeLeading` when in-flight work should block newer triggers.
- Compose root sagas from focused watcher/worker functions rather than mixing unrelated concerns in one worker.
- For wrapper-action debouncing, use the public `debounceSaga(debounceAction, ms)` helper.
- For transient failures, use `retryWithTimeout` and branch on all outcomes: `success`, `retries-exhausted`, and `timeout`.
- For async generators, use `wrapStreamingGenerator` from saga code and handle stream errors locally at the call site if app reporting is needed.
- For saga lifetimes, call `store.runSaga(sagaFn)` from `onMount` when component/layout lifetime owns the work, or from services/tests when imperative control owns the returned cancel function. Use `store.dispose()` only for whole-Store teardown; it stops running saga tasks owned by the initialized Store context.
- For saga manager crash records, cleanup, serialized storage, auto-restart, or backoff behavior, use the dedicated `svelte-redux-toolkit/saga-manager` skill instead of expanding this general saga checklist.

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

### 2. Debounce wrapper actions before dispatching the wrapped action

```ts
import { debounceSaga } from "svelte-redux-toolkit/saga";
import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import type { StoreAction } from "svelte-redux-toolkit/types";

export const debounceUiAction = createAction<[StoreAction<any>]>("ui/debounceAction");

export function* uiDebounceSaga() {
  yield* debounceSaga(debounceUiAction, 300);
}
```

### 3. Debounce independently by domain key when action type is too broad

```ts
import { debounceWithKeySaga } from "svelte-redux-toolkit/utils/sagas/debounce-saga";

function* watchSearchDrafts() {
  yield* debounceWithKeySaga(
    debounceUiAction,
    250,
    (innerAction) => `${innerAction.type}:${innerAction.payload[0]?.conversationId ?? "global"}`
  );
}
```

### 4. Branch on every retryWithTimeout outcome

```ts
import { call, put } from "typed-redux-saga";
import { retryWithTimeout } from "svelte-redux-toolkit/saga";

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
import { wrapStreamingGenerator } from "svelte-redux-toolkit/saga";

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

## Verification cues

- Add or update saga tests with the package testing patterns; see `svelte-redux-toolkit/testing`.
- Check for duplicate watchers/registrations with targeted searches before and after edits.
- Verify `.effect(...)` selector reads are mockable with `expectSaga.provide()` when tests cover saga state reads.
- Run the smallest relevant test target plus skill-example validation when documentation examples changed: `npm run validate:skill-examples` in this repository, or `npx svelte-redux-toolkit validate-skill-examples` / `npm exec svelte-redux-toolkit -- validate-skill-examples` in a consuming app.

## Common mistakes to prevent

- Plain `yield` with `typed-redux-saga`; use `yield*`.
- Passing `myAction.type` to watcher effects; pass `myAction`.
- Adding a second watcher or Store registration for an existing trigger/name.
- Forgetting `finally` for `channel.close()`.
- Treating saga-manager internals as app-owned sagas.

## See also

- `docs/SAGAS.md` — full saga concepts, APIs, and examples.
- `svelte-redux-toolkit/saga-manager` — package-owned crash tracking, cleanup, serialized crash storage, `store.runSaga` lifecycle, restart, and backoff mechanics.
- `svelte-redux-toolkit/selector-channels` — selector change watchers and selector-backed channels.
- `svelte-redux-toolkit/waitFor` — one-shot selector predicate waits.
- `svelte-redux-toolkit/channel-effects` — generic `EventChannel` consumers.
- `svelte-redux-toolkit/local-storage` — persistence saga helpers.
- `svelte-redux-toolkit/testing` — saga test setup and mocks.
