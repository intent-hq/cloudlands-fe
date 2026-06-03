---
name: svelte/migration/setup
description: >-
  Install ag-redux-toolkit + peer dependencies, import the package runtime
  directly from npm, wire the Store class in +layout.svelte, and create empty
  reducer and saga registrations so the first slice can be migrated. Covers steps
  1-4 of the ten-step migration checklist.
type: sub-skill
requires:
  - svelte
  - svelte/component-integration
  - svelte/migration
triggers:
  - install peer deps
  - bootstrap layout
  - reducer registry
  - saga registry
---
# Migration — Setup (Pre-Migration Bootstrap)

> Steps 1–4 of the ten-step checklist. Complete this once, before migrating any individual slice.

## Step 1 — Install Dependencies

Install the `ag-redux-toolkit` package and its peer dependencies with your package manager: `ag-redux-toolkit`, `redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals`. Add `redux-saga-test-plan` as a dev dependency when saga tests follow this repository's examples.

`svelte@^5` is also required as a peer dependency and is usually already present in the app being migrated. Package installation does not copy AI skills automatically. In consumer apps, use the installed package CLI for explicit skill refresh, cleanup, validation, and help; the skill install command removes stale package-owned files before copying current packaged skills, preserves unrelated project or third-party skills, and excludes generated artifacts such as `skills/_artifacts`:

Consumer CLI commands are `npx ag-redux-toolkit install-skills`, `npx ag-redux-toolkit validate-architecture`, `npx ag-redux-toolkit cleanup-skills`, and `npx ag-redux-toolkit help`.

The equivalent npm exec form is `npm exec -- ag-redux-toolkit <command>`. Use this repository's maintainer `npm run validate:*` scripts only when working inside the package repository. npm 7+ does not run dependency uninstall lifecycle scripts; if the migration is rolled back and copied skills should be removed, run `npx ag-redux-toolkit cleanup-skills` before uninstalling:

On rollback, run `npx ag-redux-toolkit cleanup-skills` before uninstalling `ag-redux-toolkit`; remove peer dependencies only if the app no longer uses them.

See `docs/INSTALLATION.md` for the complete consumer install/uninstall flow and the separate maintainer `npm ci` validation flow.

## Step 2 — Import the Package Runtime

Use the npm package directly. Do not copy `ag-redux-toolkit` source files into your app. Import runtime APIs from the public subpackages: `ag-redux-toolkit/svelte-store`, `ag-redux-toolkit/saga`, and `ag-redux-toolkit/types`. If direct utility access is required, use only the documented leaf subpaths under `ag-redux-toolkit/utils/collections/collection-utils`, `ag-redux-toolkit/utils/store/*`, or the approved saga utility leaves (`debounce-saga`, `retry-with-timeout`, `wrap-async-generator`, and `selector-channel-effects`).

Migration note: replace old flat package-root imports, removed utilities-subpackage imports, and source-shaped deep imports with one of the public subpackages or approved utility leaf subpaths above. The package does not publish a root runtime API or `ag-redux-toolkit/utils` barrel.

The package publishes compiled ESM files and TypeScript declarations from `dist/`, so application code should keep only app-specific store setup and slice files under `src/lib/store/`.

## Step 3 — Create the Store and Bootstrap It

Create a single `Store` instance at module scope, add reducers to the
constructor map, and register sagas as slices are migrated:

```typescript
// src/lib/store/store.ts
import { Store } from "ag-redux-toolkit/svelte-store";
import type { StoreState } from "ag-redux-toolkit/types";

export const store = new Store({
  // counter: counterReducer,
});
export type AppState = StoreState<typeof store>;
```

Use `StoreState<typeof store>` for the migrated app state type after adding migrated reducers to the constructor map. Constructor reducer maps preserve state inference without an explicit `: Store` annotation. Do not copy or register package-owned internals. `Store` provides internal reducers by default under reserved `@internal_` domains such as `@internal_storeUtility`. The internal saga manager starts during Store initialization; migrated app slices should use normal app domain names and start app-owned sagas only with `store.runSaga(sagaFn)`.

Call `store.init()` in the root layout so the store is created at layout
init and disposed when the layout unmounts. As each slice is migrated and
its saga is available, start the saga explicitly with `store.runSaga(sagaFn)`
from `onMount` — `store.init()` does not auto-start app sagas:

The root `+layout.svelte` script calls `store.init()` during component initialization, registers the returned disposer with `onDestroy`, and starts each app saga from `onMount` as it is migrated.

For non-component code use `const cancel = store.runSaga(sagaFn)` instead —
it returns a cancel function that stops the saga. For
whole-store teardown in tests or non-component owners, call `store.dispose()`
or the disposer returned by `store.init()` to stop saga tasks owned by the
initialized Store context.

