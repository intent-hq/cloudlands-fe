---
name: streaming/store
description: >-
  StreamingStore import, initialization, disposal, and Store-runtime guidance for
  the Kefir/observable Store variant. Use for @augmentcode/themis/streaming-store,
  inherited runSaga/dispatch/state behavior, and observable selector lifecycle.
type: sub-skill
requires:
  - streaming
  - core/import-boundaries
sources:
  - "@augmentcode/themis/streaming-store"
  - "@augmentcode/themis/docs/ARCHITECTURE.md"
  - "@augmentcode/themis/README.md"
triggers:
  - StreamingStore
  - streaming-store import
  - Store state lifecycle
  - Kefir Store
  - observable Store
---
# StreamingStore import and lifecycle

Use this skill when a task needs the Kefir/observable Store variant. For shared state policy, reducers, actions, sagas, and package import boundaries, also follow the matching `core/*` skills.

This is Streaming Store family guidance. For the same app/package/code path, do not apply alternate Store-family or lifecycle patterns.

## Correct import and class choice

- Use `StreamingStore` from `@augmentcode/themis/streaming-store`.
- Do not import `StreamingStore` from the package root, `src/*`, or `utils/streaming-selectors/*`.

```ts
import { StreamingStore } from "@augmentcode/themis/streaming-store";

export const streamStore = new StreamingStore({ todos: todosReducer });
const dispose = streamStore.init();
```

## Lifecycle rules

- Construct `StreamingStore` with app-owned reducers and optional middleware, then call `streamStore.init(initialState?)` before invoking streaming selector calls.
- Streaming selector calls return Kefir `Observable` outputs backed by the Store-owned Kefir state stream after initialization and throw before `init()` or after `dispose()`.
- `streamStore.dispatch`, `streamStore.state`, `streamStore.runSaga(sagaFn)`, and `streamStore.dispose()` follow the shared Store runtime behavior documented in core Store guidance.
- Do not manually register package-owned `@internal_` reducers or internal sagas.

## Logging and tracing streams

`StreamingStore.traceStreams` is a frozen, read-only collection of Kefir
observables shared symmetrically with `Store` and `ReactStore`: `selectorDetail`,
`selectorSummary`, `selectorCadence`, `sagaMonitor`, `runtimeError`, and
`reduxAction`. Import
`StoreTraceStreams` and `StoreLoggerFactory` from
`@augmentcode/themis/types` when annotating a custom logger. The default logger
subscribes to these streams and writes the established console prefixes. Redux
action middleware is a pure event producer; StoreRuntime owns the default
legend/group rendering. A custom `loggerFactory` replaces it and may return a
disposer.

Use `summaryEnabled: true` in the flat `traceSelectors` options object to opt
into selector summary allocation. `summaryIntervalMs` controls publication
cadence; detailed trace flags do not allocate summaries. Dispose direct Kefir
subscriptions before `streamStore.dispose()`. Store disposal stops the logger,
summary interval, selector cadence resources, and other Store-owned tracing
resources; a later successful `init()` reattaches the configured logger.

## Streaming family boundary

- `StreamingStore` selector direct calls return Kefir observables.
- Keep one concrete Store selector and lifecycle pattern per app/code path.

## Verification cues

- Imports use `@augmentcode/themis/streaming-store` for `StreamingStore`.
- Examples and docs do not describe `Store` as a streaming API.
- Streaming selector usage is initialized before observation, or tests explicitly assert the pre-init error path.

## See also

- `streaming/selectors/SKILL.md` — Kefir selector return model.
- `streaming/selector-lifecycle/SKILL.md` — safe invocation/teardown timing.
- `core/import-boundaries/SKILL.md` — public package import surface.