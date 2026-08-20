---
name: react/selector-scheduling
description: >-
  ReactStore selector emission scheduling guidance. Use for Store-owned
  coalescing of preferred direct ReadonlySignal outputs and .useValue(...args)
  fallback reads,
  throttledSelectorFrequency tuning, package-private scheduler boundaries, and
  avoiding manual debounce/wrapper subscriptions or audit-log misuse.
type: sub-skill
requires:
  - react
  - react/selectors
sources:
  - "@augmentcode/themis/react-store"
  - ../selectors/SKILL.md
triggers:
  - React selector scheduling
  - signal selector scheduler
  - throttled React selector
  - throttledSelectorFrequency React
---
# React selector scheduling — internal only

> Selector scheduler helpers are package-private implementation details. React
> consumers must not import scheduler internals, wrap selector outputs in their
> own debounce layer, or treat selector emissions as event/audit logs.

Public facade: `@augmentcode/themis/react-store`. Create selectors through the
configured `ReactStore` instance and tune selector coalescing only through
`ReactStore` options such as `throttledSelectorFrequency`.

## Store-first scheduling rule

- Create production selectors with the configured `ReactStore` instance:
  `reactStore.createSelector(...)`.
- Direct selector calls return Preact React `ReadonlySignal<R>` values and are the
  preferred React consumer integration path when callers can accept signals.
- Use `selectFoo.useValue(...args)` in React components and custom hooks only when a
  hook/plain value is necessary and a signal-aware rewrite is impractical.
- Direct `ReadonlySignal` outputs are cached for the same ReactStore instance + selector + args, and direct
  signal outputs plus `.useValue(...args)` subscribe to the owning `ReactStore`'s
  Store-owned cadence, capped by `throttledSelectorFrequency`.
- Tune coalescing only with the final constructor options argument, for example
  `new ReactStore(reducers, middleware, { throttledSelectorFrequency })`.
- Omit `throttledSelectorFrequency` for the default `64` FPS. Explicit values
  must be finite numbers in the inclusive `1..256` range; fractional values are
  supported.
- Selector trace output is disabled by default; pass `{ traceSelectors: true }`
  in the same final options object only for temporary diagnostics.
- Use `.select(reactStore.state, ...args)` for one-shot handlers/tests and
  `.effect(...args)` for sagas; those paths are not React render subscriptions.

## Do not

- Do not import selector scheduler helpers from package internals or source-shaped
  paths.
- Do not wrap selector callbacks, selector signals, or `.useValue(...args)` results with ad hoc `memoize`, `cache`, debounce, `setTimeout`, `requestAnimationFrame`, streams, or proxy state just to reduce React renders.
- Do not manually subscribe to selector outputs from React components; pass/read the
  selector signal directly, or use `.useValue(...args)` only at necessary plain-value
  boundaries.
- Do not rely on selector outputs as audit/event streams; they represent the
  latest derived state and may coalesce intermediate writes.
- Do not replace this React signal scheduling model with unrelated selector
  scheduling rules in the same React app path.

## Examples

### 1. Configure coalescing at the ReactStore owner

```ts
import { ReactStore } from "@augmentcode/themis/react-store";
import { pointerReducer } from "./pointer-slice";

export const reactStore = new ReactStore(
  { pointer: pointerReducer },
  undefined,
  { throttledSelectorFrequency: 120, traceSelectors: true }
);
```

### 2. Define selectors through the configured Store

```ts
import { reactStore } from "./react-store";

type Pointer = { x: number; y: number };

export const selectPointer = reactStore.createSelector((state): Pointer => {
  return state.pointer.current;
});

export const selectPointerLabel = reactStore.createSelector((state) => {
  const pointer = selectPointer.select(state);
  return `${pointer.x},${pointer.y}`;
});
```

### 3. Direct signal output is already scheduled

