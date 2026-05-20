# Sagas, Channels, and Coordination

## 5. Sagas — `typed-redux-saga`

All side effects go in sagas. This codebase uses `typed-redux-saga` (use `yield*` not `yield`).

```typescript
import {
  call,
  put,
  select,
  takeEvery,
  takeLatest,
  delay,
  race,
  fork,
  spawn,
  take,
} from 'typed-redux-saga';

function* mySaga() {
  yield* takeEvery(myAction, handleMyAction);
  yield* takeLatest(searchQuery, handleSearch);
}

function* handleMyAction(action: ReturnType<typeof myAction>) {
  const data = yield* select(mySelector.select); // Read state
  const result = yield* call(fetchData, action.payload); // Call async fn
  yield* put(updateData(result)); // Dispatch action
}

// Debounce pattern
function* handleSearch(action: ReturnType<typeof searchQuery>) {
  yield* delay(300);
  const results = yield* call(api.search, action.payload);
  yield* put(setResults(results));
}
```

**Saga rules:**

- ✅ Pass action creators directly: `yield* takeEvery(myAction, handler)`
- ❌ Don't use `.type`: `yield* takeEvery(myAction.type, handler)` — WRONG
- ✅ Use `.effect()` for selectors: `const val = yield* mySelector.effect()`
- ❌ Never inline lambdas: `yield* select((state) => state.x)` — WRONG, create named selectors
- ✅ Always create named selectors in `*-selectors.ts` files

### State access in functions reached from sagas

A function that is reached from a saga must follow the same rule as the saga itself. It must either:

- **Be a generator** (`function*`) and read state via `yield* selector.effect(...)`, or
- **Receive state through its arguments** — the calling saga does the `yield* selector.effect(...)` and passes the value in.

Never call `selector.select(store.state, ...)` from saga-context code. That bypasses saga effect machinery, breaks `expectSaga.provide()` testing, and can read stale state mid-saga.

This rule applies transitively: a non-generator helper called from a saga that itself calls another helper that reads state must propagate the same fix down the chain.

| Shape | Fix |
|---|---|
| Inside a generator | `selector.select(...)` → `yield* selector.effect(...)` |
| Non-generator helper called from a saga | Convert helper to `function*` (use `yield* effect` inside), **or** lift the read to the caller and pass state in as an argument |
| Async callback registered from a saga (e.g. event listener) | Lift the read into the registering saga; pass values via closure/argument. The callback must not call `.select()` itself |

(Component event handlers and other non-saga code paths are not affected — current Store-first guidance uses `.select(store.state, ...)` with the configured app `Store` per `svelte-redux-toolkit/selector-lifecycle`.)

### Selector Channel Effects — reacting to state changes in sagas

```typescript
import {
  takeLatestFromSelector,
  takeEveryFromSelector,
  takeLeadingFromSelector,
} from '$lib/store/utils/selector-channel-effects';

// Cancel previous handler when value changes (most common)
function* watchCurrentConversation() {
  yield* takeLatestFromSelector(selectCurrentConversationId, function* ({ payload, prevPayload }) {
    if (payload) {
      yield* put(loadConversation(payload));
    }
  });
}

// With selector arguments — pass as second parameter
function* watchConversation(conversationId: string) {
  yield* takeLatestFromSelector(selectConversation, [conversationId], function* ({ payload }) {
    // Handle changes
  });
}
```

For advanced channel patterns, use `createChannelFromSelector` from `$lib/store/utils/selector-channel-effects` — but prefer the `takeEveryFromSelector` / `takeLatestFromSelector` family above.

### Channel Effects — consuming any EventChannel in sagas

```typescript
import { takeEveryFromChannel, takeLatestFromChannel } from '$lib/store/utils/channel-effects';

// takeEveryFromChannel - Fork a new worker for each event (most common for IPC)
yield *
  takeEveryFromChannel(channel, function* (data) {
    yield* put(handleEvent(data));
  });

// takeLatestFromChannel - Cancel previous worker when new event arrives
yield *
  takeLatestFromChannel(channel, function* (data) {
    yield* call(expensiveOperation, data);
  });
```

These auto-fork, auto-close the channel on cancellation, and work with **any** `EventChannel<T>`.

### IPC & Window Listeners in sagas (preferred one-liners)

Use the high-level helpers from `$lib/store/utils/ipc-channel` — they create the channel, loop, and clean up automatically:

```typescript
import {
  takeEveryFromListenSync,
  takeEveryFromElectronChannel,
  takeEveryFromWindowEvent,
} from '$lib/store/utils/ipc-channel';

// listenSync(...) events — most common for main→renderer IPC
function* watchWorkspaceUpdated() {
  yield* takeEveryFromListenSync<WorkspaceUpdatedEvent>('workspace:updated', function* (data) {
    yield* put(setLastUpdate(data.workspaceId, data.timestamp));
  });
}

// window.electronAPI.on(...) events
function* watchZoom() {
  yield* takeEveryFromElectronChannel<{ zoomFactor: number }>(
    'window:zoom-changed',
    function* (data) {
      yield* put(setZoomFactor(data.zoomFactor));
    },
  );
}

// window CustomEvent flows
function* watchThemeChange() {
  yield* takeEveryFromWindowEvent<{ theme: string }>('app:theme-changed', function* (data) {
    yield* put(setTheme(data.theme));
  });
}
```

For custom channel scenarios, fall back to `createListenSyncChannel` + `takeEveryFromChannel`:

```typescript
import { createListenSyncChannel } from '$lib/store/utils/ipc-channel';
import { takeEveryFromChannel } from '$lib/store/utils/channel-effects';

const channel = createListenSyncChannel<MyEvent>('my:event');
yield *
  takeEveryFromChannel(channel, function* (data) {
    /* ... */
  });
```

````

### `waitFor` — wait for state condition

```typescript
import { waitFor } from "$lib/store/slices/store-utility/sagas/waitFor";

// Wait for a condition, with optional timeout
yield* waitFor(selectIsSummarizing, [conversationId], (val) => val === false);
yield* waitFor(selectIsReady, [], (val) => val === true, 5000); // 5s timeout, returns false if timed out
````

### Batch updates — prevent intermediate selector emissions

```typescript
import { lockUpdates, unlockUpdates } from '$lib/store/slices/store-utility/store-utility-slice';

yield * put(lockUpdates());
try {
  yield * put(action1());
  yield * put(action2());
} finally {
  yield * put(unlockUpdates()); // Selectors update once here
}
```
