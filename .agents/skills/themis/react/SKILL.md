---
name: react
description: >-
  ReactStore routing index for React UI work in themis. Use for
  @augmentcode/themis/react-store, Preact React signals, Babel transform or
  useSignals() tracking, signal selector results, direct signal reads, selector
  .useValue(...args) only when hook/plain-value fallbacks are necessary, and
  React-specific component/lifecycle/scheduling/migration routing. Route shared
  Redux/redux-saga concepts to core, Svelte readable work to svelte, and
  Node/server/observable work to streaming. Never mix this concrete React Store
  family with Svelte Store or StreamingStore patterns in one app.
type: core
requires:
  - core
sources:
  - ./signals/SKILL.md
  - ./selectors/SKILL.md
  - ./store/SKILL.md
  - ./component-integration/SKILL.md
  - ./selector-lifecycle/SKILL.md
  - ./selector-scheduling/SKILL.md
  - ./migration/SKILL.md
  - augmentcode/themis:README.md
  - augmentcode/themis:docs/SELECTORS.md
  - "@augmentcode/themis/react-store"
triggers:
  - ReactStore
  - react-store import
  - React selector
  - Preact signal
  - React signal
  - signal .value
  - useSignals
  - selector .useValue
  - Preact signal selector
  - ReadonlySignal selector
  - React component integration
  - React selector lifecycle
  - React selector scheduling
  - React migration
---
# ReactStore and signal selector routing

Use this root for React-specific `themis` work when the touched app or
code path has React evidence: React components/hooks, JSX/TSX UI, imports from
`react`, `ReactStore` from `@augmentcode/themis/react-store`, or Preact React signal
selector consumption. Generic Redux/redux-saga guidance remains in `../core/`.

## Exclusive React Store family rule

- A React app using this skill has chosen `ReactStore` and Preact React signal
  direct selector calls as the preferred component/custom-hook integration path.
  `.useValue(...args)` remains available only for necessary hook/plain-value fallbacks.
- Do **not** apply Svelte `Store` readable/component lifecycle patterns or
  `StreamingStore` Kefir/observable selector patterns inside the same app path.
- In mixed repositories, route separate Svelte or Node/server apps to their own
  `../svelte/` or `../streaming/` guidance without mixing concrete Store families.

## React leaf routes

| Route | Use when |
| --- | --- |
| `./signals/SKILL.md` | General Preact Signals guidance for ReactStore apps: `ReadonlySignal<T>`, `.value`, `computed`, Babel transform/`useSignals()` tracking, direct JSX signal rendering, component-local signal hooks, and avoiding module-level shared signal state. |
| `./store/SKILL.md` | Choosing/importing `ReactStore`, initialization/disposal, shared Store runtime behavior, or Store-family contrast. |
| `./selectors/SKILL.md` | Authoring selectors whose direct calls return cached `ReadonlySignal<R>` outputs, preferring direct signals in React consumers, using `.useValue(...args)` only for hook/plain-value fallback paths, plus `.withStore`, `.select`, and saga-only `.effect`. |
| `./component-integration/SKILL.md` | Wiring `ReactStore` into JSX/TSX React apps, bootstrap/root init and disposal ownership, app saga startup through `reactStore.runSaga(sagaFn)`, React component reads through direct signals first, and Store-first dispatch. |
| `./selector-lifecycle/SKILL.md` | Choosing React selector call modes across component render/custom hooks, direct signal-aware code, handlers/callbacks/tests, sagas, selector composition, and explicit `.withStore(...)` binding. |
| `./selector-scheduling/SKILL.md` | React `ReadonlySignal`/`.useValue(...args)` scheduling guidance: same source + selector + args output reuse, Store-owned selector coalescing, `throttledSelectorFrequency`, package-private scheduler boundaries, and no manual debounce/audit-log misuse. |
| `./migration/SKILL.md` | React migration/adoption work from local React state/context/hooks/effects/external stores to `ReactStore`, selectors, actions, reducers, sagas, signal-first component consumption, and cleanup. |

First-time app setup starts at the canonical root setup skill: `../setup/SKILL.md`.

## Routing rules

- Use `ReactStore` only from `@augmentcode/themis/react-store`.
- Create production app-local React selectors through the configured
  `ReactStore` instance: `reactStore.createSelector(...)`.
