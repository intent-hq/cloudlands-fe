---
name: react/migration/component-migration
description: >-
  Migrate React JSX/TSX components and custom hooks to ReactStore selectors and
  Store-first dispatch. Prefer direct selector signals in components/hooks, use
  selector .useValue(...args) only for necessary hook/plain-value fallback reads,
  .select(state, ...args) in handlers/tests.
type: sub-skill
requires:
  - react/component-integration
  - react/migration
triggers:
  - migrate React component
  - replace React state import
  - selector .useValue component migration
---
# React component migration

Replace old React state/context/custom-hook reads with `ReactStore` selectors,
read in components and custom hooks via direct selector signals where possible,
use `.useValue(...args)` only when a plain value is necessary, and dispatch through the
configured `ReactStore` instance.

React migration steps use component/custom-hook boundaries and the explicit
selector call modes described below.

## Before: context/custom hook consumption

```tsx
import { useCartContext } from "./CartProvider";

export function CartButton({ id }: { id: string }) {
  const { items, addItem, removeItem } = useCartContext();
  const item = items.find((candidate) => candidate.id === id);
  return <button onClick={() => item ? removeItem(id) : addItem(id)}>{item ? "Remove" : "Add"}</button>;
}
```

## After: direct selector signal plus Store dispatch

```tsx
import { reactStore } from "../store/react-store";
import { addItem, removeItem } from "../store/cart/cart-slice";
import { selectCartItemById } from "../store/cart/cart-selectors";

export function CartButton({ id }: { id: string }) {
  const item = selectCartItemById(id);
  return (
    <button onClick={() => reactStore.dispatch(item.value ? removeItem(id) : addItem(id))}>
      {item.value ? "Remove" : "Add"}
    </button>
  );
}
```

## Custom hook migration

Prefer returning signals from migrated custom hooks when callers can accept them.
Use `.useValue(...args)` only for legacy hook contracts that must return plain values.

```tsx
import { selectCartTotal, selectIsCartSaving } from "../store/cart/cart-selectors";

export function useCartSummary() {
  const total = selectCartTotal();
  const isSaving = selectIsCartSaving();
  return { total, isSaving };
}
```

## Handler one-shot reads

Handlers should not call `.useValue(...args)` and should not create direct signals just
to read once. Use `.select(reactStore.state, ...args)`.

```tsx
import { reactStore } from "../store/react-store";
import { checkoutRequested } from "../store/cart/cart-slice";
import { selectCanCheckout } from "../store/cart/cart-selectors";

export function CheckoutButton() {
  function onCheckout() {
    if (selectCanCheckout.select(reactStore.state)) {
      reactStore.dispatch(checkoutRequested());
    }
  }
  return <button onClick={onCheckout}>Checkout</button>;
}
```

## Rollout order per component

1. Replace old state/context/custom-hook imports with the new slice actions,selectors, and configured `reactStore` instance.
2. Replace render-time reads with direct selector signals; use `.useValue(...args)` only
   for necessary plain-value boundaries.
3. Replace writes with `reactStore.dispatch(actionCreator(...))`.
4. Replace handler/test one-shot reads with `.select(reactStore.state, ...args)`.
5. Keep single-component ephemeral UI state in React component state.
6. Remove obsolete providers/hooks only after all consumers migrate.

## Bad: calling `.useValue` in an event handler

```tsx
// BAD: .useValue belongs in React components/custom hooks during render, not handlers.
function onSubmit() {
  const canCheckout = selectCanCheckout.useValue();
  if (canCheckout) reactStore.dispatch(checkoutRequested());
}
```

## Bad: duplicate old and new owners

```tsx
// BAD: writing context state and ReactStore state makes ownership ambiguous.
function badAdd(id: string) {
  legacyCartContext.addItem(id);
  reactStore.dispatch(addItem(id));
}
```

## Cross-references

- `../../component-integration/SKILL.md` — React app bootstrap and dispatch rules.
- `../../selector-lifecycle/SKILL.md` — call-mode guardrails.
- `../cleanup/SKILL.md` — removing obsolete providers/hooks after migration.