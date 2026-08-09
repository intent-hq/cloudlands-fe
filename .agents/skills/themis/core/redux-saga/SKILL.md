---
name: core/redux-saga
description: >-
  Generic redux-saga API reference for agents. Covers createSagaMiddleware,
  middleware.run, runSaga, Effect creators, effect combinators, watcher helpers,
  channel support, buffers, Task/Channel/Buffer/SagaMonitor interfaces,
  cancellation, context, blocking vs non-blocking semantics, and testing helpers.
type: core
sources:
  - https://redux-saga.js.org/docs/api
triggers:
  - redux-saga
  - redux saga API
  - createSagaMiddleware
  - saga effects
  - saga channels
  - runSaga
  - saga cancellation
  - saga testing
---
# redux-saga — API reference skill

> Source: official redux-saga API Reference, https://redux-saga.js.org/docs/api, retrieved 2026-05-15.

Use this skill for generic redux-saga API behavior. When editing this repository's`themis` code, also follow the package-specific core saga skills in sibling `../*` skill folders, especially the `typed-redux-saga` `yield*`conventions and canonical watcher ownership rules.

## Agent Preflight Compliance Contract

Before editing code or docs that use this skill:

- **MUST** identify whether the target code uses plain `redux-saga` or this repo's`typed-redux-saga` conventions; adapt examples accordingly.
- **MUST** cite this skill and any package-specific saga skill used in the handoff.
- **MUST** verify watcher ownership before adding `takeEvery`, `takeLatest`,`takeLeading`, `throttle`, or `debounce` for an existing trigger.
- **SHOULD** prefer native redux-saga channel-aware effects before adding wrapperutilities.
- **MUST NOT** introduce detached `spawn` in this repository; use attached `fork` so parent failure/cancellation also reaches children.
- **MUST** implement repository debounce with `takeLatest` or `takeLeading` plus `delay`, not action-wrapper debounce utilities.
- **NEVER** introduce runtime source, dependency, or artifact routing changes whenonly API guidance is requested.

## Setup — middleware and root saga startup

`createSagaMiddleware(options)` creates Redux middleware. Supported options includeinitial `context`, `sagaMonitor`, `onError`, `effectMiddlewares`, and a custom`channel` used by `take` and `put` effects.

In themis app setup, the concrete Store owns saga middleware creation. Use this low-level API reference to understand redux-saga behavior, but configure Store-owned monitoring by passing `{ sagaMonitor: true }` in the third `Store`/`ReactStore`/`StreamingStore` constructor options argument instead of replacing the middleware. Omitted or `false` saga monitoring remains disabled.

```typescript
import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import { all, call } from "redux-saga/effects";

function reducer(state = { ready: false }, action: { type: string }) {
  return action.type === "READY" ? { ready: true } : state;
}

function* rootSaga() {
  yield all([call(backgroundSync)]);
}

const sagaMiddleware = createSagaMiddleware({
  onError(error, { sagaStack }) {
    console.error("uncaught saga error", error, sagaStack);
  },
});

const store = createStore(reducer, applyMiddleware(sagaMiddleware));
const task = sagaMiddleware.run(rootSaga);

function* backgroundSync() {
  yield call(Promise.resolve, undefined);
}

void task.toPromise();
```

`middleware.run(saga, ...args)` must be called after the saga middleware is mountedon the store. It returns a `Task` descriptor and drives yielded plain Effectobjects until the generator returns, throws, or is cancelled.

## Core patterns

### 1. Waiting and watcher helpers

Use `take(pattern)` for one action, `takeMaybe(pattern)` when the saga must receivethe `END` sentinel instead of auto-terminating, and watcher helpers for commonloops. Patterns can be `"*"`, strings, arrays, predicates, or action creators whose`toString()` returns an action type.

```typescript
import { call, fork, put, take, takeEvery, takeLatest, takeLeading } from "redux-saga/effects";

function* loadUser(action: { type: string; userId: string }) {
  const user: User = yield call(api.loadUser, action.userId);
  yield put({ type: "USER_LOADED", user });
}

export function* usersSaga() {
  yield takeEvery("USER_REQUESTED", loadUser);     // concurrent workers
  yield takeLatest("SEARCH_CHANGED", runSearch);   // cancel stale worker
  yield takeLeading("SUBMIT_ORDER", submitOrder);  // ignore while running

  const action: { type: string } = yield take(["LOGOUT", "SESSION_EXPIRED"]);
  yield fork(cleanupSession, action);
}
```

`takeEvery`, `takeLatest`, `takeLeading`, `throttle`, and `debounce` also accept a`Channel` in place of a pattern. This is native redux-saga behavior; do not createwrapper utilities unless they add cleanup, typing, or domain value beyond the API.

### 2. Blocking and non-blocking effects

`call`, `apply`, and `cps` are blocking; `fork` and `spawn` start work without blocking the parent. `fork` is attached to the parent: parent completion waits for children, child errors bubble upward, and cancellation propagates downward. `spawn` is detached and does not share parent completion, error, or cancellation flow. In this repository, agents must use attached `fork`, not detached `spawn`, so child tasks remain cancellable and failures remain visible to the parent lifecycle.

