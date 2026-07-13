---
name: streaming/store
description: >-
  StreamingStore import, initialization, disposal, and Store-runtime guidance for
  the Kefir/observable Store variant. Use for @augmentcode/ag-redux-toolkit/streaming-store,
  getStreamState(), inherited runSaga/dispatch/state behavior, and contrast with
  Svelte-readable Store without teaching readable selector call modes.
type: sub-skill
requires:
  - streaming
  - core/import-boundaries
sources:
  - "@augmentcode/ag-redux-toolkit/streaming-store"
  - "@augmentcode/ag-redux-toolkit/svelte-store"
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

Use this skill when a task needs the Kefir/observable Store variant. For sharedstate policy, reducers, actions, sagas, and package import boundaries, also followthe matching `core/*` skills.

This is Streaming Store family guidance. For the same app/package/code path, donot apply `Store`, Svelte `Readable`, `$selector` template, `ReactStore`, React`.useValue(...)`, Svelte component setup, React component setup, or Svelte/Reactlifecycle patterns. Separate Svelte or React frontend apps in a mixed repositorymust route to `../../svelte/SKILL.md` or `../../react/SKILL.md` independently.

## Correct import and class choice

- Use `StreamingStore` from `@augmentcode/ag-redux-toolkit/streaming-store`.
- Use `ReactStore` from `@augmentcode/ag-redux-toolkit/react-store` only when direct selectorcalls should return Preact React signals in a separate React app/code path.
- Use `Store` from `@augmentcode/ag-redux-toolkit/svelte-store` only when directselector calls should return Svelte readables in a separate Svelte app/code path.
- Do not import `StreamingStore` from `@augmentcode/ag-redux-toolkit/svelte-store`, thepackage root, `src/*`, or`utils/streaming-selectors/*`.

```ts
import { StreamingStore } from "@augmentcode/ag-redux-toolkit/streaming-store";

export const streamStore = new StreamingStore({ todos: todosReducer });
const dispose = streamStore.init();
```

## Lifecycle rules

- Construct `StreamingStore` with app-owned reducers and optional middleware,then call `streamStore.init(initialState?)` before invoking streaming selectorcalls or `streamStore.getStreamState()`.
- `getStreamState()` returns a Kefir `Observable` backed by Redux updates afterinitialization and throws before `init()` or after `dispose()`.
- `streamStore.dispatch`, `streamStore.state`, `streamStore.runSaga(sagaFn)`, and`streamStore.dispose()` follow the shared Store runtime behavior documented incore Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Contrast with Svelte-readable stores

- `Store` is the canonical Svelte-readable class.
- `ReactStore` is the Preact React signal class for React UI code.
- `StreamingStore` is the only Store class whose selector direct calls returnKefir observables.
- If a UI task expects `$selector` template reads or Svelte `Readable` values,route that separate Svelte app/code path to `../../svelte/SKILL.md` instead of this skill.
- Do not make one app use multiple concrete Store selector/component patterns.

## Verification cues

- Imports use `@augmentcode/ag-redux-toolkit/streaming-store` for `StreamingStore`.
- Examples and docs do not describe `Store` as a streaming API.
- Streaming selector usage is initialized before observation, or tests explicitlyassert the pre-init error path.

## See also

- `streaming/selectors/SKILL.md` — Kefir selector return model.
- `streaming/selector-lifecycle/SKILL.md` — safe invocation/teardown timing.
- `core/import-boundaries/SKILL.md` — public package import surface.