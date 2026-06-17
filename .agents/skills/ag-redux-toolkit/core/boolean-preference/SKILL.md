---
name: core/boolean-preference
description: >-
  createBooleanPreference({ sliceName, field, setActionName, toggleActionName })
  emits a setAction (payload [value: boolean]) and a zero-argument toggleAction
  plus a .register(builder) helper that chains both handlers onto a createReducer
  builder. The field parameter is constrained to keys whose value type is
  boolean. Use it instead of hand-writing setX / toggleX pairs. Public API:
  @augmentcode/ag-redux-toolkit/utils/store/boolean-preference; related guidance: ../SKILL.md §11.
type: sub-skill
library: ag-redux-toolkit
requires:
  - core
  - core/reducers
sources:
  - "@augmentcode/ag-redux-toolkit/utils/store/boolean-preference"
  - ../SKILL.md
triggers:
  - boolean preference
  - toggle action
  - setAction toggleAction
  - register builder
---
# Boolean Preference — `createBooleanPreference`

> Helper for boolean preference fields. Emits a consistent set/toggle action
> pair and wires both reducer cases via `.register(builder)`. Replaces
> hand-rolled `setX` / `toggleX` boilerplate and keeps the two actions in
> lock-step so tests don't have to cover drift.

## 1. API

From `@augmentcode/ag-redux-toolkit/utils/store/boolean-preference`:

```typescript
type BooleanFieldKey<S> = {
  [K in keyof S]-?: S[K] extends boolean ? K : never;
}[keyof S] & string;

type CreateBooleanPreferenceOptions<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
> = {
  sliceName: string;
  field: Field;
  setActionName: string;
  toggleActionName: string;
};

export function createBooleanPreference<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
>(options: CreateBooleanPreferenceOptions<S, Field>): {
  setAction:    StoreActionCreator<[value: boolean]>;
  toggleAction: StoreActionCreator<[]>;
  register(builder: BooleanPreferenceReducerBuilder<S>):
                   BooleanPreferenceReducerBuilder<S>;
};
```

- `field` is constrained at the type level to keys whose value type is
  `boolean`. TypeScript refuses any field whose value isn't strictly
  `boolean`.
- `setAction` has type `(value: boolean) => StoreAction<[boolean]>`.
  Dispatched payload is the tuple `[value]`.
- `toggleAction` takes no args and flips the current value.
- Both action **types** are namespaced: `` `${sliceName}/${setActionName}` ``
  and `` `${sliceName}/${toggleActionName}` ``.

The generated handlers produce:

```typescript
// setAction handler
(state, { payload: [value] }) => ({ ...state, [field]: value });
// toggleAction handler
(state) =>                     ({ ...state, [field]: !state[field] });
```

Neither handler short-circuits on identity — dispatching `setAction(true)`
when the field is already `true` still produces a new `state` reference.

## 2. Setup — minimum working slice

```typescript
// prefs-types.ts
export type PrefsState = {
  spellcheckEnabled: boolean;
  darkMode: boolean;
  lastSavedAt: number;
};
```

```typescript
// prefs-slice.ts
import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";
import { createBooleanPreference } from "@augmentcode/ag-redux-toolkit/utils/store/boolean-preference";
import type { PrefsState } from "./prefs-types";

const initialState: PrefsState = {
  spellcheckEnabled: true,
  darkMode: false,
  lastSavedAt: 0,
};

const spellcheck = createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "spellcheckEnabled",
  setActionName: "setSpellcheck",
  toggleActionName: "toggleSpellcheck",
});

const darkMode = createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "darkMode",
  setActionName: "setDarkMode",
  toggleActionName: "toggleDarkMode",
});

// Export the action creators under the names callers will use.
export const setSpellcheck    = spellcheck.setAction;
export const toggleSpellcheck = spellcheck.toggleAction;
export const setDarkMode      = darkMode.setAction;
export const toggleDarkMode   = darkMode.toggleAction;

// Chain .register() on the reducer builder — both cases are added.
export const prefsReducer = darkMode.register(
  spellcheck.register(
    createReducer<PrefsState>(initialState)
      // ... other .with() cases, e.g. .with(savedAt, ...)
  )
).build();
```