- Direct selector calls return `ReadonlySignal<R>` values and are the preferred
  React component/custom-hook integration path when consumers can accept signals.
- Components that read direct selector `.value` must rely on the Preact Signals
  Babel transform or an explicit `useSignals()` runtime fallback; passing or
  intentionally rendering signals in JSX is valid when the consumer is
  signal-aware.
- Use `.useValue(...args)` only when a React hook/plain value is necessary and adapting
  the consumer to accept a signal is impractical.
- Direct signal outputs and `.useValue(...args)` are throttled by
  `throttledSelectorFrequency`.
- Direct `ReadonlySignal` outputs are cached for the same ReactStore instance + selector + args; do not add memoize/cache/debounce/throttle wrappers for selector performance.
- Selector trace output is a default-off diagnostic; pass
  `{ traceSelectors: true }` only while diagnosing selector scheduling.
- `.effect(...args)` stays saga-only; it is not a hook or render subscription.
- `.select(state, ...args)` stays the pure selector path for tests/composition.
- React component, selector lifecycle, selector scheduling, and migration work must
  route to React leaves above. Do not use Svelte `component-integration`,
  `selector-lifecycle`, `selector-scheduling`, or `migration/**` leaves as
  operational guidance for a React app.

## React parity map from Svelte leaves

| Svelte capability | React route | React substitution / applicability |
| --- | --- | --- |
| `../svelte/component-integration/SKILL.md` | `./component-integration/SKILL.md` | Applicable as React component/app-root wiring. Substitute `ReactStore`, JSX/TSX components/hooks, Preact React direct selector signals, `.useValue(...args)` only for hook/plain-value fallback paths, and Store-first dispatch; do not use Svelte readables, `$selector` template syntax, `+layout.svelte`, `onDestroy`, or Svelte context. |
| `../svelte/selector-lifecycle/SKILL.md` | `./selector-lifecycle/SKILL.md` | Applicable as React selector call-mode guidance. Direct calls return `ReadonlySignal<R>` and are preferred for React consumers that can accept signals, `.useValue(...args)` is a necessary-only plain-value fallback, `.select(state, ...args)` is for handlers/tests/composition, and `.effect(...args)` is saga-only. No `lifecycle_outside_component`/Svelte-context model. |
| `../svelte/selector-scheduling/SKILL.md` | `./selector-scheduling/SKILL.md` | Applicable as React signal/`.useValue(...args)` scheduling guidance. Scheduling remains Store-owned and tuned with `ReactStore` `throttledSelectorFrequency`; do not import scheduler internals or wrap signals/read values in ad hoc timers. |
| `../svelte/selectors/SKILL.md` | `./selectors/SKILL.md` | Already implemented for React selectors. Substitute Preact React `ReadonlySignal` direct outputs, signal/plain arguments, `.useValue(...args)`, `.withStore(reactStore)`, `.select`, and `.effect`; no Svelte readable direct calls. |
| `../svelte/migration/SKILL.md` and `../svelte/migration/**/SKILL.md` | `./migration/SKILL.md` and `./migration/**/SKILL.md` | Applicable only as migration/adoption structure, not literal Svelte-store/rune conversion. React leaves should map local/shared React state, context/hooks, external-store subscriptions, `useMemo` derivations, and `useEffect` side effects to Redux slices, ReactStore selectors, and sagas. Svelte-only primitives (`writable`, `derived`, `$state`, `$derived`, `$effect`, templates) are documented as not applicable. |

Use the React leaves above for operational guidance; Svelte leaves are coverage
references only and must not be applied directly to a React app path.

## Verification cues

- Examples import package APIs only from public subpaths such as
  `@augmentcode/themis/react-store`, `@augmentcode/themis/saga`, and
  `@augmentcode/themis/types`.
- React guidance states that direct selector calls returning signals are preferred
  for React consumers, while `.useValue(...args)` returns plain `R` only as a necessary
  hook/plain-value fallback.
- Signal examples mention `.value` tracking through the Babel transform or
  explicit `useSignals()` and do not introduce module-level shared signal state.
- The same app path does not mix `ReactStore` with Svelte readable or Kefir
  observable Store guidance.