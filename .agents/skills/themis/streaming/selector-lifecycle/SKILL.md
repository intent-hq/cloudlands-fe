---
name: streaming/selector-lifecycle
description: >-
  Lifecycle guidance for StreamingStore selectors: selectors may be defined from
  the configured StreamingStore, but direct observable calls require init();
  dispose() tears down the Store-owned stream state. Use this for
  stream observation timing, withStore(streamStore), and Svelte-readable contrast notes.
type: sub-skill
requires:
  - streaming
  - streaming/selectors
sources:
  - "@augmentcode/themis/streaming-store"
  - package-internal streaming selector implementation
  - augmentcode/themis:docs/SELECTORS.md
triggers:
  - stream selector lifecycle
  - observe selector stream
  - selector before init
  - streaming selector teardown
  - withStore stream
---
# Streaming selector lifecycle

Use this skill to decide when a Streaming selector can be invoked, observed, or bound to an alternate StreamingStore.

Use it only for apps that chose the Streaming Store family. Do not combine theseStreaming lifecycle/setup rules with Svelte-readable Store, Svelte readable, Sveltecomponent, or Svelte selector lifecycle/setup patterns in the same app.

## Lifecycle map

| Phase/context | Correct action | Why |
| --- | --- | --- |
| Module setup | Define selectors with streamStore.createSelector(...) | Creation stores the selector callback; it does not read stream state yet. |
| Before init() | Avoid direct selector calls | They need the initialized Store-owned Kefir state stream. |
| After init() | Call selectFoo(...args) for a Kefir observable | The Store state stream is available. |
| Tests/composition | Use selectFoo.select(state, ...args) | Pure synchronous selector path, no Store lifecycle needed. |
| Sagas | Use yield* selectFoo.effect(...args) | Keeps named selector ownership and typed-redux-saga style. |
| Explicit StreamingStore binding | Use selectFoo.withStore(streamStore)(...args) | Binds to another initialized StreamingStore. |
| Teardown | Stop consumers and call streamStore.dispose() when the owner ends | dispose() clears Store-owned stream state and shared runtime resources. |

## Operational guardrails

- Direct selector calls intentionally throw before `init()` and after `dispose()`; do not hide that error with fallback empty streams.
- A direct selector call returns a Kefir observable. Manage observation/teardownusing the consuming app's Kefir subscription pattern.
- Same StreamingStore + selector + args direct calls reuse the cached Kefir Observable, but only call direct observable mode after `init()` or through a valid `.withStore(...)` binding.
- `.withStore(...)` accepts another initialized StreamingStore; use it for tests/integration adapters that own their own initialized Store state.
- `.select(...)` and `.effect(...)` are not streaming subscriptions. They are thepure read and saga read escape hatches shared with the Svelte selector API.
- Selector-channel helpers can consume StreamingStore selectors in sagas through
  the shared `.select`/`.effect` read shape. Pass plain args to the helper args
  tuple; do not treat direct Kefir Observable selector outputs as saga
  subscriptions.

## Svelte-readable contrast

- Streaming selectors do not call Svelte `getContext()` and do not return Svelte`Readable` values.
- Do not apply Svelte component-init readable rules to streaming consumers.
- If a task is about `$selector` template values, `derived(...)` readables, or`lifecycle_outside_component`, route that separate Svelte app/code path to`../../svelte/selector-lifecycle/SKILL.md`.
- Do not make one app use both Streaming selector lifecycle and Svelte selectorlifecycle/setup rules.

## Verification cues

- Examples initialize the `StreamingStore` before direct selector invocation.
- Pre-init or post-dispose behavior is either avoided or explicitly tested as the documented selector state error.
- Streaming guidance does not instruct agents to call `selectFoo()` as a Sveltereadable or to use Svelte `$` template auto-subscription.