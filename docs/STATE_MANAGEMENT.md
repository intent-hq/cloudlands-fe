# State Management Guide

This is the project entrypoint for state-management orientation. Active Redux
architecture rules live in the agent skills, not in this companion doc:

- [`svelte-redux-toolkit`](../.agents/skills/svelte-redux-toolkit/SKILL.md) — root routing index and always-on Redux policy.
- [`core-policy`](../.agents/skills/svelte-redux-toolkit/core-policy/SKILL.md) — shared-state ownership, serializability, canonical state, Svelte-store deprecation, and utility reuse rules.
- [`import-boundaries`](../.agents/skills/svelte-redux-toolkit/import-boundaries/SKILL.md) — component/service/saga import boundaries and current public package subpaths.
- [`component-integration`](../.agents/skills/svelte-redux-toolkit/component-integration/SKILL.md) — configured `Store` setup, Store-first dispatch/state reads, selector call modes, and `store.runSaga(name)` startup.
- [`migrate-to-svelte-redux-toolkit`](../.agents/skills/migrate-to-svelte-redux-toolkit/SKILL.md) — migration playbook for remaining Svelte stores.

If this doc conflicts with the skills, follow the skills and report the drift.

## Repository orientation

Shared/domain state for the renderer lives under `src/lib/store/` and should use
the configured `svelte-redux-toolkit` `Store` instance. Svelte store modules
(`*.store.svelte.ts`) are deprecated migration targets; do not create new ones or
expand existing ones.

The current app-specific map is:

- `src/lib/store/store.ts` — configured app `Store`, app state type inference,
  and app reducer registration.
- `src/lib/store/saga-registration.ts` — app saga registration via
  `store.registerSagas(...)` before initialization.
- `src/routes/+layout.svelte` — root Store initialization and explicit app saga
  startup with `store.runSaga(name)`.
- `src/lib/store/slices/**` — app-owned slice state, actions, selectors, and
  sagas.
- `src/lib/store/utils/` — app-local helpers that are not package-owned exports,
  such as workspace scoping, IPC channels, and safe localStorage saga helpers.

## Local rules worth remembering

- Redux owns shared, persisted, async-driven, or cross-feature state.
- Component-local state is for ephemeral view details only, such as hover,
  focus, transient open/closed state, or one component's draft field.
- Components create selector readables during component initialization, render
  `$selector$` values, and dispatch through the configured app Store.
- Event handlers and non-component services use one-shot reads from the
  configured Store, e.g. `selectThing.select(store.state, id)`, then dispatch
  explicit actions with `store.dispatch(action)`.
- Side effects that matter beyond one component belong in sagas. Component
  `$effect` should stay limited to DOM-local concerns.
- App-local safe localStorage helpers remain in `src/lib/store/utils/` because
  the package skills describe them as app-owned examples rather than public
  package exports.

## Companion docs

Use [`src/lib/store/docs/readme.md`](../src/lib/store/docs/readme.md) as the
index for retained app-specific Redux notes. Those docs are concise companions;
use the skills above for current API and architecture rules.
