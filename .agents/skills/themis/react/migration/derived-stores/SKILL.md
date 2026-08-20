---
name: react/migration/derived-stores
description: >-
  Convert shared React derivations to ReactStore selectors. React sources include
  useMemo, derived custom-hook values, context selector logic, and duplicated
  render calculations.
type: sub-skill
requires:
  - react/selectors
  - react/migration
triggers:
  - migrate React derived state
  - useMemo to selector
  - derived hook to selector
---
# React derived state migration

Shared React derivations move to `reactStore.createSelector(...)`. Compose
selectors with `.select(state, ...args)`, consume migrated values in components
or custom hooks with direct selector signals first, use `.useValue(...args)` only for
necessary plain-value fallback reads, and test pure selector logic with `.select`.

React sources include duplicated `useMemo`, derived custom-hook return values,
context selector helpers, and render-time calculations reused across components.

## Before: duplicated React derivation

```tsx
import * as React from "react";
import { useCartContext } from "./CartProvider";

export function CartSummary() {
  const { items, discountCode } = useCartContext();
  const subtotal = React.useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);
  const total = discountCode ? subtotal * 0.9 : subtotal;
  return <span>{total}</span>;
}
```

## After: Store-bound selectors

```ts
import { reactStore } from "../react-store";

export const selectCartItems = reactStore.createSelector((state) => state.cart.items);
export const selectDiscountCode = reactStore.createSelector((state) => state.cart.discountCode);
export const selectCartSubtotal = reactStore.createSelector((state) => {
  return selectCartItems.select(state).reduce((sum, item) => sum + item.price, 0);
});
export const selectCartTotal = reactStore.createSelector((state) => {
  const subtotal = selectCartSubtotal.select(state);
  return selectDiscountCode.select(state) ? subtotal * 0.9 : subtotal;
});
```

## Component and test consumption

```tsx
import { selectCartTotal } from "../store/cart/cart-selectors";

export function CartSummary() {
  const total = selectCartTotal();
  return <span>{total.value}</span>;
}
```

```ts
import { selectCartTotal } from "../store/cart/cart-selectors";

export const total = selectCartTotal.select({ cart: { items: [{ price: 10 }], discountCode: null } });
```

## Parameterized selectors

```ts
export const selectTodoById = reactStore.createSelector((state, id: string) => {
  return state.todos.byId[id];
});

export const selectTodoTitle = reactStore.createSelector((state, id: string) => {
  return selectTodoById.select(state, id)?.title ?? "Untitled";
});
```

## Rules

- One selector per shared derivation; keep selectors narrow and pure.
- Compose upstream selectors with `.select(state, ...args)` inside selector bodies.
- Components and custom hooks prefer direct signal calls; use `.useValue(...args)` only
  when a plain-value boundary is necessary and a signal-aware rewrite is
  impractical.
- Handlers, tests, and selector unit tests use `.select(state, ...args)`.
- Sagas use `yield* selectFoo.effect(...args)`.
- Do not store selector outputs in reducers; reducers own base state only.

## Bad: direct signal form inside selector composition

```ts
// BAD: selector callbacks must stay pure and synchronous against the provided state.
export const selectBadTotal = reactStore.createSelector(() => {
  return selectCartSubtotal().value;
});
```

## Cross-references

- `../../selectors/SKILL.md` — selector creation and call forms.
- `../../selector-lifecycle/SKILL.md` — direct signal, `.useValue`, `.select`, `.effect`, and `.withStore` choices.
- `../component-migration/SKILL.md` — component consumption after migration.