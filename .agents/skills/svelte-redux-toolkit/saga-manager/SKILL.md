---
name: svelte-redux-toolkit/saga-manager
description: >-
  Agent guidance for the package-owned saga manager: crash tracking in manager
  status and serialized addCrash reports, per-saga cleanup with clearCrashes,
  internal crash report storage keyed by saga name with newest
  MAX_SAGA_CRASH_REPORTS retained, Store runSaga start/stop/restart behavior,
  and getBackOffDelay exponential backoff. Do not teach app code to import
  package-internal saga-manager files.
type: sub-skill
library: svelte-redux-toolkit
library_version: 0.1.1
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/sagas
  - svelte-redux-toolkit/import-boundaries
  - svelte-redux-toolkit/state-serialization
sources:
  - augmentcode/svelte-redux-toolkit:docs/SAGAS.md#saga-manager
  - augmentcode/svelte-redux-toolkit:src/store.ts
  - augmentcode/svelte-redux-toolkit:src/slices/saga-manager/sagas/manager.ts
  - augmentcode/svelte-redux-toolkit:src/slices/saga-manager/saga-manager-slice.ts
triggers:
  - saga manager
  - saga crash
  - store.runSaga
  - Store.dispose
  - addCrash
  - clearCrashes
  - saga restart
  - getBackOffDelay
---

# Saga Manager — crash and restart guidance

Use this skill when an agent must explain, verify, or minimally adjust saga manager guidance. Keep `docs/SAGAS.md#saga-manager` as the human-facing source for long-form behavior; this file is the concise operational checklist.

## Agent preflight compliance contract

- **MUST** read `docs/SAGAS.md#saga-manager`, this skill, and any touched source before editing saga-manager guidance.
- **MUST** cite whether the task concerns public Store lifecycle behavior or package-owned internals.
- **MUST** preserve import boundaries: app code uses public `Store` APIs and registered saga names, not `src/slices/saga-manager/*`.
- **SHOULD** run `npm run validate:skill-examples` after changing skill examples and targeted saga-manager tests when behavior claims change.
- **NEVER** document `addCrash`, `clearCrashes`, reducer state paths, or `@internal_sagaManager` as public app APIs unless a separate public export task approves it.

## Setup — where the manager fits

- `Store.init()` starts the package-owned saga manager internally, bound to the app saga registry snapshot.
- App sagas are registered with `Store.registerSagas(sagasMap)` and started explicitly with `store.runSaga(name)`.
- `store.runSaga(name)` dispatches `startSaga(name)` and returns a cancel function that dispatches `stopSaga(name)`; the manager listens for those lifecycle actions.
- `Store.dispose()` and the disposer returned by `Store.init()` tear down the initialized Store runtime and stop Store-owned saga tasks, including running app sagas forked by the manager.
- The reserved manager name is `@internal_sagaManager`; do not register, run, or expose it as an app saga.

## Core Patterns

### 1. Crash tracking has two package-owned surfaces

- In-memory manager status tracks `isRunning`, `launchedAtTs`, and raw crash records (`Date` + `Error`) for monitoring/restart logic.
- On every unhandled saga error, the manager also dispatches `addCrash(sagaName, report)` with a serialized report: `crashedAtTs` plus plain `{ name, message, stack? }` error data.
- The serialized path keeps Redux state serializable; the raw status record types remain implementation details.

### 2. Crash report storage and retention

- The internal saga-manager reducer state is package-owned and keyed by saga name.
- Each entry is `{ reports, omittedCount }`; `reports` contains serialized crash reports for that saga only.
- The reducer keeps the newest `MAX_SAGA_CRASH_REPORTS` reports. When older reports are trimmed, `omittedCount` increases by the number trimmed.

### 3. Cleaning crash records is per saga name

- `clearCrashes(sagaName)` deletes only that saga name's crash entry.
- Clearing one saga does not clear reports for other saga names.
- Treat `clearCrashes` as package-internal until a public export/API is intentionally added.

### 4. Start, stop, restart, and backoff mechanics

