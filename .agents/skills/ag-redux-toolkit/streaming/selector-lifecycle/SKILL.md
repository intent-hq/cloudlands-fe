---
name: streaming/selector-lifecycle
description: >-
  Lifecycle guidance for StreamingStore selectors: selectors may be defined from
  the configured StreamingStore, but direct observable calls and getStreamState()
  require init(); dispose() tears down the Store-owned stream state. Use this for
  stream observation timing, withStore(stream), and Svelte-readable contrast notes.
type: sub-skill
requires:
  - streaming
  - streaming/selectors
sources:
  - ag-redux-toolkit/streaming-store
  - package-internal streaming selector implementation
  - augmentcode/ag-redux-toolkit:docs/SELECTORS.md
triggers:
  - stream selector lifecycle
  - observe selector stream
  - getStreamState before init
  - streaming selector teardown
  - withStore stream
---
# Streaming selector lifecycle

Use this skill to decide when a Streaming selector can be invoked, observed, or
bound to an alternate stream state source.

Use it only for apps that chose the Streaming Store family. Do not combine these
Streaming lifecycle/setup rules with Svelte-readable Store, Svelte readable, Svelte
component, or Svelte selector lifecycle/setup patterns in the same app.

## Lifecycle map

| Phase/context | Correct action | Why |
| --- | --- | --- |
| Module setup | Define selectors with `streamStore.createSelector(...)` | Creation stores the selector callback; it does not read stream state yet. |
| Before `init()` | Avoid direct selector calls and `getStreamState()` | They need the initialized Store-owned Kefir state stream. |
| After `init()` | Call `selectFoo(...args)` for a Kefir observable | The Store state stream is available. |
| Tests/composition | Use `selectFoo.select(state, ...args)` | Pure synchronous selector path, no Store lifecycle needed. |
| Sagas | Use `yield* selectFoo.effect(...args)` | Keeps named selector ownership and typed-redux-saga style. |
| Alternate state stream | Use `selectFoo.withStore(streamSource)(...args)` | Binds to a `StreamingStore`-like source or Kefir state observable. |
| Teardown | Stop consumers and call `streamStore.dispose()` when the owner ends | `dispose()` clears Store-owned stream state and shared runtime resources. |

## Operational guardrails

- `StreamingStore.getStreamState()` intentionally throws before `init()` and after
  `dispose()`; do not hide that error with fallback empty streams.
- A direct selector call returns a Kefir observable. Manage observation/teardown
  using the consuming app's Kefir subscription pattern.
- `.withStore(...)` accepts either a source with `getStreamState()` or a Kefir
  observable of Store state; use it for tests/integration adapters that own their
  own state stream.
- `.select(...)` and `.effect(...)` are not streaming subscriptions. They are the
  pure read and saga read escape hatches shared with the Svelte selector API.

## Svelte-readable contrast

- Streaming selectors do not call Svelte `getContext()` and do not return Svelte
  `Readable` values.
- Do not apply Svelte component-init readable rules to streaming consumers.
- If a task is about `$selector` template values, `derived(...)` readables, or
  `lifecycle_outside_component`, route that separate Svelte app/code path to
  `../../svelte/selector-lifecycle/SKILL.md`.
- Do not make one app use both Streaming selector lifecycle and Svelte selector
  lifecycle/setup rules.

## Verification cues

- Examples initialize the `StreamingStore` before direct selector invocation.
- Pre-init or post-dispose behavior is either avoided or explicitly tested as the
  documented `getStreamState()` error.
- Streaming guidance does not instruct agents to call `selectFoo()` as a Svelte
  readable or to use Svelte `$` template auto-subscription.
