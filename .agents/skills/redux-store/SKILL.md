---
name: redux-store
description: >-
  Use for Redux/state work: slices, reducers, selectors, sagas, collections,
  IPC/listeners, component integration, shared state, store migration,
  persistence, tests, selector/getDispatch bugs.
---

# Redux Store Skill

Use for app state tasks. Before coding, read `resources/index.md`.

Critical rules:
- Custom Redux only; never use RTK (`createSlice`, `configureStore`, `createAsyncThunk`).
- Shared/domain state lives in Redux. Never create or expand `*.store.svelte.ts`; migrate them.
- Components render only. Call `getDispatch()` and `selectFoo()` only at init; in handlers use `selectFoo.select(getReduxStore().getState())`.
- Side effects go in typed-redux-saga (`yield*`), not components/reducers.
- State must be serializable; object arrays use `Collection<T,K>`.
- Types in `*-types.ts`; actions/reducer in `*-slice.ts`; selectors in `*-selectors.ts`; sagas in `sagas/`.
- Component imports: no sagas, reducer internals, dispatching ops, or collection utils
