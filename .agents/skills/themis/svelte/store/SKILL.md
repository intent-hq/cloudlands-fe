---
name: svelte/store
description: >-
  Store import, initialization, disposal, and Store-runtime guidance for the
  canonical Svelte-readable Store variant. Use for @augmentcode/themis/svelte-store,
  useInitStore/useRunSaga lifecycle helpers, inherited
  runSaga/dispatch/state behavior for Svelte-readable Store consumers.
type: sub-skill
requires:
  - svelte
  - core/import-boundaries
sources:
  - "@augmentcode/themis/svelte-store"
  - "@augmentcode/themis/components-svelte/use-init-store"
  - "@augmentcode/themis/components-svelte/use-run-saga"
  - "@augmentcode/themis/docs/ARCHITECTURE.md"
  - "@augmentcode/themis/README.md"
triggers:
  - Store class
  - svelte-store import
  - Store state lifecycle
  - useInitStore
  - useRunSaga
  - Svelte readable Store
---
# Store import and lifecycle

Use this skill when a task needs the canonical Svelte-readable Store variant. For shared state policy, reducers, actions, sagas, and package import boundaries, also follow the matching `core/*` skills.

This is Svelte Store family guidance for Svelte component and application code.

## Correct import and class choice

- Use `Store` from `@augmentcode/themis/svelte-store`.
- Do not import `Store` from the package root, `src/*`, or selector internals such as `utils/svelte-selectors/*`.

```ts
import { Store } from "@augmentcode/themis/svelte-store";

export const store = new Store({ todos: todosReducer });
const dispose = store.init();
```

## Lifecycle rules

- Construct `Store` with app-owned reducers and optional middleware, then call `store.init(initialState?)` before invoking direct selector calls.
- Direct selector calls return Svelte `Readable` outputs backed by the Store-owned state stream after initialization and throw before `init()` or after `dispose()`.
- If a store context already exists in the Svelte component tree, `init()` skips setup and returns a noop disposer, so nested Store components do not double-initialize.
- `store.dispatch`, `store.state`, `store.runSaga(sagaFn)`, and `store.dispose()` follow the shared Store runtime behavior documented in core Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Svelte component lifecycle helpers

- `useInitStore(store, initialState?)` from `@augmentcode/themis/components-svelte/use-init-store` calls `store.init(initialState)` and disposes via `onDestroy`. Call it at component init time, typically in the root layout.
- `useRunSaga(saga)` from `@augmentcode/themis/components-svelte/use-run-saga` starts a saga on mount and stops it on destroy. Call it at component init time after the Store is initialized.
- Import these helpers from their leaf subpaths only, not from old `components/*` paths or a `components-svelte` directory barrel.

## Svelte Store guarantees

- `Store` is the only Store class whose selector direct calls return Svelte readables for `$selector$` template reads.
- Keep selector direct calls, component initialization, and readable template
  bindings within the Svelte Store lifecycle described above.

## Verification cues

- Imports use `@augmentcode/themis/svelte-store` for `Store` and `@augmentcode/themis/components-svelte/*` leaf subpaths for lifecycle helpers.
- Svelte examples initialize the Store before readable selector reads, or tests explicitly assert the pre-init error path.
- The app path initializes the Store before direct readable selector calls.

## See also

- `../selectors/SKILL.md` — `store.createSelector` and selector call modes.
- `../selector-lifecycle/SKILL.md` — component-init, handler, and saga call modes.
- `../component-integration/SKILL.md` — root layout wiring and template reactivity.
- `../../core/import-boundaries/SKILL.md` — public package import surface.
