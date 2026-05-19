---
name: redux-store
description: >-
  DEPRECATED legacy Redux/store guidance. Historical reference only; for new
  Redux/Svelte state work use the svelte-redux-toolkit skill set instead.
---

# Redux Store Skill (Deprecated)

> **Deprecated:** This legacy skill is retained for historical reference only.
> Future agents should use the `svelte-redux-toolkit` skill set for new
> Redux/Svelte state work, including slices, selectors, sagas, component wiring,
> migration touchpoints, tests, and selector/getDispatch guidance.

Legacy guidance remains below. If you are consulting it for context, first read
`resources/index.md`, then prefer the current `svelte-redux-toolkit` skills for
implementation decisions.

Critical rules:
- Custom Redux only; never use RTK (`createSlice`, `configureStore`, `createAsyncThunk`).
- Shared/domain state lives in Redux. Never create or expand `*.store.svelte.ts`; migrate them.
- Components render only. Call `getDispatch()` and `selectFoo()` only at init; in handlers use `selectFoo.select(getReduxStore().getState())`.
- Side effects go in typed-redux-saga (`yield*`), not components/reducers.
- State must be serializable; object arrays use `Collection<T,K>`.
- Types in `*-types.ts`; actions/reducer in `*-slice.ts`; selectors in `*-selectors.ts`; sagas in `sagas/`.
- Component imports: no sagas, reducer internals, dispatching ops, or collection utils