```typescript
import { call, cancel, cancelled, fork, join } from "redux-saga/effects";

function* worker() {
  try {
    yield call(api.sync);
  } finally {
    if (yield cancelled()) yield call(api.abortSync);
  }
}

function* supervisor() {
  const attachedTask: Task = yield fork(worker);
  const metricsTask: Task = yield fork(backgroundMetrics);
  yield cancel(metricsTask);  // non-blocking cancellation request
  yield join(attachedTask);   // blocking wait for attachedTask outcome
}
```

Use `cancel(task)`, `cancel([...tasks])`, or `cancel()` for self-cancellation.Cancellation calls the generator's `return()`, jumps to `finally`, and cancels thecurrently blocked effect plus attached child tasks.

### 3. Store I/O, state reads, context, and timing

Use `put(action)` for scheduled dispatch, `putResolve(action)` when dispatch returnsa Promise and the saga must wait, `put(channel, message)` for channel output, and`select(selector, ...args)` for state reads. `setContext(props)` merges saga context;`getContext(prop)` reads one context value. `delay(ms, value)` blocks for time.

```typescript
import { call, delay, getContext, put, putResolve, retry, select, setContext } from "redux-saga/effects";

function* saveProfile(action: { type: string; id: string }) {
  const token: string = yield select((state: RootState) => state.session.token);
  yield setContext({ requestId: action.id });
  const requestId: string = yield getContext("requestId");

  const profile: Profile = yield retry(3, 1_000, api.loadProfile, token, requestId);
  yield put({ type: "PROFILE_LOADED", profile });
  yield delay(250);
  yield putResolve({ type: "PROFILE_PERSISTED" });
}
```

`retry(maxTries, delayMs, fn, ...args)` is a blocking helper built from `call` and`delay`: it retries failures until success or attempts are exhausted, then rethrowsthe last error.

### 4. Channels, buffers, and cleanup

Use `actionChannel(pattern, buffer?)` to queue matching store actions while a workeris blocked. Use `channel(buffer?)` for task-to-task messages and `eventChannel` tobridge external event sources; the `subscribe` function must return an unsubscribefunction. Close channels in `finally`, and use `flush(channel)` to recover bufferedmessages during cleanup.

```typescript
import { buffers, channel, eventChannel, END } from "redux-saga";
import { actionChannel, call, flush, put, take } from "redux-saga/effects";

function socketChannel(socket: WebSocket) {
  return eventChannel<string>((emit) => {
    socket.onmessage = (event) => emit(String(event.data));
    socket.onerror = () => emit(END);
    return () => socket.close();
  }, buffers.sliding(10));
}

function* serializeRequests() {
  const requests: Channel<RequestAction> = yield actionChannel("REQUEST", buffers.expanding(10));
  try {
    while (true) {
      const action: RequestAction = yield take(requests);
      yield call(api.sendRequest, action.payload);
    }
  } finally {
    const leftovers: RequestAction[] = yield flush(requests);
    yield put({ type: "REQUESTS_FLUSHED", leftovers });
  }
}

const mailbox = channel<string>(buffers.fixed(5));
```

Buffer choices: `buffers.none()`, `fixed(limit)`, `expanding(initialSize)`,`dropping(limit)`, and `sliding(limit)`. The default `channel()` buffer queues upto 10 messages FIFO.

### 5. Concurrency combinators and helpers

Use `race` when the first completion wins; losing effects are automaticallycancelled. Use `all` to run effects in parallel and wait for all successes, or throwwhen any effect rejects.

```typescript
import { all, call, delay, put, race, take, takeLatest, takeLeading, throttle } from "redux-saga/effects";

function* fetchWithTimeout() {
  const { response, timeout } = yield race({
    response: call(api.fetchReport),
    timeout: delay(5_000),
  });
  if (timeout) yield put({ type: "REPORT_TIMEOUT" });
  else yield put({ type: "REPORT_READY", response });
}

function* refreshResultsAfterSettled(action: { type: string; query: string }) {
  yield delay(300);
  yield call(refreshResults, action.query);
}

function* refreshOncePerWindow(action: { type: string; id: string }) {
  try {
    yield call(refreshPanel, action.id);
  } finally {
    yield delay(300);
  }
}

function* rootSaga() {
  yield all([call(fetchWithTimeout), call(watchUpload)]);
  yield throttle(1_000, "TYPEAHEAD_CHANGED", fetchSuggestions);
  yield takeLatest("FILTER_CHANGED", refreshResultsAfterSettled);
  yield takeLeading("REFRESH_CLICKED", refreshOncePerWindow);
  yield take("SHUTDOWN");
}
```

`throttle(ms, patternOrChannel, saga, ...args)` uses a sliding buffer of one recentmessage while suppressing new starts during the window. Upstream redux-saga also exposes a native `debounce(ms, patternOrChannel, saga, ...args)` helper that waits until messages settle before forking the worker, but agents must not use it for `themis` implementation examples. Repository debounce must be written explicitly with `takeLatest` or `takeLeading` plus `delay` so cancellation semantics are visible in the worker.

