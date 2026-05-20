# Redux Architecture Guide

> Concise app-specific companion to the Redux skills. This file is **not** the
> source of truth for Redux APIs or implementation rules.

## Source of Truth

Active Redux architecture rules live in the agent skills. When this guide and a
skill disagree, follow the skill and report the drift.

| Need | Primary source |
| --- | --- |
| Routing and always-on Redux policy | `.agents/skills/svelte-redux-toolkit/SKILL.md` |
| Action creators and async actions | `.agents/skills/svelte-redux-toolkit/actions/SKILL.md` |
| Reducer purity and state shape | `.agents/skills/svelte-redux-toolkit/reducers/SKILL.md` |
| Store-bound selectors and call modes | `.agents/skills/svelte-redux-toolkit/selectors/SKILL.md` |
| Component setup, dispatch, and lifecycle | `.agents/skills/svelte-redux-toolkit/component-integration/SKILL.md` |
| Saga registration, startup, and side effects | `.agents/skills/svelte-redux-toolkit/sagas/SKILL.md` |
| Package-owned saga crash/restart behavior | `.agents/skills/svelte-redux-toolkit/saga-manager/SKILL.md` |
| Store migration planning | `.agents/skills/migrate-to-svelte-redux-toolkit/SKILL.md` |

The shorter topic docs in this directory are secondary companions. Prefer the
skills above for current mechanics, import paths, and verification expectations.

## Current App Wiring

The renderer app uses one configured `svelte-redux-toolkit` `Store` instance.
These files are the repository-specific map for how that instance is assembled:

| File | Role |
| --- | --- |
| `src/lib/store/configured-store.ts` | Creates the configured Store from app reducers and middleware. |
| `src/lib/store/reducer.ts` | Registers app-owned reducer domains. Package-owned internals are managed by the package. |
| `src/lib/store/sagas.ts` | Collects app-owned saga entries and exports the registered saga names. |
| `src/lib/store/saga-registration.ts` | Calls `appStore.registerSagas(sagas)`, exposes the registered Store, and starts app sagas by name. |
| `src/lib/store/store.ts` | Re-exports the configured Store, inferred state types, debug helpers, and a temporary bridge for remaining compatibility surfaces. |
| `src/routes/+layout.svelte` | Initializes the registered Store, starts all app sagas, and disposes both during root teardown. |

Keep this shape aligned with the skills:

- App reducers are passed to the `Store` constructor.
- App sagas are registered with `store.registerSagas(...)` before Store init.
- App sagas are started explicitly with `store.runSaga(name)`; `store.init()` does
  not auto-start app sagas.
- State types should be inferred from the configured Store instance.
- Package-owned internal reducers and saga-manager behavior are not app APIs.

## Store-First Usage Rules

Use the configured Store and skill-owned primitives instead of local wrappers:

- Create app selectors with `store.createSelector(...)` from the configured Store.
- In Svelte component initialization, call selector readables at top level.
- In handlers, callbacks, tests, and other one-time reads, use
  `selector.select(appStore.state, ...args)`.
- Dispatch with `appStore.dispatch(actionCreator(...))` rather than helper hooks or
  pass-through dispatch wrappers.
- Keep reducers pure and serializable; put persistence, IPC, timers, retries, and
  other side effects in sagas.
- Treat package internals, including internal reducer domains and the saga manager,
  as implementation details unless a public package export says otherwise.

Small app-shape example:

```ts
import { store as appStore } from "$lib/store/store";
import { selectActiveWorkspaceId } from "$lib/store/slices/workspace/workspace-selectors";
import { openPalette } from "$lib/store/slices/palette/palette-slice";

const activeWorkspaceId = selectActiveWorkspaceId.select(appStore.state);
if (activeWorkspaceId) {
  appStore.dispatch(openPalette());
}
```

For full action, reducer, selector, saga, collection, channel, and testing
examples, use the skills listed above rather than expanding this guide.

## Adding or Changing Redux Domains

Before changing Redux code, start from the skill routing workflow and then use
the app map above to find the repository owner files.

1. Confirm whether the state is shared/domain state. If yes, Redux owns it; if it
   is purely component-local UI state, keep it local.
2. Search for existing action, selector, reducer, and saga owners before adding a
   new one.
3. Put slice state/actions/reducer in `src/lib/store/slices/<domain>/` and keep
   slice types in dedicated `*-types.ts` modules when needed.
4. Register new app reducers in `src/lib/store/reducer.ts`.
5. Register new app sagas in `src/lib/store/sagas.ts`; `saga-registration.ts`
   handles Store registration/startup for the app registry.
6. Add or update colocated tests for changed reducers, selectors, or sagas.
7. Run the checks required by the applicable skills and report exact results.

## Repository-Specific Notes

- `src/lib/store/AGENTS.md` adds local import-boundary, state-shape, selector
  lifecycle, side-effect, and testing rules for files under `src/lib/store/`.
- `src/lib/store/types.ts` still contains compatibility types used by the current
  migration state; do not treat those as the preferred API for new work when the
  skills provide Store-first guidance.
- Some bridge/debug code remains to support existing app surfaces during the
  migration. Do not expand those compatibility layers without a dedicated task.
- Topic docs may preserve app-specific examples, but long API tutorials belong in
  the skills/package docs named by the skills.

## Verification Pointers

For doc-only changes to this guide, run whitespace checks and targeted searches
from the task note. For code changes, follow the applicable skill verification
plan and prefer the smallest relevant tests before broader type or architecture
checks.
