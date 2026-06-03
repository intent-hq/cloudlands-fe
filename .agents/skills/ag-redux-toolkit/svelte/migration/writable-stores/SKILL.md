---
name: svelte/migration/writable-stores
description: >-
  Convert writable() stores and $state runes into slice initial state plus
  createAction + createReducer with immutable updates. Covers set / update
  conversion, non-serializable value rules, and mutation pitfalls.
type: sub-skill
requires:
  - core/actions
  - core/reducers
  - svelte/migration
triggers:
  - migrate writable
  - migrate $state
  - writable to slice
  - convert setter
---
# Migration — `writable` / `$state` → Slice + Actions + Reducer

> Converts the mutable state primitives (Svelte 4 `writable` / `readable` and
> Svelte 5 `$state`) into an `initialState` + `createAction` + `createReducer`
> trio. For selector conversion see
> `../derived-stores/SKILL.md`.

## State: `writable` / `$state` → Initial State

```typescript
// BEFORE: Svelte store
import { writable } from "svelte/store";
export const count = writable(0);
export const username = writable("");

// ─── OR with Svelte 5 runes ───
declare function $state<T>(value: T): T;
let runeCount = $state(0);
let runeUsername = $state("");

// AFTER: Redux slice
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";

type CounterState = {
  count: number;
  username: string;
};

const initialState: CounterState = {
  count: 0,
  username: "",
};

export const setCount = createAction<[value: number]>("counter/setCount");
export const setUsername = createAction<[value: string]>("counter/setUsername");

export const counterReducer = createReducer<CounterState>(initialState)
  .with(setCount, (state, { payload: [value] }) => ({ ...state, count: value }))
  .with(setUsername, (state, { payload: [value] }) => ({ ...state, username: value }));
```

## State Updates: `store.set` / `store.update` → `dispatch(action())`

```typescript
// BEFORE: Svelte store
declare const count: { set(value: number): void; update(fn: (value: number) => number): void };
count.set(42);
count.update((n) => n + 1);

// ─── OR with Svelte 5 runes ───
let runeCount = 0;
runeCount = 42;
runeCount += 1;

// AFTER: Redux
// In the slice, define the actions:
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";

type CounterState = { count: number };
const initialState: CounterState = { count: 0 };

export const setCount = createAction<[value: number]>("counter/setCount");
export const increment = createAction("counter/increment");

export const counterReducer = createReducer<CounterState>(initialState)
  .with(setCount, (state, { payload: [value] }) => ({ ...state, count: value }))
  .with(increment, (state) => ({ ...state, count: state.count + 1 }));

// In the component:
declare const dispatch: (action: ReturnType<typeof setCount> | ReturnType<typeof increment>) => void;
dispatch(setCount(42));
dispatch(increment());
```

## Additional Migration Examples

### `$state` object → serializable slice state

```typescript
// migration/preferences-state.before.svelte.ts
declare function $state<T>(value: T): T;

export const preferences = $state({
  theme: "dark" as "light" | "dark",
  sidebarOpen: true,
});
```

```typescript
// src/lib/store/slices/preferences/preferences-slice.ts
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";

type PreferencesState = { theme: "light" | "dark"; sidebarOpen: boolean };
const initialState: PreferencesState = { theme: "dark", sidebarOpen: true };

export const setTheme = createAction<[theme: PreferencesState["theme"]]>("preferences/setTheme");
export const setSidebarOpen = createAction<[open: boolean]>("preferences/setSidebarOpen");

export const preferencesReducer = createReducer<PreferencesState>(initialState)
  .with(setTheme, (state, { payload: [theme] }) => ({ ...state, theme }))
  .with(setSidebarOpen, (state, { payload: [sidebarOpen] }) => ({ ...state, sidebarOpen }));
```

### Array writable → `Collection` when lookup by id becomes important

```typescript
// src/lib/store/slices/todos/todos-slice.ts
import { createCollection, upsertItem, type Collection } from "ag-redux-toolkit/utils/collections/collection-utils";
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";

type Todo = { id: string; title: string; completed: boolean };
type TodosState = { items: Collection<Todo, "id"> };

const initialState: TodosState = { items: createCollection<Todo, "id">("id") };
export const todoReceived = createAction<[todo: Todo]>("todos/todoReceived");

export const todosReducer = createReducer<TodosState>(initialState).with(
  todoReceived,
  (state, { payload: [todo] }) => ({ ...state, items: upsertItem(state.items, todo) })
);
```

### ❌ Bad: non-serializable state copied from a Svelte store

```typescript
// ❌ BAD: Date and Map make persistence/hydration and equality checks unreliable.
type BadState = {
  lastSyncedAt: Date;
  selectedById: Map<string, boolean>;
};

type GoodState = {
  lastSyncedAtMs: number | null;
  selectedById: Record<string, boolean>;
};

export const badInitialState: BadState = {
  lastSyncedAt: new Date(),
  selectedById: new Map<string, boolean>(),
};

export const goodInitialState: GoodState = {
  lastSyncedAtMs: null,
  selectedById: {},
};
```

### ❌ Bad: no-op update returns a fresh object and invalidates selectors

```typescript
// ❌ BAD: unchanged values should preserve the incoming state reference.
type CounterState = { count: number };
type CountAction = { payload: [number] };

export function badSetCount(state: CounterState, { payload: [count] }: CountAction) {
  return { ...state, count };
}

export function goodSetCount(state: CounterState, { payload: [count] }: CountAction) {
  if (state.count === count) return state;
  return { ...state, count };
}
```

## Common Pitfalls

### ❌ Don't store non-serializable values

Redux state must be JSON-serializable:

| ❌ Don't Store | ✅ Store Instead |
| --- | --- |
| Date | number (timestamp) or ISO string |
| Map<K,V> | Record<string, V> |
| Set<T> | T[] or Record<string, true> |
| RegExp | string (pattern) |
| Class instances | Plain objects { ... } |
| Functions | Action type strings |
| Promises | Handle in sagas |

### ❌ Don't mutate state in reducers

Always return new objects:

```typescript
// ❌ BAD: mutates the existing array and returns the same object.
type Item = { id: string; label: string };
type ItemsState = { items: Item[] };
type AddItemAction = { payload: [Item] };

export function badAddItem(state: ItemsState, { payload: [item] }: AddItemAction) {
  state.items.push(item);
  return state;
}

export function goodAddItem(state: ItemsState, { payload: [item] }: AddItemAction) {
  return {
    ...state,
    items: [...state.items, item],
  };
}
```

### ❌ Don't put side effects in reducers

Reducers must be pure functions. No `fetch`, no `localStorage`, no `console.log`, no `Date.now()`:

```typescript
// ❌ BAD: reducer persistence makes replay/cancellation behavior nondeterministic.
type Settings = { theme: "light" | "dark" };
type SettingsState = { settings: Settings };
type SaveSettingsAction = { payload: [Settings] };

export function badSaveSettings(state: SettingsState, { payload: [settings] }: SaveSettingsAction) {
  localStorage.setItem("settings", JSON.stringify(settings));
  return { ...state, settings };
}

export function goodSaveSettings(state: SettingsState, { payload: [settings] }: SaveSettingsAction) {
  return { ...state, settings };
}
```

Move the effect into a saga — see
`../side-effects/SKILL.md`.

## Cross-References

- `../../../core/actions/SKILL.md` — full `createAction` surface
- `../../../core/reducers/SKILL.md` — full `createReducer` surface (no-op reference-equality)
- `../../../core/state-serialization/SKILL.md` — serializable state rules

