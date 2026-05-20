---
name: migrate-to-svelte-redux-toolkit/setup
description: >-
  Install svelte-redux-toolkit + peer dependencies, import the package runtime
  directly from npm, wire the Store class in +layout.svelte, and create empty
  reducer and saga registrations so the first slice can be migrated. Covers steps
  1-4 of the ten-step migration checklist.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/component-integration
  - migrate-to-svelte-redux-toolkit
triggers:
  - install peer deps
  - bootstrap layout
  - reducer registry
  - saga registry
---
# Migration — Setup (Pre-Migration Bootstrap)

> Steps 1–4 of the ten-step checklist. Complete this once, before migrating any individual slice.

## Step 1 — Install Dependencies

Install the `svelte-redux-toolkit` package and its peer dependencies with your package manager: `svelte-redux-toolkit`, `redux`, `redux-saga`, `typed-redux-saga`, and `fast-equals`. Add `redux-saga-test-plan` as a dev dependency when saga tests follow this repository's examples.

`svelte@^5` is also required as a peer dependency and is usually already present in the app being migrated. The package `postinstall` copies packaged AI skills into the consuming project root at `.agents/skills/`; it removes stale package-owned files before copying current packaged skills, preserves unrelated project or third-party skills, and excludes generated artifacts such as `skills/_artifacts`. In consumer apps, use the installed package CLI for skill refresh, cleanup, validation, and help:

Consumer CLI commands are `npx svelte-redux-toolkit install-skills`, `npx svelte-redux-toolkit validate-architecture`, `npx svelte-redux-toolkit cleanup-skills`, and `npx svelte-redux-toolkit help`.

The equivalent npm exec form is `npm exec -- svelte-redux-toolkit <command>`. Use this repository's maintainer `npm run validate:*` scripts only when working inside the package repository. npm 7+ does not run dependency uninstall lifecycle scripts; if the migration is rolled back and copied skills should be removed, run `npx svelte-redux-toolkit cleanup-skills` before uninstalling:

On rollback, run `npx svelte-redux-toolkit cleanup-skills` before uninstalling `svelte-redux-toolkit`; remove peer dependencies only if the app no longer uses them.

See `docs/INSTALLATION.md` for the complete consumer install/uninstall flow and the separate maintainer `npm ci` validation flow.

## Step 2 — Import the Package Runtime

Use the npm package directly. Do not copy `svelte-redux-toolkit` source files into your app. Import runtime APIs from the public subpackages: `svelte-redux-toolkit/store`, `svelte-redux-toolkit/saga`, and `svelte-redux-toolkit/types`. If direct utility access is required, use only the documented leaf subpaths under `svelte-redux-toolkit/utils/collections/collection-utils`, `svelte-redux-toolkit/utils/store/*`, or the approved saga utility leaves (`debounce-saga`, `retry-with-timeout`, `wrap-async-generator`, and `selector-channel-effects`).

Migration note: replace old flat package-root imports, removed utilities-subpackage imports, and source-shaped deep imports with one of the public subpackages or approved utility leaf subpaths above. The package does not publish a root runtime API or `svelte-redux-toolkit/utils` barrel.

The package publishes compiled ESM files and TypeScript declarations from `dist/`, so application code should keep only app-specific store setup and slice files under `src/lib/store/`.

## Step 3 — Create the Store and Bootstrap It

Create a single `Store` instance at module scope and add slices to its
constructor maps as they're migrated:

```typescript
// src/lib/store/store.ts
import { Store } from "svelte-redux-toolkit/store";
import type { StoreState } from "svelte-redux-toolkit/types";

export const store = new Store(
  {
    // counter: counterReducer,
  },
  {
    // counterSaga,
  }
);
export type AppState = StoreState<typeof store>;
```

Use `StoreState<typeof store>` for the migrated app state type after adding migrated reducers to the constructor map. Constructor maps preserve state inference without an explicit `: Store` annotation or mutating registration calls. Do not copy or register package-owned internals. `Store` provides internal reducers by default under reserved `@internal_` domains such as `@internal_storeUtility`. The internal saga manager starts during `Store` initialization, but it is not added to the Store saga registry; migrated app slices should use normal app domain names and register/start app-owned sagas only.

Call `store.init()` in the root layout so the store is created at layout
init and disposed when the layout unmounts. As each slice is migrated and
its saga is added to the Store constructor saga map, also start the saga
explicitly with `store.runSaga(name)` from `onMount` — `store.init()` does
not auto-start registered sagas:

The root `+layout.svelte` script calls `store.init()` during component initialization, registers the returned disposer with `onDestroy`, and starts each registered app saga from `onMount` as it is migrated.

For non-component code use `const cancel = store.runSaga(name)` instead —
it returns a cancel function that stops the saga. Both APIs take a
registered saga name string only; there is no function-form variant. For
whole-store teardown in tests or non-component owners, call `store.dispose()`
or the disposer returned by `store.init()` to stop saga tasks owned by the
initialized Store context.