## Interface quick reference

| Interface | What agents need to know |
| --- | --- |
| Task | Returned by fork, spawn, middleware.run, and runSaga; supports isRunning(), isCancelled(), result(), error(), toPromise(), and cancel(). |
| Channel | Message queue with take(callback), put(message), flush(callback), and close(); closed empty channels deliver END. |
| Buffer | Strategy behind a channel; implements isEmpty(), put(message), and take(). |
| SagaMonitor | Receives rootSagaStarted, effectTriggered, effectResolved, effectRejected, effectCancelled, and actionDispatched events for instrumentation. |

## Blocking / non-blocking cheat sheet

| Effect | Blocking? | Notes |
| --- | --- | --- |
| take, takeMaybe, call, apply, cps, join, putResolve, cancelled, delay, retry, race | Yes | race blocks until one branch wins, then cancels losers. |
| put, fork, spawn, cancel, actionChannel, flush, select, setContext, getContext | No | select resolves immediately against current state. |
| put(channel, message) | Depends | It can block when an unbuffered put is consumed immediately by a taker. |
| all([...]) / all({ ... }) | Mixed | Blocks until all child effects complete; child effect types determine actual waits. |
| takeEvery, takeLatest, takeLeading, throttle, debounce | No | Helpers fork watcher tasks; their internals may use blocking effects. |

## External execution with `runSaga`

`runSaga(options, saga, ...args)` starts a saga without Redux middleware. Provide a`channel` for `take`, a `dispatch(output)` function for `put`, and `getState()` for`select`. It returns the same `Task` interface as `middleware.run`.

```typescript
import { runSaga, stdChannel } from "redux-saga";
import { put, take } from "redux-saga/effects";

function* auditSaga() {
  const action: { type: string } = yield take("AUDIT");
  yield put({ type: "AUDITED", action });
}

const dispatched: Array<{ type: string; action?: { type: string } }> = [];
const input = stdChannel();
const task = runSaga(
  { channel: input, dispatch: (output) => dispatched.push(output), getState: () => ({}) },
  auditSaga,
);

input.put({ type: "AUDIT" });
await task.toPromise();
```

## Testing helpers

- `cloneableGenerator(generatorFunc)` from `@redux-saga/testing-utils` createscloneable generator instances for branch testing without replaying setup yields.
- `createMockTask()` from `@redux-saga/testing-utils` returns a mock `Task` fortesting `fork`, `join`, and `cancel` flows.
- Prefer effect-level assertions for small generators and integration-style sagatests for cancellation, channel cleanup, and watcher concurrency.

```typescript
import { cloneableGenerator, createMockTask } from "@redux-saga/testing-utils";
import { cancel, fork } from "redux-saga/effects";

function* worker() {}
function* parent() {
  const task: Task = yield fork(worker);
  yield cancel(task);
}

const generator = cloneableGenerator(parent)();
expect(generator.next().value).toEqual(fork(worker));
const mockTask = createMockTask();
expect(generator.next(mockTask).value).toEqual(cancel(mockTask));
```

## Common mistakes

### ❌ Calling `middleware.run` before mounting middleware

`middleware.run` is only valid after the saga middleware is connected to the Reduxstore. Mount middleware first, then run the root saga. Source: redux-saga APIReference → `middleware.run(saga, ...args)`. Priority: **HIGH**.

### ❌ Assuming `take` and `takeMaybe` handle `END` the same way

`take(pattern)` and `take(channel)` auto-terminate when they receive `END` from thestdChannel or a closed channel. `takeMaybe` returns the `END` object so the saga canhandle the closed-input case itself. Source: redux-saga API Reference → `take` /`takeMaybe`. Priority: **MEDIUM**.

### ❌ Using `spawn` when parent failure/cancellation must affect the child

`fork` creates an attached task; errors bubble to the parent and cancellation propagates through attached children. In this repository, do not introduce `spawn`; use `fork` so saga-manager and parent lifecycles can observe failures and cancel children. Source: redux-saga API Reference → `fork` / `spawn`. Priority: **HIGH**.

### ❌ Forgetting channel unsubscribe / close cleanup

`eventChannel` subscribe functions must return an unsubscribe callback, and sagaconsumers should close channels in `finally` when they own the channel lifecycle.Source: redux-saga API Reference → `eventChannel` / `Channel`. Priority: **HIGH**.

### ❌ Recreating native channel helpers as wrappers without added value

`takeEvery`, `takeLatest`, `takeLeading`, `throttle`, and `debounce` already acceptchannels. Add wrappers only for documented cleanup, typing, or domain-specificbehavior. Source: redux-saga API Reference → channel overloads for watcher helpers.Priority: **MEDIUM**.

For this repository's action debouncing, do not add wrapper-action debounce utilities; watch the real action with `takeLatest` or `takeLeading` and use `delay` inside the worker.

## See also

- `../sagas/SKILL.md` — repository-specific typed-redux-saga conventions.
- `../channel-effects/SKILL.md` — package-provided channel consumer wrappers and when they add cleanup value.
- `../testing/SKILL.md` — repository-specific saga test patterns and mocks.