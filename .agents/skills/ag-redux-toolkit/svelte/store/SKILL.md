---
name: svelte/store
description: >-
  Store import, initialization, disposal, and Store-runtime guidance for the
  canonical Svelte-readable Store variant. Use for @augmentcode/ag-redux-toolkit/svelte-store,
  getReadableState(), useInitStore/useRunSaga lifecycle helpers, inherited
  runSaga/dispatch/state behavior, and contrast with ReactStore or
  StreamingStore without teaching those call modes.
type: sub-skill
requires:
  - svelte
  - core/import-boundaries
sources:
  - "@augmentcode/ag-redux-toolkit/svelte-store"
  - "@augmentcode/ag-redux-toolkit/components-svelte/use-init-store"
  - "@augmentcode/ag-redux-toolkit/components-svelte/use-run-saga"
  - augmentcode/ag-redux-toolkit:docs/ARCHITECTURE.md
  - augmentcode/ag-redux-toolkit:README.md
triggers:
  - Store class
  - svelte-store import
  - getReadableState
  - useInitStore
  - useRunSaga
  - Svelte readable Store
---
# Store import and lifecycle

Use this skill when a task needs the canonical Svelte-readable Store variant. For shared state policy, reducers, actions, sagas, and package import boundaries, also follow the matching `core/*` skills.

This is Svelte Store family guidance. For the same app/package/code path, do not apply `StreamingStore`, Kefir/observable selector, `getStreamState()`, `ReactStore`, Preact signal selector, React `.useValue(...)`, React component setup, or streaming lifecycle patterns. Separate React or Node/server apps in a mixed repository must route to `../../react/SKILL.md` or `../../streaming/SKILL.md` independently.

## Correct import and class choice

- Use `Store` from `@augmentcode/ag-redux-toolkit/svelte-store`.
- Use `ReactStore` from `@augmentcode/ag-redux-toolkit/react-store` only when direct selector calls should return Preact React signals in a separate React app/code path.
- Use `StreamingStore` from `@augmentcode/ag-redux-toolkit/streaming-store` only when direct selector calls should return Kefir observables in a separate stream/Node path.
- Do not import `Store` from the package root, `src/*`, or selector internals such as `utils/svelte-selectors/*`.

```ts
import { Store } from "@augmentcode/ag-redux-toolkit/svelte-store";

export const store = new Store({ todos: todosReducer });
const dispose = store.init();
```

## Lifecycle rules

- Construct `Store` with app-owned reducers and optional middleware, then call `store.init(initialState?)` before invoking direct selector calls or `store.getReadableState()`.
- `getReadableState()` returns the Store state as a Svelte `Readable` after initialization and throws before `init()` or after `dispose()`.
- If a store context already exists in the Svelte component tree, `init()` skips setup and returns a noop disposer, so nested Store components do not double-initialize.
- `store.dispatch`, `store.state`, `store.runSaga(sagaFn)`, and `store.dispose()` follow the shared Store runtime behavior documented in core Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Svelte component lifecycle helpers

- `useInitStore(store, initialState?)` from `@augmentcode/ag-redux-toolkit/components-svelte/use-init-store` calls `store.init(initialState)` and disposes via `onDestroy`. Call it at component init time, typically in the root layout.
- `useRunSaga(saga)` from `@augmentcode/ag-redux-toolkit/components-svelte/use-run-saga` starts a saga on mount and stops it on destroy. Call it at component init time after the Store is initialized.
- Import these helpers from their leaf subpaths only, not from old `components/*` paths or a `components-svelte` directory barrel.

## Contrast with the other Store variants

- `Store` is the only Store class whose selector direct calls return Svelte readables for `$selector$` template reads.
- `ReactStore` is the Preact React signal class for React UI code.
- `StreamingStore` is the Kefir/observable class for stream/Node paths.
- If a task expects signal reads or Kefir observation, route that separate app/code path to `../../react/SKILL.md` or `../../streaming/SKILL.md` instead of this skill.
- Do not make one app use multiple concrete Store selector/component patterns.

## Verification cues

- Imports use `@augmentcode/ag-redux-toolkit/svelte-store` for `Store` and `@augmentcode/ag-redux-toolkit/components-svelte/*` leaf subpaths for lifecycle helpers.
- Svelte examples initialize the Store before readable selector reads, or tests explicitly assert the pre-init error path.
- The app path does not mix Preact signal or Kefir observable Store setup.

## See also

- `../selectors/SKILL.md` — `store.createSelector` and selector call modes.
- `../selector-lifecycle/SKILL.md` — component-init, handler, and saga call modes.
- `../component-integration/SKILL.md` — root layout wiring and template reactivity.
- `../../core/import-boundaries/SKILL.md` — public package import surface.

