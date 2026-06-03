---
name: svelte/selector-scheduling
description: >-
  Public guidance for Store-owned selector emission coalescing and optional FPS
  tuning. Selector scheduler helpers are internal details and must not be
  imported from any public subpackage. Use Store-bound selectors directly;
  their readables are already scheduled by package internals.
type: sub-skill
requires:
  - svelte
  - svelte/selectors
triggers:
  - throttled readable
  - rAF coalescing
  - selector scheduler
---
# Selector emission scheduling — internal only

> Selector scheduler helpers are implementation details. Do not import them from package subpaths or teach consumers to wrap selector readables manually.

Public facade: `ag-redux-toolkit/svelte-store` (`store.createSelector` and `Store` selector options). Selector implementation and scheduler internals are package-private; see `docs/SELECTORS.md` for behavior.

## Store-first rule

- Create app selectors with the configured `Store` instance: `store.createSelector(...)`.
- Tune Svelte-readable selector coalescing only through the final constructor options argument: `new Store(reducers, middleware, { throttledSelectorFrequency })`.
- Treat this as Svelte Store family scheduling only. Do not use StreamingStore,
  Kefir stream throttling, or streaming selector lifecycle/setup guidance in the
  same app.
- Omit `throttledSelectorFrequency` for the default `64` FPS; explicit values must be finite numbers in the inclusive `1..256` range. Fractional values are supported.
- In components, call selector readables directly at component init: `const value$ = selectValue()`.
- Let the package's selector internals schedule/coalesce readable emissions.
- For one-shot reads, use `selectValue.select(store.state, ...args)`.
- For sagas, use `yield* selectValue.effect(...args)`.
- For explicit non-context binding, use `selectValue.withStore(store)(...args)` after `store.init()`.

## Do not

- Do not import selector scheduler internals from app code.
- Do not wrap selector readables in a second debounce, timer, `requestAnimationFrame`, or writable proxy just to reduce UI updates.
- Do not rely on selector readables as audit/event streams; they represent the latest derived state and may coalesce intermediate writes.
- Do not call selector readable mode from event handlers, callbacks, async functions, services, or tests; use `.select(store.state, ...)` or `.withStore(store)`.
- Do not replace this Svelte-readable scheduling model with StreamingStore/Kefir
  selector setup in the same app.

## Examples

### 1. Define selectors through the configured Store

```ts
import { store } from "$lib/store";

type Pointer = { x: number; y: number };

export const selectPointer = store.createSelector((state): Pointer => {
  return state.pointer.current;
});

export const selectPointerLabel = store.createSelector((state) => {
  const pointer = selectPointer.select(state);
  return `${pointer.x},${pointer.y}`;
});
```

### 2. Component init reads the already-scheduled selector readable directly

```ts
import { onDestroy } from "svelte";
import { selectPointer, selectPointerLabel } from "./pointer-selectors";

declare function renderPointer(value: { x: number; y: number }): void;

export const pointer = selectPointer();
export const pointerLabel = selectPointerLabel();

const unsubscribe = pointer.subscribe((value) => renderPointer(value));
onDestroy(unsubscribe);
```

### 3. Event handlers use `.select(store.state)` for one-shot reads

```ts
import { store } from "$lib/store";
import { selectPointer } from "./pointer-selectors";
import { copyPointer } from "./pointer-slice";

export function handleCopyPointer() {
  const pointer = selectPointer.select(store.state);
  store.dispatch(copyPointer(pointer));
}
```

### 4. Bind to an explicit initialized Store with `.withStore`

```ts
import type { Store } from "ag-redux-toolkit/svelte-store";
import { selectPointer } from "./pointer-selectors";

export function createPointerReadable(store: Store) {
  return selectPointer.withStore(store)();
}
```

### 5. Saga code uses `.effect()` rather than readable scheduling

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

### 6. ❌ Bad: wrapping selector readables in another timer layer

```ts
// BAD: this compiles but adds stale updates on top of Store-owned scheduling.
import { writable, type Readable } from "svelte/store";
import { selectPointer } from "./pointer-selectors";

type Pointer = { x: number; y: number };

export function createManuallyDebouncedPointer(): Readable<Pointer> {
  const output = writable<Pointer>({ x: 0, y: 0 });
  selectPointer().subscribe((value) => setTimeout(() => output.set(value), 100));
  return output;
}
```

### 7. ❌ Bad: treating selector readables as event logs

```ts
// BAD: selector readables represent latest state and may coalesce intermediate writes.
import { selectPointer } from "./pointer-selectors";

type Pointer = { x: number; y: number };

export function recordEveryPointerMove(audit: Pointer[]) {
  const unsubscribe = selectPointer().subscribe((pointer) => audit.push(pointer));
  return unsubscribe;
}
```

### 8. Prefer action or saga evidence when every event matters

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

### Examples retained/added

| # | Example | Kind |
| ---: | --- | --- |
| 1 | Store-bound selector definitions | Good |
| 2 | Component-init readable subscription and cleanup | Good |
| 3 | One-shot handler read with `.select(store.state)` | Good |
| 4 | Explicit Store binding with `.withStore(store)` | Good |
| 5 | Saga state read with `.effect()` | Good |
| 6 | Manual debounce/timer wrapper around selector readable | Bad |
| 7 | Selector readable used as an event/audit stream | Bad |
| 8 | Action-driven saga audit replacement | Good |

### Cases covered

| Case | Examples |
| --- | --- |
| Store-owned selector scheduling and current public API | 1, 2 |
| Component lifecycle and cleanup | 2 |
| Handler/service one-shot reads | 3 |
| Explicit Store compatibility binding | 4 |
| Saga read mode that bypasses readable scheduling | 5 |
| Realistic scheduling misuse not caught by missing imports | 6, 7, 8 |

## See also

- `svelte/selectors` — building Store-bound selectors.
- `docs/SELECTORS.md` — selector memoization and lifecycle rules.
