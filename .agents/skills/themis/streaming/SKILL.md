---
name: streaming
description: >-
  Root routing index for StreamingStore and Kefir/observable selector guidance in
  themis. Use by default for Node/server environments, background
  workers, CLIs, test harnesses, apps or code paths without concrete UI evidence,
  and cases where selector direct calls should return Kefir streams. Route shared
  Redux/redux-saga work to core and keep this concrete Streaming Store family
  separate from alternate Store integration patterns.
type: core
requires:
  - core
sources:
  - "@augmentcode/themis/README.md"
  - "@augmentcode/themis/docs/SELECTORS.md"
  - "@augmentcode/themis/streaming-store"
  - package-internal streaming selector implementation
triggers:
  - streaming store
  - StreamingStore
  - Kefir selector
  - observable selector
  - streaming selector
  - stream selector lifecycle
  - Node store
  - server store
  - background worker store
  - CLI store
  - test harness store
---
# Streaming Store and selector routing

Use this root for Streaming-specific `themis` work and as the default package route when the touched code path uses the Kefir/observable Store variant. It covers Node/server environments, background workers, CLIs, test harnesses, and apps without framework-specific integration. Generic Redux/redux-saga guidance remains in `../core/`.

> StreamingStore is the Kefir/observable variant exported from `@augmentcode/themis/streaming-store`.

## Exclusive Streaming Store family rule

- A Node/server/CLI/worker/test-harness app using this skill has chosen the concrete Streaming Store family: `StreamingStore`, Kefir/observable selector calls, and streaming lifecycle/setup patterns.
- Do **not** apply alternate Store-family or lifecycle patterns inside that same app/package/code path.
- In a mixed repository, keep framework-specific applications and this Streaming app isolated by code path.

## Preflight

- Read this skill plus the streaming leaf that matches the touched behavior.
- Also read `../core/import-boundaries/SKILL.md` when changing imports or package paths.
- Record why StreamingStore/Kefir behavior is the target route. In mixed repositories, classify by the files being changed.
- Do not describe `Store` as a streaming API.
- Keep implementation guidance focused on StreamingStore and Kefir observable lifecycle behavior.
- Include verifier-ready evidence: skill path inventory, stale streaming path/name searches, frontmatter/requires checks, install/cleanup smoke when safe, and `git diff --check`.

## Streaming leaf routes

| Route | Use when |
| --- | --- |
| ./store/SKILL.md | Choosing/importing StreamingStore, initialization/disposal, and inherited Store runtime behavior. |
| ./selectors/SKILL.md | Authoring Store-bound selectors whose direct calls return cached Kefir Observable values, including observable selector arguments, .withStore, .select, and .effect. |
| ./selector-lifecycle/SKILL.md | Deciding when streaming selectors may be invoked/observed and how init()/dispose() affect stream state. |

First-time app setup starts at the canonical root setup skill: `../setup/SKILL.md`.

## Routing rules

- Use `StreamingStore` only from `@augmentcode/themis/streaming-store`.
- Treat this app/code path as Streaming-only; do not add alternate Store lifecycle setup to the same app.
- Create production app-local streaming selectors through the configured `StreamingStore` instance: `streamStore.createSelector(...)`.
- Direct selector calls return Kefir observables; use them through the consuming app's observable subscription pattern.
- Direct Kefir `Observable` outputs are cached for the same StreamingStore instance + selector + args; prefer the same selector + args over manual stream passing where valid.
- Streaming selector emissions use the configured Store `throttledSelectorFrequency` policy, defaulting to 64 FPS; rapid Store or observable argument bursts coalesce to the latest pending selector value.
- Selector trace output is disabled by default; pass `{ traceSelectors: true }` in the final StreamingStore options object only for temporary diagnostics.
- `StreamingStore.traceStreams` is the same frozen, read-only Kefir stream collection exposed by every Store family: `selectorDetail`, `selectorSummary`, `selectorCadence`, `sagaMonitor`, `runtimeError`, and `reduxAction`. Observe these public streams; never import or publish through internal emitters.
- With `logReduxActions: true`, pure middleware publishes one immutable `reduxAction` event after successful `next(action)`; StoreRuntime's default logger renders the legacy grouped action/state output. The event retains action and state references, so redact sensitive values before sharing logs.
- The built-in console logger is attached by default. Pass a typed `loggerFactory` in the final options object to receive all six streams and optionally return a disposer; custom factories replace, rather than augment, default console logging.
- Set `traceSelectors: { summaryEnabled: true, summaryIntervalMs: ... }` to allocate and publish selector summaries. `summaryEnabled` is the sole summary switch; detailed selector flags remain independent.
- `.select(state, ...args)` stays the pure selector path for tests/composition.
- `.effect(...args)` stays the typed-redux-saga path for saga reads.
- Core saga guidance, selector-channel helpers, `waitFor`, reducers, actions, and state policy remain in `../core/`.

## Verification cues

- `./**/SKILL.md` files are non-empty and contain operational guidance, not compatibility shims.
- Root/artifact routing lists `./SKILL.md`, `./store/SKILL.md`, `./selectors/SKILL.md`, and `./selector-lifecycle/SKILL.md`.
- Stale scans find no obsolete streaming skill path/name references.