```ts
import { selectPointerLabel } from "./pointer-selectors";

const pointerLabelSignal = selectPointerLabel();

export function readPointerLabelNow() {
  return pointerLabelSignal.value;
}
```

Use the direct form for React consumers that can accept a Preact React
`ReadonlySignal<R>`; this is the preferred component integration path.

### 4. Components and hooks prefer direct signals

```tsx
import { selectPointer, selectPointerLabel } from "./pointer-selectors";

export function PointerBadge() {
  const pointer = selectPointer();
  const label = selectPointerLabel();
  return <span title={`${pointer.value.x}:${pointer.value.y}`}>{label.value}</span>;
}
```

Use `.useValue(...args)` here only if a third-party component or hook API requires
plain values and cannot reasonably accept the signals.

### 5. Event handlers use `.select(state)` for one-shot reads

```tsx
import { reactStore } from "./react-store";
import { copyPointer } from "./pointer-slice";
import { selectPointer } from "./pointer-selectors";

export function handleCopyPointer() {
  const pointer = selectPointer.select(reactStore.state);
  reactStore.dispatch(copyPointer(pointer));
}
```

### 6. Saga code uses `.effect()` rather than React scheduling

```ts
import { call, put, takeLatest } from "typed-redux-saga";
import { pointerMoved, pointerPersisted } from "./pointer-slice";
import { selectPointer } from "./pointer-selectors";

declare const api: { savePointer(pointer: { x: number; y: number }): Promise<void> };

export function* pointerSaga() {
  yield* takeLatest(pointerMoved, function* persistPointer() {
    const pointer = yield* selectPointer.effect();
    yield* call(api.savePointer, pointer);
    yield* put(pointerPersisted());
  });
}
```

### 7. ❌ Bad: manual debounce wrapper around selector output

```tsx
// BAD: this adds stale local state on top of Store-owned selector coalescing.
import * as React from "react";
import { selectPointer } from "./pointer-selectors";

export function useManuallyDebouncedPointer() {
  const pointer = selectPointer();
  const [debounced, setDebounced] = React.useState(pointer.value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(pointer.value), 100);
    return () => window.clearTimeout(id);
  }, [pointer]);
  return debounced;
}
```

### 8. ❌ Bad: treating selector outputs as event logs

```tsx
// BAD: selector values are latest-state projections and can coalesce writes.
import * as React from "react";
import { selectPointer } from "./pointer-selectors";

export function PointerAuditPanel({ audit }: { audit: Array<{ x: number; y: number }> }) {
  const pointer = selectPointer();
  React.useEffect(() => {
    audit.push(pointer.value);
  }, [audit, pointer]);
  return null;
}
```

### 9. Prefer actions or sagas when every event matters

```ts
import { call, takeEvery } from "typed-redux-saga";
import { pointerMoved } from "./pointer-slice";

declare const auditLog: { write(event: string, payload: unknown): Promise<void> };

export function* pointerAuditSaga() {
  yield* takeEvery(pointerMoved, function* auditPointerMove(action) {
    yield* call(auditLog.write, "pointer-moved", action.payload[0]);
  });
}
```

## Cases covered

| Case | Examples |
| --- | --- |
| ReactStore-owned scheduler configuration | 1 |
| Store-bound selector definitions and composition | 2 |
| Direct `ReadonlySignal<R>` outputs | 3 |
| Component/custom-hook direct signal reads, with `.useValue(...args)` fallback | 4 |
| Handler/test one-shot reads | 5 |
| Saga read mode that bypasses React render scheduling | 6 |
| Manual debounce/wrapper misuse | 7 |
| Audit/event-log misuse and replacement | 8, 9 |

## See also

- `react/selectors` — building `ReactStore` selectors.
- `react/selector-lifecycle` — choosing direct signal, `.useValue`, `.select`, `.effect`, and `.withStore` call modes.
- `@augmentcode/themis/docs/SELECTORS.md` — selector memoization and lifecycle rules.