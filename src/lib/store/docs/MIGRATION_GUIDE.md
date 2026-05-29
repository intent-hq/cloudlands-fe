# Svelte Store → Redux Slice Migration Guide

This project guide is a concise companion to the migration skills. The active migration playbook lives in:

- `.agents/skills/migrate-to-svelte-redux-toolkit/SKILL.md`
- `.agents/skills/migrate-to-svelte-redux-toolkit/**`
- `.agents/skills/svelte-redux-toolkit/**`

Use those skills for the step-by-step mapping. This file records the Intent-app migration checkpoints and repository paths.

## Migration policy

- Shared, persisted, IPC-driven, server-driven, or async state belongs in Redux slices and sagas.
- Component-local ephemeral UI state can stay local.
- Svelte store files named `*.store.svelte.ts` are migration targets; do not create new ones.
- The old store file is deleted after migration. Do not leave pass-through wrappers unless a coordinator explicitly approves a temporary compatibility shim with a removal condition.

## Current app architecture targets

- Reducers are registered in `src/lib/store/reducer.ts`.
- App sagas are collected in the positional `sagas` array in `src/lib/store/sagas.ts`.
- Root startup initializes the Store, then calls `startAllAppSagas(store)`, which starts each app saga with `store.runSaga(sagaFn)` and returns cancel functions for teardown.
- Selectors are created with the configured Store via `store.createSelector(...)`.
- Components capture selector readables during initialization and use configured Store reads/dispatches in handlers.
- Saga side effects use typed redux-saga effects, named selectors via `.effect(...)`, channel helpers from `src/lib/store/utils/ipc-channel.ts`, and app-local safe storage helpers from `src/lib/store/utils/safe-local-storage-saga.ts`.

## Per-store checklist

1. Inventory `$state`, `$derived`, getters, methods, subscriptions, `$effect` blocks, storage, IPC, timers, and fetches.
2. Define serializable slice state and initial state.
3. Move pure state changes into actions and reducer handlers.
4. Move derived values into Store-bound selectors.
5. Move side effects into sagas; use app-local safe storage helpers for persisted values.
6. Register the reducer only if the slice owns meaningful state.
7. Add app saga functions to the ordered `sagas` array in `src/lib/store/sagas.ts`; root startup runs them through `startAllAppSagas(store)` after Store initialization.
8. Update components to read with selector readables at initialization and dispatch through the configured Store in handlers.
9. Delete the old store file and remove all imports of the old path.
10. Run targeted tests plus grep evidence proving no legacy store references remain.

## Example verification searches

```bash
grep -RIn "example-store.store.svelte" src/
grep -RIn "from .*stores/example-store" src/
grep -RIn "exampleStore" src/ --include="*.ts" --include="*.svelte"
```

All migration-specific searches should return no active references unless the task note explicitly records an approved temporary compatibility shim.

## See also

- [Reducers Guide](./REDUCERS_GUIDE.md)
- [Selectors Guide](./SELECTORS_GUIDE.md)
- [waitFor Saga Utility Guide](./WAITFOR_SAGA_GUIDE.md)
- `src/lib/store/AGENTS.md`
