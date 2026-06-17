---
name: streaming
description: >-
  Root routing index for StreamingStore and Kefir/observable selector guidance in
  ag-redux-toolkit. Use by default for Node/server environments, background
  workers, CLIs, test harnesses, apps or code paths without concrete UI evidence,
  and cases where selector direct calls should return Kefir streams. Route shared
  Redux/redux-saga work to core, React UI/signals work to react, and Svelte
  frontend/readable work to svelte only when Svelte/SvelteKit evidence exists.
  Never mix this concrete Streaming Store family with Store/readable,
  ReactStore/signal, or component patterns in one app.
type: core
requires:
  - core
sources:
  - augmentcode/ag-redux-toolkit:README.md
  - augmentcode/ag-redux-toolkit:docs/SELECTORS.md
  - "@augmentcode/ag-redux-toolkit/streaming-store"
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

Use this root for Streaming-specific `ag-redux-toolkit` work and as thedefault package route when the touched code path has no concrete Svelte/SvelteKitor React UI evidence. It covers Node/server environments, background workers,CLIs, test harnesses, apps without UI integration, and the Kefir/observable Storevariant. Generic Redux/redux-saga guidance remains in `../core/`, Reactsignal/component guidance remains in `../react/` only for React UI paths, andSvelte-readable selector/component guidance remains in `../svelte/` only forfrontend-facing Svelte paths.

> Store split truth: StreamingStore is the Kefir/observable variant exportedfrom @augmentcode/ag-redux-toolkit/streaming-store. ReactStore is the React signal variant exported from @augmentcode/ag-redux-toolkit/react-store. Store is the Svelte-readable class exported from @augmentcode/ag-redux-toolkit/svelte-store.

## Exclusive Streaming Store family rule

- A Node/server/CLI/worker/test-harness/non-Svelte app using this skill haschosen the concrete Streaming Store family: `StreamingStore`, Kefir/observableselector calls, and streaming lifecycle/setup patterns.
- Do **not** apply `Store`, Svelte `Readable`, `$selector` template,Svelte component integration, `ReactStore`, React `.useValue(...)`, Preact signalcomponent integration, Svelte setup, or Svelte selector lifecyclepatterns inside that same app/package/code path.
- In a mixed repository, a separate frontend React app may use `../react/`, and aseparate frontend Svelte/SvelteKit app may use`../svelte/`, but keep those choices isolated from this Streaming app.

## Preflight

- Read this skill plus the streaming leaf that matches the touched behavior.
- Also read `../core/import-boundaries/SKILL.md` when changing imports or package paths.
- Record why Svelte evidence is absent or why StreamingStore/Kefir behavior isthe target route. In mixed repositories, classify by the files being changed.
- Do not describe `Store` as a streaming API.
- Do not use Svelte readable, Svelte component, React `.useValue(...)`, React signalrendering, or Svelte lifecyclesetup patterns as implementation guidance for this app.
- Do not copy Svelte readable lifecycle rules into streaming guidance except as ashort contrast note.
- Include verifier-ready evidence: skill path inventory, stale streaming path/namesearches, frontmatter/requires checks, install/cleanup smoke when safe, and`git diff --check`.

## Streaming leaf routes

| Route | Use when |
| --- | --- |
| ./store/SKILL.md | Choosing/importing StreamingStore, initializing/disposal, getStreamState(), inherited Store runtime behavior, or contrasting with the Svelte-readable Store. |
| ./selectors/SKILL.md | Authoring Store-bound selectors whose direct calls return Kefir Observable values, including observable selector arguments, .withStore, .select, and .effect. |
| ./selector-lifecycle/SKILL.md | Deciding when streaming selectors may be invoked/observed, how init()/dispose() affect stream state, and which Svelte-readable call-mode rules do not apply. |

First-time app setup starts at the canonical root setup skill: `../setup/SKILL.md`.

## Routing rules

- Use `StreamingStore` only from `@augmentcode/ag-redux-toolkit/streaming-store`.
- Treat this app/code path as Streaming-only; do not add Svelte-readable orSvelte component lifecycle setup to the same app.
- Create production app-local streaming selectors through the configured`StreamingStore` instance: `streamStore.createSelector(...)`.
- Direct selector calls return Kefir observables. They are not Svelte readables,React signals, or React `.useValue(...)` values; do not use `$selector` templatesyntax, React render hooks, or Svelte context.
- Streaming selector emissions use the configured Store `throttledSelectorFrequency`policy, defaulting to 64 FPS; rapid Store or observable argument bursts coalesceto the latest pending selector value.
- Selector trace output is disabled by default; pass `{ traceSelectors: true }` in the final StreamingStore options object only for temporary diagnostics.
- `.select(state, ...args)` stays the pure selector path for tests/composition.
- `.effect(...args)` stays the typed-redux-saga path for saga reads.
- Core saga guidance, selector-channel helpers, `waitFor`, reducers, actions, andstate policy remain in `../core/`.

## Verification cues

- `./**/SKILL.md` files are non-empty and contain operationalguidance, not compatibility shims.
- Root/artifact routing lists `./SKILL.md`, `./store/SKILL.md`,`./selectors/SKILL.md`, and `./selector-lifecycle/SKILL.md`.
- Stale scans find no old streaming skill path/name references outside deliberatecontrast notes.