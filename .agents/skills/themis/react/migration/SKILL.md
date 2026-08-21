---
name: react/migration
description: >-
  React migration/adoption playbook for moving shared React state, context/hooks,
  external store subscriptions, useMemo derivations, and useEffect side effects
  to ReactStore, selectors, actions, reducers, and sagas.
type: lifecycle
requires:
  - react
sources:
  - ./assessment/SKILL.md
  - ./setup/SKILL.md
  - ./writable-stores/SKILL.md
  - ./derived-stores/SKILL.md
  - ./side-effects/SKILL.md
  - ./component-migration/SKILL.md
  - ./cleanup/SKILL.md
triggers:
  - React migration
  - migrate React state
  - replace React context state
  - migrate useEffect side effect
  - ReactStore adoption
---
# React migration — React state/context/effects to ReactStore

Use this index when a React app is adopting `themis` and the current
state owner is `useState`, `useReducer`, React context, custom hooks, external
stores, component `useMemo` derivations, or `useEffect` side effects.

## React migration policy

1. **ReactStore owns shared, persisted, or async-driven state.** Anything read or
   written by multiple components, synced to storage/server/IPC, or coordinated
   with async flows moves to actions, reducers, selectors, and sagas.
2. **Component-local ephemeral UI state stays local.** Hover, focus, transient
   form drafts, uncontrolled input details, scroll position, and single-component
   toggles can remain in React component state.
3. **Selectors own shared derivations.** Move duplicated `useMemo`, derived custom
   hook return values, and context selector logic into `ReactStore.createSelector`.
4. **Sagas own shared side effects.** Move persistent subscriptions, fetches,
   debounces, timers, storage sync, and cross-feature effects out of components.

Migrate one state owner/slice at a time. Keep the app on the React Store family:
`ReactStore`, direct Preact React selector signals as the preferred React consumer
path, `.useValue(...args)` only for necessary hook/plain-value fallback paths, and
`.select(state, ...args)` for composition and tests, and `.effect(...args)` for
sagas.

## React migration leaf routes

| Route | Use when |
| --- | --- |
| `./assessment/SKILL.md` | Inventory shared React local state, context/hooks, external stores, derivations, effects, and consumers. |
| `./setup/SKILL.md` | Create and initialize the app-owned `ReactStore`, register reducers, and start app sagas. |
| `./writable-stores/SKILL.md` | Move shared mutable React state into actions, reducers, and serializable slice state. |
| `./derived-stores/SKILL.md` | Move shared derivations to `ReactStore` selectors and test them with `.select`. |
| `./side-effects/SKILL.md` | Move shared, persistent, or async effects to sagas. |
| `./component-migration/SKILL.md` | Migrate JSX/TSX consumption to direct selector signals and Store dispatch. |
| `./cleanup/SKILL.md` | Remove old state owners/import paths and document shims or rollback steps. |

## Recommended order

1. `assessment` — inventory React state owners, derivations, effects, and
   consumers; classify shared vs component-local.
2. `setup` — choose `ReactStore`, create the app store, initialize/dispose at the
   app owner, and start app sagas with `reactStore.runSaga(sagaFn)`.
3. `writable-stores` — move shared mutable React state to serializable slice
   state, actions, and pure reducers.
4. `derived-stores` — move shared derivations to selectors, compose with
   `.select(state, ...args)`, consume in components with direct selector signals
   first, and unit-test with `.select`.
5. `side-effects` — move shared or async effects to sagas.
6. `component-migration` — replace component/context/custom-hook reads with
   direct selector signals where possible, `.useValue(...args)` only where plain values
   are necessary, and Store-first dispatch.
7. `cleanup` — remove old providers/hooks/state owner modules after verification.

## Quick reference

| React source pattern | ReactStore target |
| --- | --- |
| Shared `useState` / `useReducer` state | Slice initial state + actions + reducer |
| Context provider that stores business state | `ReactStore` reducer map + selectors/actions |
| Custom hook exposing shared mutable state | Direct selector signals + action dispatch helpers; `.useValue(...args)` only for plain-value hook contracts |
| External mutable store subscription | Reducer state + saga/channel integration as needed |
| Repeated `useMemo`/derived hook value | `reactStore.createSelector(...)` |
| `useEffect` fetch/timer/storage sync | Saga with `takeEvery`/`takeLatest`, `call`, `put`, `delay` |
| Component render read | `selectFoo(...args)` signal first; `selectFoo.useValue(...args)` only for necessary plain values |
| Handler/test/composition read | `selectFoo.select(reactStore.state, ...args)` |

## Orchestration example

```ts
type ReactMigrationStep =
  | "setup"
  | "writable-stores"
  | "derived-stores"
  | "side-effects"
  | "component-migration"
  | "cleanup";

type ReactStateAssessment = {
  owner: string;
  verdict: "reactstore" | "local";
  patterns: Array<"useState" | "useReducer" | "context" | "useMemo" | "useEffect">;
  consumers: string[];
};

const cartAssessment: ReactStateAssessment = {
  owner: "src/cart/CartProvider.tsx",
  verdict: "reactstore",
  patterns: ["context", "useReducer", "useMemo", "useEffect"],
  consumers: ["CartSummary.tsx", "HeaderCartButton.tsx", "Checkout.tsx"],
};

const nextSteps: ReactMigrationStep[] = cartAssessment.verdict === "reactstore"
  ? ["setup", "writable-stores", "derived-stores", "side-effects", "component-migration", "cleanup"]
  : ["cleanup"];
```

## Verification cues

- React examples import `ReactStore` from `@augmentcode/themis/react-store` and keep
  selectors Store-bound.
- Components/custom hooks consume migrated shared state with direct selector signals
  first; `.useValue(...args)` appears only for documented plain-value fallbacks.
- Selectors compose and tests assert with `.select(state, ...args)`.
- Sagas read migrated state with `.effect(...args)` and start via
  `reactStore.runSaga(sagaFn)` after `init()`.
- React migration instructions keep state ownership, selector consumption, and
  side-effect ownership explicit at each step.