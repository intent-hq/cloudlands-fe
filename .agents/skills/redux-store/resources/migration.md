# Svelte Store Migration

## 13. Svelte Store Migration Policy

**Rule:** When encountering `.store.svelte.ts`, NEVER expand it. Migrate to Redux:

| Svelte Store       | Redux Equivalent             |
| ------------------ | ---------------------------- |
| $state fields      | Slice initial state          |
| $derived / getters | createSelector               |
| Methods (pure)     | createAction + createReducer |
| Side effects       | Sagas (typed-redux-saga)     |

After migration: **DELETE the old store file** and ensure **zero references** remain.

See [Migration Guide](src/lib/store/docs/MIGRATION_GUIDE.md) for the full checklist.
