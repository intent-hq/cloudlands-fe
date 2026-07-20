# State Management Guide

> **Architecture update — Redux and the saga runtime have been removed.**
> The `redux`, `redux-saga`, and `typed-redux-saga` packages are no longer
> dependencies. The in-use store surface (`svelte-store`, `types`,
> `utils/store/create-action`, `utils/store/create-reducer`,
> `utils/store/boolean-preference`, `utils/collections/collection-utils`)
> lives in a local, redux/saga-free shim at `src/lib/store-shim/`, imported
> directly via `$lib/store-shim/...`; the main/preload bundles rewrite the
> `$lib/...` specifiers to relative paths in `scripts/fix-esm-imports.ts`.
>
> The app is now mock-driven via the `AppClient` (`src/lib/client/`). The saga
> runtime no longer exists: `startAllAppSagas`, `startAllMainSagas`, and
> `store.runSaga(sagaFn)` no longer start anything (the Store's `runSaga` is a
> no-op), and `selector.effect(...)` throws. Use `selector.select(state, ...args)`
> for one-shot reads and the configured Store's `dispatch` for writes. References
> below to saga registries, `store.runSaga`, and the real npm package describe the
> historical architecture and are retained only for context.

This is the project entrypoint for state-management orientation. The store API
surface is the local shim at `src/lib/store-shim/`; app-specific companion
notes live under `src/store/renderer/docs/`.

If this doc conflicts with the shim implementation, follow the shim and report
the drift.

## Repository orientation

Renderer shared/domain state lives under `src/store/renderer/` and uses the
configured `Store` from `$lib/store-shim/svelte-store`. Svelte store modules
(`*.store.svelte.ts`) are deprecated migration targets; do not create new ones or
expand existing ones.

Electron main-process shared/domain state lives under `src/store/main/` and
previously used a configured `StreamingStore` (since removed). The remaining
modules there are neutralized no-op shims kept for type compatibility; do not
add new main-process store state.

The current app-specific map is:

- `src/store/renderer/store.ts` — configured app `Store`, app state type inference,
  and app reducer registration.
- `src/store/renderer/sagas.ts` — positional `sagas` array plus
  `startAllAppSagas(store)`, which starts each saga with `store.runSaga(sagaFn)`.
- `src/routes/+layout.svelte` — root Store initialization and explicit app saga
  startup via `startAllAppSagas(appStore)`.
- `src/store/renderer/slices/**` — app-owned slice state, actions, selectors, and
  sagas.
- `src/store/renderer/utils/` — app-local helpers that are not package-owned exports,
  such as workspace scoping, IPC channels, and safe localStorage saga helpers.
- `src/store/main/slices/**` — historical main-process slice state, actions, and
  selectors (the main-process store itself has been removed).
- `src/store/main/redux-store-bridge.ts` — neutralized no-op bridge retained so
  main-process services continue to type-check.

## Local rules worth remembering

- Redux owns shared, persisted, async-driven, or cross-feature state.
- Component-local state is for ephemeral view details only, such as hover,
  focus, transient open/closed state, or one component's draft field.
- Components create selector readables during component initialization, render
  `$selector$` values, and dispatch through the configured app Store.
- Event handlers and non-component services use one-shot reads from the
  configured Store, e.g. `selectThing.select(store.state, id)`, then dispatch
  explicit actions with `store.dispatch(action)`.
- Main-process services use the configured main `StreamingStore` bridge for
  dispatch/state access after `initMainStore()`; renderer code must not import
  `src/store/main/**`, and main-process code must not import renderer Store setup.
- Main-process selector direct calls return Kefir/observable streams. Tests,
  services, and selector composition should use `.select(state, ...args)` for
  synchronous reads; sagas should use `.effect(...args)`.
- Side effects that matter beyond one component belong in sagas. Component
  `$effect` should stay limited to DOM-local concerns.
- App-local safe localStorage helpers remain in `src/store/renderer/utils/` because
  the package skills describe them as app-owned examples rather than public
  package exports.

## Companion docs

Use [`src/store/renderer/docs/readme.md`](../src/store/renderer/docs/readme.md) as the
index for retained app-specific Redux notes. Those docs are concise companions;
use the skills above for current API and architecture rules.
