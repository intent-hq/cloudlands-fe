---
name: core/channel-effects
description: >-
  Generic EventChannel consumers for sagas. Use redux-saga takeEvery(channel,
  worker) for every-event consumption and takeLatest(channel, worker) for
  latest-only consumption. Own app-provided channel lifecycle explicitly and
  call channel.close() in a finally block on cancel / failure. Use these
  patterns for app-provided EventChannel factories, websocket, DOM-event, or IPC
  EventChannel consumers.
  Distinct from selector-channels — do NOT wrap a selector-derived channel in
  generic EventChannel consumers; use takeEveryFromSelector /
  takeLatestFromSelector instead.
type: sub-skill
requires:
  - core
  - core/sagas
triggers:
  - take every channel
  - take latest channel
  - EventChannel consumer
  - channel cleanup
---
# Channel Effects — generic EventChannel consumers

> Use native redux-saga `takeEvery(channel, worker)` for every-event `EventChannel<T>` consumption and `takeLatest(channel, worker)` when each new event should cancel the previous worker.

Source: redux-saga channel watcher effects, `../SKILL.md §5 (Channel Effects)`.

## Imports

```typescript
import type { EventChannel } from "redux-saga";
import { takeEvery, takeLatest } from "redux-saga/effects";
```

## Native channel watchers

```typescript
takeEvery(channel, worker);
takeLatest(channel, worker);
```

For every-event handling, call redux-saga's `takeEvery(channel, worker)` directly. For latest-only handling, call redux-saga's `takeLatest(channel, worker)` directly. Native watcher effects do not own app-created channel resources; wrap usage in `try/finally` and close the channel yourself.

## Core Patterns

### 1. Fork a new worker for every event

```typescript
// createAppEventChannel is app-provided and returns EventChannel<MyEvent>
const channel = createAppEventChannel<MyEvent>("my:event");
try {
  yield* takeEvery(channel, function* (data) {
    yield* put(handleEvent(data));
  });
} finally {
  channel.close();
}
```

Every event spawns a new worker concurrently — use when events are independent. Keep ownership of app-created channels explicit and close them in `finally`.

### 2. Cancel the previous worker for each new event

```typescript
// createAppEventChannel is app-provided and returns EventChannel<MyEvent>
const channel = createAppEventChannel<MyEvent>("my:event");
try {
  yield* takeLatest(channel, function* (data) {
    yield* call(expensiveOperation, data);
  });
} finally {
  channel.close();
}
```

Use native redux-saga `takeLatest(channel, worker)` when only the **latest** event matters (e.g., streaming progress, latest search). Keep ownership of app-created channels explicit and close them in `finally`.

### 3. Replace a hand-rolled `while (true) + take(channel)` loop

```typescript
// Before — easy to forget channel.close() on error
// createAppEventChannel is app-provided and returns EventChannel<MyEvent>
const channel = createAppEventChannel<MyEvent>("my:event");
try {
  while (true) {
    const data = yield* take(channel);
    yield* call(handleEvent, data);
  }
} finally {
  channel.close();
}

// After
const channel = createAppEventChannel<MyEvent>("my:event");
try {
  yield* takeEvery(channel, function* (data) {
    yield* call(handleEvent, data);
  });
} finally {
  channel.close();
}
```

## Common Mistakes

### ❌ Hand-rolling the take-loop + finally close

**Mechanism:** Manual loops repeatedly forget the try/finally and leak the underlying subscription on cancellation. Prefer redux-saga `takeEvery(channel, worker)` for every-event handling, while keeping channel cleanup explicit.

```typescript
// WRONG
const ch = createAppEventChannel<Evt>("e");
while (true) {
  const data = yield* take(ch);
  yield* call(worker, data);
}
```

```typescript
// CORRECT
const ch = createAppEventChannel<Evt>("e");
try {
  yield* takeEvery(ch, worker);
} finally {
  ch.close();
}
```

Source: redux-saga channel watcher effects. Priority: **HIGH**.

### ❌ Using channel-effects where selector-channels fit

**Mechanism:** For selector-derived changes, `takeEveryFromSelector` / `takeLatestFromSelector` handle subscription and args-tuple keying automatically; wrapping a selector in a generic EventChannel throws those guarantees away.

```typescript
// WRONG
const ch = yield* createChannelFromSelector(selectItem, [id]);
yield* takeLatest(ch, worker);
```

```typescript
// CORRECT
yield* takeLatestFromSelector(selectItem, [id], worker);
```

Source context: package-internal store-utility saga implementation. Public selector-channel helpers are available from `@augmentcode/themis/saga`. Priority: **MEDIUM**.

## See also

- `core/selector-channels` — for selector-derived channels (the right tool for state changes).
- `core/sagas` — core saga patterns, `takeEvery` / `takeLatest` for actions.