- Multiple overlapping `store.runSaga(name)` calls for the same saga share one running task and increment a reference counter.
- The saga stops only after every returned cancel function has been invoked.
- Full Store disposal is a separate lifecycle boundary: use `store.dispose()` only when ending the whole Store context, not as a replacement for normal per-mount `store.runSaga(name)` cancels.
- If the managed saga throws an unhandled error, `autoRestart` records the crash, logs it, waits, and restarts the saga automatically.
- `getBackOffDelay(restarts)` is `min(1000 * 2^restarts, 10 minutes)`: first restart waits 1s, then 2s, 4s, and so on up to the cap.
- Restart pressure decays after stable runtime: before incrementing, the manager subtracts one restart count per full minute since the last start, bounded at zero.

## Examples

### 1. Register app sagas with `registerSagas(...)` and start them explicitly

```ts
import { onMount } from "svelte";
import { Store } from "svelte-redux-toolkit/store";

export const store = new Store({ todos: todosReducer }).registerSagas({ syncTodos: syncTodosSaga });
store.init();

onMount(() => store.runSaga("syncTodos"));
```

### 2. Pair every runSaga owner with its own cancel function

```ts
const cancelListPage = store.runSaga("syncTodos");
const cancelDetailsPanel = store.runSaga("syncTodos");

cancelListPage();
// syncTodos stays running for the details panel owner.
cancelDetailsPanel();
// syncTodos can stop after the final owner cancels.
```

### 3. Use Store disposal only for whole-store teardown

```ts
const disposeStore = store.init({ todos: preloadedTodosState });
const cancelSync = store.runSaga("syncTodos");

cancelSync();
disposeStore();
```

### 4. Describe persisted crash reports as serialized package-owned state

```ts
type PersistedSagaCrashReport = {
  crashedAtTs: number;
  error: { name: string; message: string; stack?: string };
};

const syncTodosCrash: PersistedSagaCrashReport = {
  crashedAtTs: Date.now(),
  error: { name: "Error", message: "network failed" },
};
```

### 5. Model per-saga cleanup without implying global crash deletion

```ts
type CrashState = Record<string, { reports: unknown[]; omittedCount: number }>;

const afterClearingSyncTodos: CrashState = {
  syncUsers: { reports: [{ crashedAtTs: 1 }], omittedCount: 0 },
};
```

### 6. ❌ Bad: using Store.dispose as routine per-saga cleanup

```ts
// BAD: this tears down the whole initialized Store context for all owners.
function closeDetailsPanel() {
  store.dispose();
}

function closeDetailsPanelSafely(cancelSyncTodos: () => void) {
  cancelSyncTodos();
}
```

## Common mistakes to prevent

- **Promoting internals as app APIs** — `addCrash`, `clearCrashes`, raw manager status records, reducer state keys, and `@internal_sagaManager` are package-owned. Source: `docs/SAGAS.md#saga-manager`; `src/store.ts`; `src/slices/saga-manager/saga-manager-slice.ts`.
- **Saying cleanup is global** — `clearCrashes(sagaName)` removes only one saga entry. Source: `src/slices/saga-manager/saga-manager-slice.ts`.
- **Forgetting reference counting** — duplicate `store.runSaga(name)` calls share the saga and require matching cancels before the task stops. Source: `src/store.ts`; `src/slices/saga-manager/sagas/manager.ts`.
- **Using Store disposal as per-saga cleanup** — `store.dispose()` stops tasks owned by the initialized Store context as part of whole-store teardown; use `store.runSaga(name)` cancel functions for normal saga lifetimes. Source: `src/store.ts`.
- **Flattening backoff behavior** — backoff starts at 1s, doubles to a 10-minute cap, and restart pressure decays after stable runtime. Source: `src/slices/saga-manager/sagas/manager.ts`.

## Verification cues

- Skill/doc-only edits with examples: run `npm run validate:skill-examples`.
- Metadata or architecture-governed examples changed: run `npm run validate:architecture`.
- Behavior-sensitive claims changed or questioned: run `npx --no-install vitest run src/slices/saga-manager/sagas/manager.test.ts`.

## See also

- `docs/SAGAS.md#saga-manager` — canonical human-facing explanation.
- `svelte-redux-toolkit/sagas` — general typed-redux-saga implementation rules.
- `svelte-redux-toolkit/import-boundaries` — public package exports and forbidden deep imports.
- `svelte-redux-toolkit/testing` — saga/reducer verification patterns.