See `skills/svelte-redux-toolkit/component-integration/SKILL.md` for the
full component-integration rules (why `store.init()` must run at init,
how to dispose on unmount, etc.).

## Step 4 — Start With Empty Registrations

`src/lib/store/store.ts` starts out with empty app-owned constructor maps —
the app has not migrated any of its own slices yet, while package internal reducers are still installed automatically under `@internal_` domains. The internal saga manager starts during `Store` initialization and stays outside `getSagas()` / `getSagaNames()`. You'll add one reducer-map entry and/or one saga-map entry per slice as you migrate; never add a manual `@internal_sagaManager` registration.

## After Setup

The project now runs with an empty Redux store. Proceed slice-by-slice:

1. Pick the **simplest, most isolated** store first
2. Run `migrate-to-svelte-redux-toolkit/writable-stores` for `writable()` / `$state`
3. Run `migrate-to-svelte-redux-toolkit/derived-stores` for `derived()` / `$derived`
4. Run `migrate-to-svelte-redux-toolkit/side-effects` for `$effect` / `fetch` / timers
5. Run `migrate-to-svelte-redux-toolkit/component-migration` to swap consumers
6. Run `migrate-to-svelte-redux-toolkit/cleanup` to delete the old store file

Per slice, create `src/lib/store/slices/{name}/{name}-slice.ts`, `src/lib/store/slices/{name}/{name}-selectors.ts`, and `src/lib/store/slices/{name}/sagas/{name}-saga.ts`. Then register its app-owned reducer and saga in the `Store` constructor maps in `src/lib/store/store.ts`, and add a matching `onMount(() => store.runSaga(name))` call in the root layout so the saga actually runs.

## Examples in This Skill

- Retained: empty Store bootstrap with `StoreState<typeof store>` inference in Step 3.
- Added: explicit empty registry bootstrap; app reducer/saga constructor maps; root layout lifecycle script; imperative saga cancel function; bad runSaga-before-init/internal-registration examples.

## Setup Examples

### 1. Start with explicit empty app-owned registries

```typescript
import { Store } from "svelte-redux-toolkit/store";
import type { StoreState } from "svelte-redux-toolkit/types";

export const store = new Store({}, {});
export type AppState = StoreState<typeof store>;
```

### 2. Add each migrated slice through constructor maps

```typescript
import { Store } from "svelte-redux-toolkit/store";
import type { StoreState } from "svelte-redux-toolkit/types";
import { counterReducer } from "$lib/store/slices/counter/counter-slice";
import { counterSaga } from "$lib/store/slices/counter/sagas/counter-saga";

export const store = new Store(
  { counter: counterReducer },
  { counterSaga }
);

export type AppState = StoreState<typeof store>;
```

### 3. Initialize Store lifetime from the root layout script

```typescript
import { onDestroy, onMount } from "svelte";
import { store } from "$lib/store/store";

const disposeStore = store.init();

onDestroy(disposeStore);
onMount(() => store.runSaga("counterSaga"));
```

### 4. Start and cancel a saga from non-component code after init

```typescript
import { store } from "$lib/store/store";

const disposeStore = store.init();
const cancelCounterSaga = store.runSaga("counterSaga");

cancelCounterSaga();
disposeStore();
```

### 5. Prove empty bootstrap has no app-owned sagas yet

```typescript
import { Store } from "svelte-redux-toolkit/store";

const store = new Store({}, {});
const appSagaNames = store.getSagaNames();
const appReducers = store.getReducers();

export const emptyBootstrapEvidence = {
  appSagaNames,
  hasNoAppSagas: appSagaNames.length === 0,
  reducerDomainsVisibleToApp: Object.keys(appReducers),
};
```

### 6. ❌ Bad: start sagas before init or register internals manually

```typescript
// ❌ BAD: runSaga before init throws, and @internal_sagaManager is package-owned.
import { Store } from "svelte-redux-toolkit/store";

function* counterSaga() {}
function* fakeInternalSagaManager() {}

const store = new Store(undefined, {
  counterSaga,
  "@internal_sagaManager": fakeInternalSagaManager,
});

store.runSaga("counterSaga");
```

## Cases Covered

| Case | Example |
| --- | --- |
| Empty pre-migration bootstrap | Step 3 bootstrap and Start with explicit empty app-owned registries |
| Reducer/saga registration | Add each migrated slice through constructor maps |
| Root layout lifecycle | Initialize Store lifetime from the root layout script |
| Non-component lifecycle owner | Start and cancel a saga from non-component code after init |
| Empty registry evidence | Prove empty bootstrap has no app-owned sagas yet |
| Incorrect setup ordering/internal registration | Bad: start sagas before init or register internals manually |

