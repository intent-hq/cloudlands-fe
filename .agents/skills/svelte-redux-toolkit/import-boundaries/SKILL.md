---
name: svelte-redux-toolkit/import-boundaries
description: >-
  Which store modules components may import (actions, selectors, types,
  and the initialized Store instance for dispatch/one-shot reads) and which
  are forbidden (saga files, operation modules, reducer internals, collection
  utils). .svelte files must never import typed-redux-saga or
  redux-saga. Services/non-component TS may import actions and selectors;
  sagas may import anything inside the store directory.
type: sub-skill
requires:
  - svelte-redux-toolkit
  - svelte-redux-toolkit/core-policy
triggers:
  - import boundaries
  - saga import rule
  - dispatch subpath
  - forbidden imports
---
# Import Boundaries

> Source: `skills/svelte-redux-toolkit/SKILL.md` §2; `package.json` exports map; `src/index.ts`; `src/store.ts`; `docs/ARCHITECTURE.md` maintainer validation.

## Setup — the package export surface

The documented public surface is the approved subpackage interface plus explicit utility leaf subpaths. Do not teach consumers to import from the package root, from removed broad utility barrels, or from source-shaped deep paths.

The utility exports are explicit leaf entries, not wildcard domains. The package still does not export the root `svelte-redux-toolkit`, `svelte-redux-toolkit/utils`, `svelte-redux-toolkit/utils/runtime/*`, `svelte-redux-toolkit/utils/selectors/*`, `svelte-redux-toolkit/src/*`, or directory `index` barrels. Current package version is `0.1.1`.

The relevant public subpackages components, services, and sagas actually use:

- `svelte-redux-toolkit/store` — `Store` only. Per-store operations go through the configured `Store` instance (`store.init`, `store.dispatch`, `store.state`, `store.createSelector`, `store.runSaga`, `store.dispose`). Utility helpers are not exported here; use the explicit utility leaf subpaths below.
- `svelte-redux-toolkit/saga` — saga authoring helpers: `waitFor`, selector-channel helpers, and debounce/retry/streaming helpers.
- `svelte-redux-toolkit/types` — public TypeScript-only types such as `StoreState`, `PreloadedStoreState`, action, middleware, selector, reducer, and saga map types.
- `svelte-redux-toolkit/utils/collections/collection-utils` — approved direct collection utility leaf.
- `svelte-redux-toolkit/utils/store/create-action`, `/create-reducer`, `/boolean-preference`, `/domain-scoped` — the only package-level store utility leaf imports.
- `svelte-redux-toolkit/utils/sagas/debounce-saga`, `/retry-with-timeout`, `/wrap-async-generator`, `/selector-channel-effects` — approved direct saga utility leaves. Safe localStorage helpers are example/app-local utilities, not package exports.

Migration note: replace flat package-root examples, removed utilities-subpackage imports, and source-shaped deep imports with one of the public subpackages or approved utility leaf subpaths above.

## Core Patterns

### Components (`*.svelte`, component-level `*.ts`) — allowed

- ✅ Actions from `*-slice.ts`
- ✅ Selectors from `*-selectors.ts`
- ✅ Types from `*-types.ts`
- ✅ The app's existing initialized `Store` instance for dispatch and one-time reads in event handlers (`store.dispatch`, `store.state`)

### Components — forbidden

- ❌ Saga files (`sagas/*.ts`) — never import saga source into a component
- ❌ Operation/utility modules that dispatch internally
- ❌ Reducer internals or store init/setup modules
- ❌ Collection utils directly (access collections through selectors)
- ❌ `typed-redux-saga` or `redux-saga` — saga effect libraries have no meaning in a component; importing them at minimum bloats the bundle and often drags the saga middleware into client code

### Services and non-component TS

Services may import actions, selectors, and the app's existing initialized `Store` instance captured outside callbacks. They may **not** import sagas directly — call `store.dispatch(triggeringAction())` instead.

### Sagas

Sagas may import anything within the store directory (actions, selectors, other sagas, reducer internals, collection utils, app-local safe localStorage helpers, `typed-redux-saga` effects). This is the only layer where `yield*` of `typed-redux-saga` effects is allowed.

## Examples

### 1. Public package subpaths and utility leaf imports

```ts
import { Store } from "svelte-redux-toolkit/store";
import type { StoreState } from "svelte-redux-toolkit/types";
import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { debounceSaga } from "svelte-redux-toolkit/saga";
import type { Collection } from "svelte-redux-toolkit/utils/collections/collection-utils";

type Todo = { id: string; title: string };
export type PublicState = StoreState & { todos?: { items: Collection<Todo, "id"> } };
export const loadTodos = createAction("todos/load");
export const publicApi = { Store, debounceSaga, loadTodos };
```

### 2. Component imports actions, selectors, types, and the initialized Store instance

```ts
import { store } from "$lib/store";
import { selectItems, selectIsLoading } from "./slices/items/items-selectors";
import { removeItem } from "./slices/items/items-slice";
import type { Item } from "./slices/items/items-types";

export const items = selectItems();
export const loading = selectIsLoading();

export function handleDelete(item: Item) {
  const currentItems = selectItems.select(store.state);
  if (currentItems.length > 1) store.dispatch(removeItem(item.id));
}
```

