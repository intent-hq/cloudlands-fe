---
name: svelte-redux-toolkit/selector-channels
description: >-
  Concise agent rules for reacting to selector value changes from sagas. Use
  takeLatestFromSelector, takeEveryFromSelector, or takeLeadingFromSelector for
  continuous watchers; use createChannelFromSelector only for custom race,
  conditional, or timeout flows and close it in finally. For conceptual examples,
  link to docs/SAGAS.md.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/selectors
  - svelte-redux-toolkit/sagas
triggers:
  - take latest selector
  - take every selector
  - channel from selector
  - react to state
---
# Selector Channels — agent implementation rules

Use this skill when a saga should react to selector value changes instead of action dispatches. Keep detailed examples in `docs/SAGAS.md`; this skill is for quick implementation decisions and guardrails.

## Canonical references

- Human guide: `docs/SAGAS.md#selector-channel-effects`
- Source: `src/utils/sagas/selector-channel-effects.ts`
- Related skills: `svelte-redux-toolkit/sagas`, `svelte-redux-toolkit/waitFor`, `svelte-redux-toolkit/channel-effects`, `svelte-redux-toolkit/selector-lifecycle`

## Choose the helper

- `takeLatestFromSelector` — default for load/search/recompute-on-change; cancels previous worker.
- `takeEveryFromSelector` — every selector emission must be handled independently.
- `takeLeadingFromSelector` — ignore new emissions while current work runs.
- `createChannelFromSelector` — only for custom `race`, conditional loops, manual cancellation, or timeout flows.
- `waitFor` — one-shot wait before continuing, not a continuous watcher.

## Do

- Use named selectors created by the package selector utilities.
- Pass selector arguments as the args tuple in the second position, e.g. `[itemId]`.
- Expect worker payloads to include `{ payload, prevPayload }`.
- Prefer the `take*FromSelector` helpers because they create and clean up channels for you.
- Close raw channels in `finally` every time.
- Keep selector-channel workers focused and cancellation-safe.

## Don't

- Do not wrap selector channels in generic `channel-effects`; selector helpers already own the lifecycle.
- Do not use closures or inline selector lambdas to smuggle arguments.
- Do not choose a raw channel for simple load-on-change behavior.
- Do not leave manual channel loops without cancellation and cleanup.
- Do not confuse selector channels with action watchers; use core saga effects for actions.

## Implementation cues

- For no-arg selectors, pass the worker directly to the helper.
- For selectors with args, pass the args tuple before the worker.
- The first channel emission can have `prevPayload` as `null`/`undefined`; guard transition logic accordingly.
- If multiple dispatches produce intermediate values, model the final UI value with selectors or action design; there is no public lock/unlock action API.
- For generic IPC/websocket/DOM `EventChannel` consumers, route to `svelte-redux-toolkit/channel-effects` instead.

## Examples

### 1. Use takeLatestFromSelector for no-arg selector changes

```ts
import { put } from "typed-redux-saga";
import { takeLatestFromSelector } from "svelte-redux-toolkit/saga";

function* watchCurrentItem() {
  yield* takeLatestFromSelector(selectCurrentItemId, function* ({ payload: itemId }) {
    if (itemId) yield* put(loadItem(itemId));
  });
}
```

### 2. Pass selector arguments as an args tuple

```ts
import { call } from "typed-redux-saga";
import { takeEveryFromSelector } from "svelte-redux-toolkit/saga";

function* watchTodo(todoId: string) {
  yield* takeEveryFromSelector(selectTodoById, [todoId], function* ({ payload: todo }) {
    if (todo) yield* call(syncTodo, todo);
  });
}
```

### 3. Use takeLeadingFromSelector when in-flight work should ignore new values

```ts
import { takeLeadingFromSelector } from "svelte-redux-toolkit/saga";

function* watchCheckoutReadiness() {
  yield* takeLeadingFromSelector(selectCheckoutReady, function* ({ payload: ready }) {
    if (ready) yield* submitCheckoutWorker();
  });
}
```

### 4. Read payload and prevPayload when transition semantics matter

```ts
import { put } from "typed-redux-saga";
import { takeEveryFromSelector } from "svelte-redux-toolkit/saga";

function* watchConnectionStatus() {
  yield* takeEveryFromSelector(selectConnectionStatus, function* ({ payload, prevPayload }) {
    if (prevPayload === "connecting" && payload === "connected") {
      yield* put(connectionEstablished());
    }
  });
}
```

### 5. Use createChannelFromSelector only for custom race/timeout flows

```ts
import { call, delay, race, take } from "typed-redux-saga";
import { createChannelFromSelector } from "svelte-redux-toolkit/saga";

function* waitForFirstReadyItem(itemId: string) {
  const channel = yield* createChannelFromSelector(selectTodoById, itemId);
  try {
    return yield* race({ item: take(channel), timeout: delay(5_000) });
  } finally {
    channel.close();
  }
}
```

### 6. ❌ Bad: wrapping auto-forking helpers or hiding args in closures

```ts
// BAD: the helper already forks and owns channel cleanup; closure args bypass the public args tuple.
function* watchTodoBad(todoId: string) {
  yield* fork(takeLatestFromSelector, () => selectTodoById.select(store.state, todoId), syncTodoWorker);
}

function* watchTodoGood(todoId: string) {
  yield* takeLatestFromSelector(selectTodoById, [todoId], syncTodoWorker);
}
```

## Verification cues

- Test that the selected helper matches desired cancellation behavior (`latest`, `every`, or `leading`).
- For raw channel use, test cancellation/timeout paths and assert cleanup where practical.
- Search for accidental duplicate selector watchers if adding a new watcher for existing state.
- Run the smallest relevant saga tests plus skill-example validation when docs/skills examples change: `npm run validate:skill-examples` in this repository, or `npx svelte-redux-toolkit validate-skill-examples` / `npm exec svelte-redux-toolkit -- validate-skill-examples` in a consuming app.

## Common mistakes to prevent

- Hand-rolled channel loops where `takeLatestFromSelector` is enough.
- Missing `channel.close()` in `finally`.
- Passing selector args through closures instead of an args tuple.
- Using generic `takeLatest(channel, worker)` on a channel created from a selector instead of `takeLatestFromSelector`.

## See also

- `docs/SAGAS.md` — full selector-channel examples and saga context.
- `svelte-redux-toolkit/waitFor` — one-shot selector waits.
- `svelte-redux-toolkit/channel-effects` — generic `EventChannel` consumers.
- `svelte-redux-toolkit/selector-lifecycle` — selector initialization and call modes.
