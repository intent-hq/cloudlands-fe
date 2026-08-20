---
name: react/migration/assessment
description: >-
  Assess React state before ReactStore adoption. Inventory useState/useReducer,
  context providers, custom hooks, external stores, derivations, effects, and
  consumers; classify shared/persistent/async-driven state vs component-local UI
  state.
type: sub-skill
requires:
  - react
  - react/migration
triggers:
  - audit React state
  - classify React state
  - React migration inventory
---
# React migration assessment

Before editing, inventory current React state ownership and decide what moves to`ReactStore` versus what stays local.

## Identify React state owners

Search for state and effect patterns in React files:

- `useState`, `useReducer`, and reducer-like custom hooks.
- Context providers and `useContext` consumers.
- Shared custom hooks that return mutable state, setters, or derived values.
- External stores, event emitters, browser storage, or subscription wrappers.
- `useMemo`/derived values reused across components.
- `useEffect` blocks with fetches, timers, storage, subscriptions, or IPC.

## Decision framework

### Move to ReactStore

- State read or written by multiple components or routes.
- State that persists across navigation, reloads, or app sessions.
- State involved in async operations, debouncing, timers, IPC, or server sync.
- State that drives business logic, permissions, feature flags, or cross-featurecoordination.
- Derivations duplicated across components/hooks.

### Keep in React component state

- Single-component hover/focus/open state.
- Uncommitted form drafts that do not leave one component.
- DOM measurement, uncontrolled input details, scroll position, and animationstate that only matters while one component is mounted.

## Assessment output

Produce evidence that downstream migration leaves can consume:

```ts
type ReactStatePattern = "useState" | "useReducer" | "context" | "custom-hook" | "external-store" | "useMemo" | "useEffect";
type ReactMigrationVerdict = "reactstore" | "local";

type ReactStateInventoryRecord = {
  owner: string;
  patterns: ReactStatePattern[];
  stateFields: string[];
  derivedValues: string[];
  sideEffects: string[];
  consumers: string[];
  verdict: ReactMigrationVerdict;
  nextSkills: string[];
};

export const cartInventory: ReactStateInventoryRecord = {
  owner: "src/cart/CartProvider.tsx",
  patterns: ["context", "useReducer", "useMemo", "useEffect"],
  stateFields: ["items", "couponCode"],
  derivedValues: ["itemCount", "subtotal"],
  sideEffects: ["localStorage sync"],
  consumers: ["CartSummary.tsx", "HeaderCartButton.tsx"],
  verdict: "reactstore",
  nextSkills: ["setup", "writable-stores", "derived-stores", "side-effects", "component-migration"],
};
```

## Bad assessment example

```ts
// BAD: a single button's hover state should remain local React state.
export const hoverInventory = {
  owner: "src/products/ProductCard.tsx",
  stateFields: ["isHovered"],
  consumers: ["ProductCard.tsx"],
  verdict: "reactstore",
};
```

## Downstream routing

- Mutable shared state → `react/migration/writable-stores`.
- Shared derivations → `react/migration/derived-stores`.
- Shared async/persistent effects → `react/migration/side-effects`.
- JSX/TSX consumers → `react/migration/component-migration`.
- Old owners/import paths → `react/migration/cleanup`.