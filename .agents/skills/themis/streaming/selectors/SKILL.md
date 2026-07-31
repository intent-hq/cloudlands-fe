---
name: streaming/selectors
description: >-
  Author StreamingStore selectors whose direct calls return Kefir Observable
  values. Covers observable selector arguments, Store-bound creation,
  withStore(streamStore), pure .select(state) composition/testing, and saga
  .effect() usage without importing streaming selector internals.
type: sub-skill
requires:
  - streaming
  - core/state-integrity
sources:
  - "@augmentcode/themis/streaming-store"
  - package-internal streaming selector implementation
  - augmentcode/themis:docs/SELECTORS.md
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

This Streaming selector model is mutually exclusive with Svelte readable and
React signal selector patterns for the same app/package/code path. Do not apply
Svelte-readable Store, `selectFoo()`-as-readable component capture, `$selector`
template syntax, `ReactStore`, `.useValue(...args)`, or Svelte/React lifecycle/setup guidance here.

## Authoring rules

- Create selectors through the configured `StreamingStore` instance.
- Keep this app on the Streaming Store family; use Svelte Store/readable or
  ReactStore/signal selector guidance only for separate frontend app/code paths.
- Keep selector callbacks pure and derived-only; reducers must not store selector
  outputs.
- Compose selectors with `.select(state, ...args)` inside another selector.
- Keep generic selector helper modules Store-parameterized: accept a configured
  store and call `store.createSelector(...)` at the integration boundary.
- Trust Store-owned selector-result and observable-output caching; do not add extra memoize/cache/debounce/throttle wrappers solely for performance.
- Prefer primitive scalar selector arguments over freshly constructed object,
  array, or function arguments; object/function args are valid only when their
  identity is stable and intentional.
- Do not import from any `themis` streaming-selector internal deep path; those are
  implementation internals, not package API.

```ts
import { StreamingStore } from "@augmentcode/themis/streaming-store";

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
| Explicit StreamingStore binding | `selectFoo.withStore(streamStore)(...args)` | Kefir `Observable<R, any>` |
| Tests/handlers/composition | `selectFoo.select(state, ...args)` | Plain value `R` |
| Sagas | `yield* selectFoo.effect(...args)` | typed-redux-saga select effect |

Selector arguments may be plain values or Kefir observables. Plain values are
lifted to constant streams before combining with the Store state stream.
Streaming selector outputs are throttled by the owning Store's
`throttledSelectorFrequency` option, defaulting to `64` FPS. The first selector
value remains prompt; subsequent rapid Store updates or observable argument
updates within a throttle interval are omitted/coalesced, and the latest pending
value emits at the scheduled moment. Selector trace output is disabled by
default; pass `{ traceSelectors: true }` in the final Store options object only
for temporary diagnostics.

Selector-channel helpers that consume `.select`/`.effect`-compatible selectors
run in sagas and support `StreamingStore` selectors through the same shared
selector read shape used by Svelte `Store` and `ReactStore` selectors. Pass
plain stable selector arguments as the helper args tuple; selector-channel
effects read Redux state from saga context and do not subscribe to direct Kefir
`Observable`, Svelte readable, or React signal selector outputs.

## Selector caching

- Store-created selectors have internal selector-result caching/memoization.
- Direct Kefir `Observable` outputs are cached per StreamingStore instance + selector + arguments; repeated `selectFoo(args)` calls for the same store reuse the same Kefir Observable.
- Do not wrap selector callbacks or selector calls in extra `memoize`, `cache`, manual cache maps, debounce, or throttle layers solely for performance.
- Prefer the same Store-bound selector + same arguments over props drilling/manual stream passing when the receiving consumer can reasonably call the selector in valid streaming setup; otherwise use `.select`, `.effect`, or `.withStore` as the context requires.

## Stable selector arguments

- Prefer primitive scalar selector arguments: ids, booleans, enum strings,
  numbers, `null`, or `undefined`.
- Do not pass freshly constructed object, array, or function arguments to direct
  `selectFoo(...)`, `.select(state, ...)`, `.effect(...)`, `.withStore(store)(...)`,
  selector-channel args tuples, or `waitFor` args tuples.
- Object/function args are valid only when the identity is stable and intentional,
  such as a module constant, memoized config, existing source object, or Kefir
  observable. Observable arguments are valid direct-call inputs when the stream is
  owned elsewhere; do not recreate a stream solely for a selector call.
- Prefer selector definitions like `(state, id, status)` over `(state, { id,
  status })`; destructure an object arg only when callers pass a documented stable
  reference.

## Collection reads

Use public collection utilities in selector callbacks when a package-level helper
is needed, and compose through `.select(state)` when another selector owns the
collection read.

```ts
import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";

export const selectTodo = streamStore.createSelector((state, id: string) => {
  return getItem(state.todos.collection, id);
});
```

## Don't

- Do not teach Svelte readable syntax (`$selector`, `get(selectFoo())`, or
  component-init readable capture) or React `.useValue(...args)` component reads for
  `StreamingStore` selectors.
- Do not introduce `Store`, `ReactStore`, Svelte component lifecycle setup, or
  React component signal setup into the same Streaming app.
- Do not call another selector's direct streaming form inside a selector callback;
  use `.select(state)` to keep composition pure and synchronous.
- Do not props-drill derived values solely to avoid selector calls when the consumer can call the same Store-bound selector with the same args in a valid streaming context.
- Do not add manual memoization/cache/debounce/throttle wrappers inside selector callbacks or around observable selector calls just to improve selector performance.
- Do not use standalone streaming selector utilities as public package imports.
- Do not construct `{ ... }`, `[ ... ]`, `() => ...`, or new argument streams inline
  just to call a selector; pass scalar args or stable intentional references.

## Verification cues

- Streaming selector examples return/observe Kefir observables only after the
  `StreamingStore` has been initialized.
- Unit tests for pure selector logic use `.select(mockState, ...args)`.
- Static scans show no public imports from `utils/streaming-selectors`.

## See also

- `streaming/store/SKILL.md` — Store class and import choice.
- `streaming/selector-lifecycle/SKILL.md` — invocation and teardown timing.
- `core/state-integrity/SKILL.md` — canonical derived-value ownership.
