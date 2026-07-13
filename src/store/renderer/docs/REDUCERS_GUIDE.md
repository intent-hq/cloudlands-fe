# Redux Reducers Guide

This project guide is a concise companion to the Redux skills. The active reducer rules live in:

- `.agents/skills/ag-redux-toolkit/core/reducers/SKILL.md`
- `.agents/skills/ag-redux-toolkit/core/state-serialization/SKILL.md`
- `.agents/skills/ag-redux-toolkit/core/collections/SKILL.md`

Use those skills for API details and implementation examples. Keep this file focused on Intent-app conventions.

## Project conventions

- Put stateful slice reducers in `src/store/renderer/slices/<domain>/<domain>-slice.ts`.
- Register stateful reducers in `src/store/renderer/reducer.ts`; saga-only slices do not need empty reducer entries.
- Use `createAction` and `createReducer` from `ag-redux-toolkit/utils/store/*`.
- Use collection helpers from `ag-redux-toolkit/utils/collections/collection-utils` for normalized entity state.
- Keep Redux state JSON-serializable: no `Date`, `Map`, `Set`, class instances, functions, DOM objects, promises, or runtime handles.
- Keep reducer state canonical. Derived values, sorted views, counts, and display labels belong in selectors.

## Reducer checklist

- Reducer handlers are pure and synchronous.
- They return a new parent object only when state actually changes.
- They preserve the incoming state reference for no-op actions.
- They never mutate collection internals or nested state.
- They never call side-effect APIs, including storage, IPC, timers, network calls, logging, random IDs, or current-time helpers.
- Generated values are prepared before dispatch or in sagas, then passed through actions.

## Current import pattern

```typescript
import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import { addItem, createCollection } from "ag-redux-toolkit/utils/collections/collection-utils";
```

## Tests

Each stateful slice should keep a colocated `*-slice.test.ts` covering:

- initial state;
- every reducer handler;
- important edge cases;
- unknown actions and explicit no-op reference equality.

## See also

- [Selectors Guide](./SELECTORS_GUIDE.md) for derived values and one-time reads.
- [Migration Guide](./MIGRATION_GUIDE.md) for converting Svelte stores into slices.
- `src/store/renderer/AGENTS.md` for project-local Redux boundaries.
