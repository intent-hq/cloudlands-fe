---
name: svelte-redux-toolkit/waitFor
description: >-
  Concise agent rules for waitFor(selector, argsTuple, predicate, timeoutMs?).
  Use when a saga must pause until a named selector reaches a predicate. It
  checks the current value first, subscribes through createChannelFromSelector,
  returns true on match and false on timeout, and closes the channel in finally.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/selectors
  - svelte-redux-toolkit/sagas
triggers:
  - waitFor selector
  - suspend saga
  - wait predicate
  - timeout wait
---
# waitFor — agent implementation rules

Use this skill for one-shot saga waits on selector state. Keep conceptual/API prose and examples in `docs/WAITFOR.md`; this skill should stay concise and operational.

## Canonical references

- Human guide: `docs/WAITFOR.md`
- Source: `src/slices/store-utility/sagas/waitFor.ts`
- Channel source: `src/utils/sagas/selector-channel-effects.ts`
- Related skills: `svelte-redux-toolkit/sagas`, `svelte-redux-toolkit/selectors`, `svelte-redux-toolkit/selector-channels`, `svelte-redux-toolkit/testing`

## Use when

- A saga must wait for a selector value before continuing.
- The condition is one-shot: proceed after the predicate matches or timeout handling runs.
- The selector already exists as a named selector, authored with `store.createSelector(...)` for app-local selectors when a configured Store exists.

## Do

- Call as `waitFor(selector, argsTuple, predicate, timeoutMs?)`.
- Pass `[]` for no-arg selectors and `[arg1, arg2]` for selector arguments.
- Keep the predicate pure: no dispatches, API calls, mutations, timers, or state reads.
- Add a timeout for production waits unless an indefinite wait is explicitly safe.
- Check the boolean return when a timeout is supplied.
- Guard previous-value comparisons because the immediate check passes `undefined` as `prevVal`, and the first selector-channel emission can pass `null`.

## Don't

- Do not pass inline selectors or closures; create/reuse a named selector.
- Do not swap the args tuple and predicate.
- Do not ignore `false` from timed waits.
- Do not use `waitFor` for polling or continuous reactions; use `takeLatestFromSelector`, `takeEveryFromSelector`, or a selector channel instead.
- Do not duplicate the implementation's channel/race logic in app code.

## Implementation cues

- Import from `svelte-redux-toolkit/saga` unless an existing app-local barrel already re-exports it.
- For boolean readiness, predicate on the desired final value rather than assuming truthiness.
- For status transitions, include the terminal states in the predicate and branch after `waitFor` if different terminal outcomes matter.
- For timeout paths, dispatch or return an explicit timeout outcome before continuing with state-dependent work.
- If a saga needs every future selector change, route to `svelte-redux-toolkit/selector-channels` instead.

## Examples

### 1. Wait for a no-arg boolean selector and handle timeout

```ts
import { put } from "typed-redux-saga";
import { waitFor } from "svelte-redux-toolkit/saga";

function* loadWhenReady() {
  const ready = yield* waitFor(selectIsReady, [], (value) => value === true, 5_000);
  if (!ready) {
    yield* put(loadTimedOut());
    return;
  }
  yield* put(loadData());
}
```

### 2. Pass selector arguments as the required args tuple

```ts
import { waitFor } from "svelte-redux-toolkit/saga";

function* processItem(itemId: string) {
  const ready = yield* waitFor(selectItemStatus, [itemId], (status) => status === "ready", 10_000);
  if (ready) yield* startItemProcessing(itemId);
}
```

### 3. Guard previous-value comparisons on the immediate check

```ts
import { waitFor } from "svelte-redux-toolkit/saga";

function* waitForReconnect() {
  const reconnected = yield* waitFor(
    selectConnectionStatus,
    [],
    (value, prevVal) => prevVal === "connecting" && value === "connected",
    15_000
  );
  return reconnected;
}
```

### 4. Branch after terminal-state waits

```ts
import { put } from "typed-redux-saga";
import { waitFor } from "svelte-redux-toolkit/saga";

function* waitForUpload(uploadId: string) {
  const finished = yield* waitFor(selectUploadPhase, [uploadId], (phase) => phase === "done" || phase === "failed", 60_000);
  if (!finished) return yield* put(uploadTimedOut(uploadId));
  const phase = yield* selectUploadPhase.effect(uploadId);
  if (phase === "failed") yield* put(uploadFailed(uploadId));
}
```

### 5. Use waitFor inside an action worker before state-dependent work

```ts
import { call, put } from "typed-redux-saga";
import { waitFor } from "svelte-redux-toolkit/saga";

function* publishAfterAuthWorker(action: ReturnType<typeof publishDocument>) {
  const authenticated = yield* waitFor(selectAuthReady, [], Boolean, 5_000);
  if (!authenticated) return yield* put(publishRejected(action.payload[0], "auth-timeout"));
  yield* call(api.publishDocument, action.payload[0]);
}
```

### 6. ❌ Bad: ignoring false and treating prevVal as present on the first check

```ts
// BAD: timeout false is ignored, and prevVal can be undefined or null before a real transition.
function* publishAfterAnyStatusChange(documentId: string) {
  yield* waitFor(selectDocumentStatus, [documentId], (value, prevVal) => value !== prevVal, 5_000);
  yield* call(api.publishDocument, documentId);
}

function* publishAfterRealStatusChange(documentId: string) {
  const changed = yield* waitFor(
    selectDocumentStatus,
    [documentId],
    (value, prevVal) => prevVal !== undefined && prevVal !== null && value !== prevVal,
    5_000
  );
  if (changed) yield* call(api.publishDocument, documentId);
}
```

## Verification cues

- Test immediate-match, later-match, and timeout paths when changing `waitFor` usage.
- In saga tests, provide selector `.effect(...)` values and channel/timer effects through existing test helpers.
- Run the smallest relevant saga tests plus skill-example validation when docs/skills examples change: `npm run validate:skill-examples` in this repository, or `npx svelte-redux-toolkit validate-skill-examples` / `npm exec svelte-redux-toolkit -- validate-skill-examples` in a consuming app.

## Common mistakes to prevent

- `waitFor(selectReady, predicate)` — missing `[]` args tuple.
- Acting after a timed wait without checking the returned boolean.
- Predicate change detection that treats initial `prevVal === undefined` or first-emission `prevVal === null` as a real transition.
- Replacing one-shot waits with hand-rolled selector channels.

## See also

- `docs/WAITFOR.md` — full signature, behavior walkthrough, and examples.
- `docs/SAGAS.md` — selector-channel and saga orchestration context.
- `svelte-redux-toolkit/selector-channels` — continuous selector watchers.
- `svelte-redux-toolkit/selector-lifecycle` — selector call modes.
