# State Management Guide

This is the project entrypoint for state-management orientation. Active Redux
architecture rules live in the agent skills, not in this companion doc:

- [`ag-redux-toolkit`](../.agents/skills/ag-redux-toolkit/SKILL.md) — root routing index and always-on Redux policy.
- [`core-policy`](../.agents/skills/ag-redux-toolkit/core/core-policy/SKILL.md) — shared-state ownership, serializability, canonical state, Svelte-store deprecation, and utility reuse rules.
- [`import-boundaries`](../.agents/skills/ag-redux-toolkit/core/import-boundaries/SKILL.md) — component/service/saga import boundaries and current public package subpaths.
- [`component-integration`](../.agents/skills/ag-redux-toolkit/svelte/component-integration/SKILL.md) — configured `Store` setup, Store-first dispatch/state reads, selector call modes, and `store.runSaga(sagaFn)` startup.
- [`streaming/store`](../.agents/skills/ag-redux-toolkit/streaming/store/SKILL.md) — main-process `StreamingStore` import, initialization, and lifecycle guidance.
- [`streaming/selectors`](../.agents/skills/ag-redux-toolkit/streaming/selectors/SKILL.md) — main-process selector guidance for configured `store.createSelector(...)` selectors.
- [`svelte/migration`](../.agents/skills/ag-redux-toolkit/svelte/migration/SKILL.md) — migration playbook for remaining Svelte stores.

If this doc conflicts with the skills, follow the skills and report the drift.

## Repository orientation

Renderer shared/domain state lives under `src/store/renderer/` and uses the
configured `Store` from `ag-redux-toolkit/svelte-store`. Svelte store modules
(`*.store.svelte.ts`) are deprecated migration targets; do not create new ones or
expand existing ones.

Electron main-process shared/domain state lives under `src/store/main/` and uses
the configured `StreamingStore` from `ag-redux-toolkit/streaming-store`. Main
selectors should be created directly from that configured store with
`store.createSelector(...)`; do not add an app-local cached selector wrapper or
import streaming selector internals directly.

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
- `src/store/main/configured-store.ts` — configured main-process `StreamingStore`,
  reducer registration, and main middleware wiring.
- `src/store/main/sagas.ts` — main-process saga registry plus
  `startAllMainSagas(store)`, which starts each saga with `store.runSaga(sagaFn)`.
- `src/store/main/slices/**` — main-process slice state, actions, selectors, and
  sagas. Selector modules import `src/store/main/configured-store.ts` and call
  `store.createSelector(...)` directly.
- `src/store/main/redux-store-bridge.ts` — main-process-only bridge for services
  that need the initialized configured `StreamingStore`.

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
