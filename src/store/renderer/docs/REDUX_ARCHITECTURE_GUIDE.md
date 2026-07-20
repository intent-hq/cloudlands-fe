# Redux Architecture Guide

> Concise app-specific companion. This file is **not** the source of truth for
> store APIs or implementation rules.

## Source of Truth

The store API surface is the local redux/saga-free shim at
`src/lib/store-shim/`, imported via `$lib/store-shim/...`. When this guide and
the shim disagree, follow the shim and report the drift.

The shorter topic docs in this directory are secondary companions. Prefer the
shim source for current mechanics, import paths, and verification expectations.

## Current App Wiring

The renderer app uses one configured `Store` instance from
`$lib/store-shim/svelte-store`.
These files are the repository-specific map for how that instance is assembled:

| File | Role |
| --- | --- |
| `src/store/renderer/configured-store.ts` | Creates the configured Store from app reducers and middleware. |
| `src/store/renderer/reducer.ts` | Registers app-owned reducer domains. Package-owned internals are managed by the package. |
| `src/store/renderer/sagas.ts` | Defines the function-only ordered app saga array and the `startAllAppSagas(store)` startup helper. |
| `src/store/renderer/store.ts` | Re-exports the configured Store, inferred state types, debug helpers, and a temporary bridge for remaining compatibility surfaces. |
| `src/routes/+layout.svelte` | Initializes the configured Store, calls `startAllAppSagas(appStore)`, and disposes saga cancels plus the Store context during root teardown. |

Keep this shape aligned with the skills:

- App reducers are passed to the `Store` constructor.
- App sagas are functions listed in startup order in `src/store/renderer/sagas.ts`.
- After Store init/root setup, the root layout calls `startAllAppSagas(store)`,
  which starts each listed saga with `store.runSaga(sagaFn)` and returns cancel
  functions for teardown.
- `store.init()` does not auto-start app sagas.
- State types should be inferred from the configured Store instance.
- Package-owned internal reducers and saga-manager behavior are not app APIs.

## Store-First Usage Rules

Use the configured Store and shim-owned primitives instead of local wrappers:

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
import { store as appStore } from "$store/renderer/store";
import { selectActiveWorkspaceId } from "$store/renderer/slices/workspace/workspace-selectors";
import { openPalette } from "$store/renderer/slices/palette/palette-slice";

const activeWorkspaceId = selectActiveWorkspaceId.select(appStore.state);
if (activeWorkspaceId) {
  appStore.dispatch(openPalette());
}
```

For full action, reducer, selector, saga, collection, channel, and testing
examples, read the shim source rather than expanding this guide.

## Adding or Changing Redux Domains

Before changing Redux code, use the app map above to find the repository owner
files.

1. Confirm whether the state is shared/domain state. If yes, Redux owns it; if it
   is purely component-local UI state, keep it local.
2. Search for existing action, selector, reducer, and saga owners before adding a
   new one.
3. Put slice state/actions/reducer in `src/store/renderer/slices/<domain>/` and keep
   slice types in dedicated `*-types.ts` modules when needed.
4. Register new app reducers in `src/store/renderer/reducer.ts`.
5. Add new app saga functions to the ordered array in `src/store/renderer/sagas.ts`;
   `startAllAppSagas(store)` includes that array in root startup after Store init.
6. Add or update colocated tests for changed reducers, selectors, or sagas.
7. Run the checks required by the applicable skills and report exact results.

## Repository-Specific Notes

- `src/store/renderer/AGENTS.md` adds local import-boundary, state-shape, selector
  lifecycle, side-effect, and testing rules for files under `src/store/renderer/`.
- `src/store/renderer/types.ts` still contains compatibility types used by the current
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
