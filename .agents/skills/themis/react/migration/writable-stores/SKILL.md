---
name: react/migration/writable-stores
description: >-
  Convert shared mutable React state to actions and reducers. React sources
  include useState/useReducer, context providers, custom hooks, or external
  mutable stores.
type: sub-skill
requires:
  - core/actions
  - core/reducers
  - react/migration
triggers:
  - migrate React local state
  - useState to slice
  - context state to reducer
---
# React mutable state migration

Shared mutable React state maps to serializable slice state, action creators, andpure reducers. Keep component-local ephemeral UI state in React.

React source patterns include `useState`, `useReducer`, context provider state,
custom hook state, and external mutable stores.

## Before: shared React context state

```tsx
import * as React from "react";

type CounterContextValue = { count: number; increment(): void; setUsername(name: string): void };
export const CounterContext = React.createContext<CounterContextValue | null>(null);

export function CounterProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0);
  const [username, setUsername] = React.useState("");
  const increment = () => setCount((value) => value + 1);
  return <CounterContext.Provider value={{ count, increment, setUsername }}>{children}</CounterContext.Provider>;
}
```

## After: slice state, actions, reducer

```ts
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type CounterState = { count: number; username: string };
const initialState: CounterState = { count: 0, username: "" };

export const setCount = createAction<[value: number]>("counter/setCount");
export const increment = createAction("counter/increment");
export const setUsername = createAction<[value: string]>("counter/setUsername");

export const counterReducer = createReducer<CounterState>(initialState)
  .with(setCount, (state, { payload: [count] }) => count === state.count ? state : { ...state, count })
  .with(increment, (state) => ({ ...state, count: state.count + 1 }))
  .with(setUsername, (state, { payload: [username] }) => ({ ...state, username }));
```

## Rules

- Move shared, persisted, async-driven, or business state into slice state.
- Keep reducers pure: no `fetch`, `localStorage`, timers, clocks, random IDs, ormutation.
- Keep state serializable: no `Date`, `Map`, `Set`, class instances, functions,promises, or DOM objects.
- Compute new state in reducers; React components dispatch action creators.
- Preserve reference equality on no-op updates when practical to avoid needlessselector invalidation.

## Component-local state remains local

```tsx
import * as React from "react";

export function ProductCard() {
  const [isHovered, setHovered] = React.useState(false);
  return <article onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} />;
}
```

## Bad: reducer side effect

```ts
// BAD: reducers must not persist or read external systems.
export function badSaveSettings(state: { theme: string }, action: { payload: [string] }) {
  localStorage.setItem("theme", action.payload[0]);
  return { ...state, theme: action.payload[0] };
}
```

Move the persistence into `react/migration/side-effects` saga guidance.

## Cross-references

- `../../../core/actions/SKILL.md` — action creators.
- `../../../core/reducers/SKILL.md` — reducer patterns.
- `../../../core/state-serialization/SKILL.md` — serializable state rules.