Dispatch like any other action:

```typescript
dispatch(setSpellcheck(false));
dispatch(toggleDarkMode());
```

## 3. Core patterns

### 3.1 Destructuring export

If you only need the two actions, destructure inline:

```typescript
const prefs = createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "spellcheckEnabled",
  setActionName: "setSpellcheck",
  toggleActionName: "toggleSpellcheck",
});
export const { setAction: setSpellcheck, toggleAction: toggleSpellcheck } = prefs;
export const prefsReducer = prefs.register(createReducer<PrefsState>(initialState)).build();
```

### 3.2 Chaining multiple preferences

Each `.register(builder)` returns the same builder with two cases added, so
you can chain any number of preferences:

```typescript
export const prefsReducer = a.register(b.register(c.register(
  createReducer<PrefsState>(initialState).with(resetAll, () => initialState)
))).build();
```

`.register` preserves the `initialState` field on the returned builder so
`createReducer` / tests can access it via `reducer.initialState`.

### 3.3 Persistence saga

Pair with an app-local helper following `core/local-storage` to persist the flag:

```typescript
function* persistSpellcheck() {
  yield* takeEvery([setSpellcheck, toggleSpellcheck], function* () {
    const current = yield* selectSpellcheck.effect();
    yield* call(setLocalStorageItem, "prefs:spellcheck", String(current));
  });
}
```

## 4. Common Mistakes

### Writing `setX` and `toggleX` by hand

**Mechanism:** hand-rolled pairs drift — `toggle` may end up using
`!state.field` while `set` uses the payload, and tests have to cover both
independently. The helper makes them consistent and namespaces the action
types automatically.

```typescript
// ❌ WRONG
export const setSpellcheck    = createAction<[boolean]>("prefs/setSpellcheck");
export const toggleSpellcheck = createAction("prefs/toggleSpellcheck");
// two hand-rolled reducer cases...

// ✅ CORRECT
const spellcheck = createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "spellcheckEnabled",
  setActionName: "setSpellcheck",
  toggleActionName: "toggleSpellcheck",
});
export const { setAction: setSpellcheck, toggleAction: toggleSpellcheck } = spellcheck;
export const prefsReducer = spellcheck.register(createReducer<PrefsState>(initialState));
```

*Source: `../SKILL.md §11`.*

### Forgetting to chain `.register` on the reducer builder

**Mechanism:** the action creators exist but no reducer case handles them;
dispatch becomes a silent no-op and the preference never changes.

```typescript
// ❌ WRONG — no .register call
export const prefsReducer = createReducer<PrefsState>(initialState)
  .with(otherAction, ...);

// ✅ CORRECT
export const prefsReducer = spellcheck.register(
  createReducer<PrefsState>(initialState).with(otherAction, ...)
);
```

*Source: `../SKILL.md §11`.*

### Pointing `field` at a non-boolean key

**Mechanism:** TypeScript refuses this at compile time because `field` is
constrained to `BooleanFieldKey<S>`, but agents sometimes widen the type
with `as any` or omit the generic. The runtime handler still writes a
boolean into a non-boolean field, corrupting state.

```typescript
// ❌ WRONG — `lastSavedAt` is a number
createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "lastSavedAt" as any,
  setActionName: "setSavedAt",
  toggleActionName: "toggleSavedAt",
});

// ✅ CORRECT — pick a real boolean field
createBooleanPreference<PrefsState>({
  sliceName: "prefs",
  field: "darkMode",
  setActionName: "setDarkMode",
  toggleActionName: "toggleDarkMode",
});
```

*Public API: `@augmentcode/ag-redux-toolkit/utils/store/boolean-preference` (`BooleanFieldKey<S>` constraint).*

## 5. See also

- `core/reducers` — `createReducer` builder and the
  `same-reference on no-op` rule.
- `core/actions` — `createAction<[Params]>` tuple payloads.
- `core/local-storage` — persistence saga for preference fields.

