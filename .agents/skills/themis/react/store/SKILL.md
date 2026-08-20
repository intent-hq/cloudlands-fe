---
name: react/store
description: >-
  ReactStore import, initialization, disposal, and Store-runtime guidance for the
  React signal Store variant. Use for @augmentcode/themis/react-store,
  inherited runSaga/dispatch/state behavior, and React signal selector call modes.
type: sub-skill
requires:
  - react
  - core/import-boundaries
sources:
  - "@augmentcode/themis/react-store"
  - "@augmentcode/themis/docs/ARCHITECTURE.md"
  - "@augmentcode/themis/README.md"
triggers:
  - ReactStore
  - react-store import
  - Store state lifecycle
  - signal Store
---
# ReactStore import and lifecycle

Use this skill when a task needs the React signal Store variant. For shared state
policy, reducers, actions, sagas, and package import boundaries, also follow the
matching `core/*` skills.

## Correct import and class choice

- Use `ReactStore` from `@augmentcode/themis/react-store`.
- Do not import React selector internals from `src/*` or `utils/react-selectors/*`.

```ts
import { ReactStore } from "@augmentcode/themis/react-store";

export const reactStore = new ReactStore({ todos: todosReducer });
const dispose = reactStore.init();
```

## Lifecycle rules

- Construct `ReactStore` with app-owned reducers and optional middleware, then
  call `reactStore.init(initialState?)` before invoking direct selector calls or
  `.useValue(...args)`.
- React selector calls return Preact React signal outputs backed by the Store-owned
  state stream after initialization and throw before `init()` or after `dispose()`.
- Keep app shared/domain state in reducers and ReactStore selectors rather than
  module-level shared Preact signals.
- `reactStore.dispatch`, `reactStore.state`, `reactStore.runSaga(sagaFn)`, and
  `reactStore.dispose()` follow the shared Store runtime behavior documented in
  core Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Verification cues

- Imports use `@augmentcode/themis/react-store` for `ReactStore`.
- React examples initialize the Store before signal selector reads.
- The app path uses only the public ReactStore runtime and React signal selectors.