See `../../component-integration/SKILL.md` for the
full component-integration rules (why `store.init()` must run at init,
how to dispose on unmount, etc.).

## Step 4 — Start With Empty Registrations

`src/lib/store/store.ts` starts out with an empty app-owned reducer map and no app sagas started —
the app has not migrated any of its own slices yet, while package internal reducers are still installed automatically under `@internal_` domains. The internal saga manager starts during `Store` initialization. You'll add one reducer-map entry per slice and a matching `store.runSaga(sagaFn)` startup call as you migrate; never start a manual `@internal_sagaManager` saga.

## After Setup

The project now runs with an empty Redux store. Proceed slice-by-slice:

1. Pick the **simplest, most isolated** store first
2. Run `svelte/migration/writable-stores` for `writable()` / `$state`
3. Run `svelte/migration/derived-stores` for `derived()` / `$derived`
4. Run `svelte/migration/side-effects` for `$effect` / `fetch` / timers
5. Run `svelte/migration/component-migration` to swap consumers
6. Run `svelte/migration/cleanup` to delete the old store file

Per slice, create `src/lib/store/slices/{name}/{name}-slice.ts`, `src/lib/store/slices/{name}/{name}-selectors.ts`, and `src/lib/store/slices/{name}/sagas/{name}-saga.ts`. Then add its app-owned reducer to the `Store` constructor map and add a matching `onMount(() => store.runSaga(sagaFn))` call in the root layout so the saga actually runs.

## Examples in This Skill

- Retained: empty Store bootstrap with `StoreState<typeof store>` inference in Step 3.
- Added: explicit empty bootstrap; app reducer constructor maps; root layout lifecycle script; imperative saga cancel function; bad runSaga-before-init/internal saga examples.

## Setup Examples

### 1. Start with an explicit empty app-owned reducer map

```typescript
import { Store } from "ag-redux-toolkit/svelte-store";
import type { StoreState } from "ag-redux-toolkit/types";

export const store = new Store({});
export type AppState = StoreState<typeof store>;
```

### 2. Add each migrated slice through the reducer map

```typescript
import { Store } from "ag-redux-toolkit/svelte-store";
import type { StoreState } from "ag-redux-toolkit/types";
import { counterReducer } from "$lib/store/slices/counter/counter-slice";
import { counterSaga } from "$lib/store/slices/counter/sagas/counter-saga";

export const store = new Store({ counter: counterReducer });

export type AppState = StoreState<typeof store>;
```

### 3. Initialize Store lifetime from the root layout script

```typescript
import { onDestroy, onMount } from "svelte";
import { store } from "$lib/store/store";
import { counterSaga } from "$lib/store/slices/counter/sagas/counter-saga";

const disposeStore = store.init();

onDestroy(disposeStore);
onMount(() => store.runSaga(counterSaga));
```

### 4. Start and cancel a saga from non-component code after init

```typescript
import { store } from "$lib/store/store";
import { counterSaga } from "$lib/store/slices/counter/sagas/counter-saga";

const disposeStore = store.init();
const cancelCounterSaga = store.runSaga(counterSaga);

cancelCounterSaga();
disposeStore();
```

### 5. Prove empty bootstrap has app reducers only

```typescript
import { Store } from "ag-redux-toolkit/svelte-store";

const store = new Store({});
const appReducers = store.getReducers();

export const emptyBootstrapEvidence = {
  reducerDomainsVisibleToApp: Object.keys(appReducers),
};
```

### 6. ❌ Bad: start sagas before init or start internals manually

```typescript
// ❌ BAD: runSaga before init throws, and @internal_sagaManager is package-owned.
import { Store } from "ag-redux-toolkit/svelte-store";

function* counterSaga() {}
function* fakeInternalSagaManager() {}
Object.defineProperty(fakeInternalSagaManager, "name", { value: "@internal_sagaManager" });

const store = new Store();

store.runSaga(counterSaga);
store.init();
store.runSaga(fakeInternalSagaManager);
```

## Cases Covered

| Case | Example |
| --- | --- |
| Empty pre-migration bootstrap | Step 3 bootstrap and Start with an explicit empty app-owned reducer map |
| Reducer/saga startup | Add each migrated slice through the reducer map and `store.runSaga(sagaFn)` |
| Root layout lifecycle | Initialize Store lifetime from the root layout script |
| Non-component lifecycle owner | Start and cancel a saga from non-component code after init |
| Empty bootstrap evidence | Prove empty bootstrap has app reducers only |
| Incorrect setup ordering/internal startup | Bad: start sagas before init or start internals manually |
