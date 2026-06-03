---
name: streaming/selectors
description: >-
  Author StreamingStore selectors whose direct calls return Kefir Observable
  values. Covers observable selector arguments, Store-bound creation,
  withStore(streamSource), pure .select(state) composition/testing, and saga
  .effect() usage without importing streaming selector internals.
type: sub-skill
requires:
  - streaming
  - core/state-integrity
sources:
  - ag-redux-toolkit/streaming-store
  - package-internal streaming selector implementation
  - augmentcode/ag-redux-toolkit:docs/SELECTORS.md
triggers:
  - streaming selector
  - Kefir selector
  - observable selector
  - selector stream args
  - StoreStreamingSelector
---
# Streaming selectors — Kefir/observable call model

Use this skill when `store.createSelector(...)` belongs to a `StreamingStore` and
direct selector calls should produce Kefir `Observable<R, any>` results.

This Streaming selector model is mutually exclusive with Svelte readable selector
patterns for the same app/package/code path. Do not apply Svelte-readable Store,
`selectFoo()`-as-readable component capture, `$selector` template syntax, or
Svelte lifecycle/setup guidance here.

## Authoring rules

- Create selectors through the configured `StreamingStore` instance.
- Keep this app on the Streaming Store family; use any Svelte Store/readable
  selector guidance only for a separate frontend Svelte app/code path.
- Keep selector callbacks pure and derived-only; reducers must not store selector
  outputs.
- Compose selectors with `.select(state, ...args)` inside another selector.
- Keep generic selector helper modules Store-parameterized: accept a configured
  store and call `store.createSelector(...)` at the integration boundary.
- Do not import from any `ag-redux-toolkit` streaming-selector internal deep path; those are
  implementation internals, not package API.

```ts
import { StreamingStore } from "ag-redux-toolkit/streaming-store";

export const streamStore = new StreamingStore({ todos: todosReducer });
export const selectTodoCount = streamStore.createSelector((state) => {
  return state.todos.collection.ids.length;
});

const todoCount$ = selectTodoCount();
```

## Call forms

| Context | Use | Result |
| --- | --- | --- |
| Streaming consumer | `selectFoo(...argsOrArgStreams)` | Kefir `Observable<R, any>` |
| Alternate stream state | `selectFoo.withStore(source)(...args)` | Kefir `Observable<R, any>` |
| Tests/handlers/composition | `selectFoo.select(state, ...args)` | Plain value `R` |
| Sagas | `yield* selectFoo.effect(...args)` | typed-redux-saga select effect |

Selector arguments may be plain values or Kefir observables. Plain values are
lifted to constant streams before combining with the Store state stream.
Streaming selector outputs are throttled by the owning Store's
`throttledSelectorFrequency` option, defaulting to `64` FPS. The first selector
value remains prompt; subsequent rapid Store updates or observable argument
updates within a throttle interval are omitted/coalesced, and the latest pending
value emits at the scheduled moment.

## Collection reads

Use public collection utilities in selector callbacks when a package-level helper
is needed, and compose through `.select(state)` when another selector owns the
collection read.

```ts
import { getItem } from "ag-redux-toolkit/utils/collections/collection-utils";

export const selectTodo = streamStore.createSelector((state, id: string) => {
  return getItem(state.todos.collection, id);
});
```

## Don't

- Do not teach Svelte readable syntax (`$selector`, `get(selectFoo())`, or
  component-init readable capture) for `StreamingStore` selectors.
- Do not introduce `Store` or Svelte component lifecycle setup into
  the same Streaming app.
- Do not call another selector's direct streaming form inside a selector callback;
  use `.select(state)` to keep composition pure and synchronous.
- Do not use standalone streaming selector utilities as public package imports.

## Verification cues

- Streaming selector examples return/observe Kefir observables only after the
  `StreamingStore` has been initialized.
- Unit tests for pure selector logic use `.select(mockState, ...args)`.
- Static scans show no public imports from `utils/streaming-selectors`.

## See also

- `streaming/store/SKILL.md` — Store class and import choice.
- `streaming/selector-lifecycle/SKILL.md` — invocation and teardown timing.
- `core/state-integrity/SKILL.md` — canonical derived-value ownership.
