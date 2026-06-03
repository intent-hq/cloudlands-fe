---
name: streaming/store
description: >-
  StreamingStore import, initialization, disposal, and Store-runtime guidance for
  the Kefir/observable Store variant. Use for ag-redux-toolkit/streaming-store,
  getStreamState(), inherited runSaga/dispatch/state behavior, and contrast with
  Svelte-readable Store without teaching readable selector call modes.
type: sub-skill
requires:
  - streaming
  - core/import-boundaries
sources:
  - ag-redux-toolkit/streaming-store
  - ag-redux-toolkit/svelte-store
  - augmentcode/ag-redux-toolkit:docs/ARCHITECTURE.md
  - augmentcode/ag-redux-toolkit:README.md
triggers:
  - StreamingStore
  - streaming-store import
  - getStreamState
  - Kefir Store
  - observable Store
---
# StreamingStore import and lifecycle

Use this skill when a task needs the Kefir/observable Store variant. For shared
state policy, reducers, actions, sagas, and package import boundaries, also follow
the matching `core/*` skills.

This is Streaming Store family guidance. For the same app/package/code path, do
not apply `Store`, Svelte `Readable`, `$selector` template, Svelte
component setup, or Svelte lifecycle patterns. Separate Svelte frontend apps in a
mixed repository must route to `../../svelte/SKILL.md` independently.

## Correct import and class choice

- Use `StreamingStore` from `ag-redux-toolkit/streaming-store`.
- Use `Store` from `ag-redux-toolkit/svelte-store` only when direct
  selector calls should return Svelte readables in a separate Svelte app/code path.
- Do not import `StreamingStore` from `ag-redux-toolkit/svelte-store`, the
  package root, `src/*`, or
  `utils/streaming-selectors/*`.

```ts
import { StreamingStore } from "ag-redux-toolkit/streaming-store";

export const streamStore = new StreamingStore({ todos: todosReducer });
const dispose = streamStore.init();
```

## Lifecycle rules

- Construct `StreamingStore` with app-owned reducers and optional middleware,
  then call `streamStore.init(initialState?)` before invoking streaming selector
  calls or `streamStore.getStreamState()`.
- `getStreamState()` returns a Kefir `Observable` backed by Redux updates after
  initialization and throws before `init()` or after `dispose()`.
- `streamStore.dispatch`, `streamStore.state`, `streamStore.runSaga(sagaFn)`, and
  `streamStore.dispose()` follow the shared Store runtime behavior documented in
  core Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Contrast with Svelte-readable stores

- `Store` is the canonical Svelte-readable class.
- `StreamingStore` is the only Store class whose selector direct calls return
  Kefir observables.
- If a UI task expects `$selector` template reads or Svelte `Readable` values,
  route that separate Svelte app/code path to `../../svelte/SKILL.md` instead of this skill.
- Do not make one app use both `StreamingStore` and `Store` concrete
  selector/component patterns.

## Verification cues

- Imports use `ag-redux-toolkit/streaming-store` for `StreamingStore`.
- Examples and docs do not describe `Store` as a streaming API.
- Streaming selector usage is initialized before observation, or tests explicitly
  assert the pre-init error path.

## See also

- `streaming/selectors/SKILL.md` — Kefir selector return model.
- `streaming/selector-lifecycle/SKILL.md` — safe invocation/teardown timing.
- `core/import-boundaries/SKILL.md` — public package import surface.