### 3. Service/non-component TS uses one-shot reads and dispatch, not saga source

```ts
import { store } from "$lib/store";
import { selectQueuedJob } from "$lib/store/slices/jobs/jobs-selectors";
import { startJob } from "$lib/store/slices/jobs/jobs-slice";

export function startQueuedJob(jobId: string) {
  const queuedJob = selectQueuedJob.select(store.state, jobId);
  if (queuedJob) store.dispatch(startJob(jobId));
}
```

### 4. Saga layer may import saga effects, selectors, actions, and saga utilities

```ts
import { call, put, takeLatest } from "typed-redux-saga";
import { debounceSaga } from "svelte-redux-toolkit/saga";
import { loadJobs, refreshJobs } from "../jobs-slice";
import { selectQueuedJob } from "../jobs-selectors";

declare const api: { runJob(id: string): Promise<void> };

export function* jobsSaga() {
  yield* takeLatest(loadJobs, function* loadQueuedJob(action: { payload: [string] }) {
    const job = yield* selectQueuedJob.effect(action.payload[0]);
    if (job) yield* call(api.runJob, job.id);
    yield* put(refreshJobs());
  });
  yield* debounceSaga(refreshJobs, 250);
}
```

## Common Mistakes

### ❌ Importing saga files from components

Pulls saga side-effect code into the component bundle and invites direct saga invocation, which breaks the saga lifecycle.

```ts
// BAD: component-adjacent code imports saga source and bypasses Store.runSaga lifecycle.
import { fetchItemsSaga } from "./slices/items/sagas/items-saga";

export function loadFromComponent() {
  const task = fetchItemsSaga();
  task.next();
}
```

```ts
import { store } from "$lib/store";
import { fetchItems } from "./slices/items/items-slice";

export function loadFromComponent() {
  store.dispatch(fetchItems());
}
```

Source: `skills/svelte-redux-toolkit/SKILL.md` §2 · **Priority: HIGH**

### ❌ Hiding dispatch inside service helpers

Components and services should dispatch through the configured app `Store` instance or receive a dispatch function explicitly. A helper that captures a hidden module-level dispatch creates an unreviewable second boundary even when all imports type-check.

```ts
// BAD: callers cannot see which Store instance owns this side effect.
import { store } from "$lib/store";
import { addItem } from "$lib/store/slices/items/items-slice";

export function queueItemFromAnywhere(id: string) {
  setTimeout(() => store.dispatch(addItem(id)), 0);
}
```

```ts
import type { Store } from "svelte-redux-toolkit/store";
import { addItem } from "$lib/store/slices/items/items-slice";

export function queueItem(store: Store, id: string) {
  setTimeout(() => store.dispatch(addItem(id)), 0);
}
```

Source: `skills/svelte-redux-toolkit/SKILL.md` §2, §7 · **Priority: MEDIUM**

### ❌ Importing from `typed-redux-saga` in a `.svelte` file

`typed-redux-saga` effects (`call`, `put`, `select`, `takeEvery`, ...) only have meaning inside saga generators. Importing them in a component has no runtime benefit, bloats the client bundle, and in test environments drags the saga mock (`svelte-redux-toolkit/testing`) into non-saga files.

```ts
// BAD: component code creates an effect descriptor that no saga middleware will run.
import { put } from "typed-redux-saga";
import { triggerEffect } from "./slices/effects/effects-slice";

export function handleClick() {
  return put(triggerEffect());
}
```

```ts
import { store } from "$lib/store";
import { triggerEffect } from "./slices/effects/effects-slice";

export function handleClick() {
  store.dispatch(triggerEffect());
}
```

Source: `skills/svelte-redux-toolkit/SKILL.md` §2 (Components must never import saga files / redux-saga effects) · **Priority: HIGH**

### Examples retained/added

| # | Example | Kind |
| ---: | --- | --- |
| 1 | Public package subpaths and utility leaf imports | Good |
| 2 | Component imports actions/selectors/types/Store instance | Good |
| 3 | Service one-shot selector read plus dispatch | Good |
| 4 | Saga-layer imports and typed-redux-saga usage | Good |
| 5 | Component importing saga source and direct generator stepping | Bad |
| 6 | Correct action dispatch replacement for saga import | Good |
| 7 | Hidden module-level dispatch helper in service code | Bad |
| 8 | Explicit Store-parameter dispatch helper | Good |
| 9 | Component importing typed-redux-saga effect descriptors | Bad |
| 10 | Correct component Store dispatch replacement | Good |

### Cases covered

| Case | Examples |
| --- | --- |
| Current public package API and version `0.1.1` | 1 |
| Component import allowlist and Store-first dispatch/read | 2, 6, 8, 10 |
| Service/non-component one-shot access | 3, 7, 8 |
| Saga-only imports/effects and public saga utilities | 4, 5, 9 |
| Realistic boundary mistakes not limited to missing APIs | 5, 7, 9 |

## See also

- `svelte-redux-toolkit/core-policy/SKILL.md` — the policy these boundaries enforce
- `svelte-redux-toolkit/component-integration/SKILL.md` — Store dispatch + selector usage inside components

