# Redux Store Resource Index

Read this first, then open the smallest relevant resource(s):

- `core-policy.md` — custom Redux policy, import boundaries, Redux vs component state, serialization, deep links.
- `custom-api.md` — `createAction`, `createAsyncAction`, `createReducer`, type modules, selector API examples.
- `selectors.md` — selector lifecycle rules, `.select()`, `.effect()`, and handler/callback pitfalls.
- `sagas.md` — typed-redux-saga, selector reads in saga context, selector channels, IPC/window channels, `waitFor`, batching.
- `collections.md` — `Collection<T,K>` normalized data and collection utilities.
- `component-integration.md` — Svelte component usage with selectors and dispatch.
- `file-structure-registration.md` — slice layout, reducer/saga registration, workspace-scoped helpers, boolean preferences.
- `migration.md` — deprecated `*.store.svelte.ts` migration policy.
- `testing.md` — reducer tests, saga tests, `typed-redux-saga` mock requirements.
- `persistence.md` — localStorage init/persistence saga patterns.

Always read `core-policy.md` for structural work. For selector, saga, component, migration, persistence, or testing tasks, read that topic file before editing.
