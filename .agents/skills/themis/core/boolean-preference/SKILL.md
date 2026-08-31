---
name: core/boolean-preference
description: >-
  createBooleanPreference({ sliceName, field, setActionName, toggleActionName })
  emits a setAction (payload [value: boolean]) and a zero-argument toggleAction,
  plus a .register(builder) helper that chains both handlers onto a createReducer
  builder. The field parameter is constrained to keys whose value type is
  boolean. Use it instead of hand-writing setX / toggleX pairs. Public API:
  @augmentcode/themis/utils/store/boolean-preference; related guidance: ../SKILL.md §11.
type: sub-skill
library: themis
requires:
  - core
  - core/reducers
sources:
  - "@augmentcode/themis/utils/store/boolean-preference"
  - ../SKILL.md
triggers:
  - boolean preference
  - toggle action
  - setAction toggleAction
  - register builder
---
# Boolean Preference — `createBooleanPreference`

> Helper for boolean preference fields. It emits a consistent set/toggle action pair and wires both reducer cases through .register(builder). Use it instead of hand-rolled setX / toggleX boilerplate so the actions stay namespaced and in lock-step.

## 1. API

From `@augmentcode/themis/utils/store/boolean-preference`:

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
  setAction: StoreActionCreator<[value: boolean]>;
  toggleAction: StoreActionCreator<[]>;
  register(builder: BooleanPreferenceReducerBuilder<S>):
    BooleanPreferenceReducerBuilder<S>;
};
```

- `field` is constrained at the type level to keys whose value type is `boolean`. TypeScript refuses any field whose value is not strictly `boolean`.
- `setAction` has type `(value: boolean) => StoreAction<[boolean]>`. Its dispatched payload is the tuple `[value]`.
- `toggleAction` takes no arguments and flips the current value.
- Both action **types** are namespaced: `${sliceName}/${setActionName}` and `${sliceName}/${toggleActionName}`.

The generated handlers produce:

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { enabled: boolean; label: string };
const initialState: SettingsState = { enabled: false, label: "beta" };
const preference = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "enabled", setActionName: "setEnabled", toggleActionName: "toggleEnabled",
});
const reducer = preference.register(createReducer(initialState));

reducer(initialState, preference.setAction(true)); // { enabled: true, label: "beta" }
reducer(initialState, preference.toggleAction()); // { enabled: true, label: "beta" }
```

The helper handlers return immutable state updates. `createReducer` shallow-compares the result, so a shallow-equal no-op such as `setAction(true)` on an already-enabled field preserves the incoming state reference.

## 2. Setup — minimum working slice

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { enabled: boolean; label: string };
const initialState: SettingsState = { enabled: false, label: "beta" };
```

```typescript
const enabledPreference = createBooleanPreference<SettingsState>({
  sliceName: "settings",
  field: "enabled",
  setActionName: "setEnabled",
  toggleActionName: "toggleEnabled",
});

export const settingsReducer = enabledPreference.register(createReducer(initialState));
export const { setAction: setEnabled, toggleAction: toggleEnabled } = enabledPreference;
```

Dispatch like any other action:

```typescript
store.dispatch(setEnabled(true));
store.dispatch(toggleEnabled());
```

## 3. Core patterns

### 3.1 Destructuring export

If you only need the two actions, destructure them from the preference object:

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { enabled: boolean };
const initialState: SettingsState = { enabled: false };
const enabledPreference = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "enabled", setActionName: "setEnabled", toggleActionName: "toggleEnabled",
});

export const { setAction: setEnabled, toggleAction: toggleEnabled } = enabledPreference;
export const settingsReducer = enabledPreference.register(createReducer(initialState));
```

### 3.2 Chaining multiple preferences

Each `.register(builder)` returns the same builder with two cases added, so you can compose any number of preferences:

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { darkMode: boolean; compactMode: boolean };
const initialState: SettingsState = { darkMode: false, compactMode: false };
const darkMode = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "darkMode", setActionName: "setDarkMode", toggleActionName: "toggleDarkMode",
});
const compactMode = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "compactMode", setActionName: "setCompactMode", toggleActionName: "toggleCompactMode",
});

export const settingsReducer = darkMode.register(
  compactMode.register(createReducer(initialState))
);
```

`.register` preserves the reducer's `initialState` field, so stores and tests can access `settingsReducer.initialState`.

### 3.3 Persistence saga

Pair the action with an app-local safe-storage helper, following `core/local-storage`, to persist the flag:

```typescript
import { call, takeEvery } from "typed-redux-saga";
import { setLocalStorageItem } from "../utils/safe-local-storage-saga";
import { setEnabled, toggleEnabled } from "./settings-actions";
import { selectEnabled } from "./settings-selectors";

const ENABLED_KEY = "settings/enabled";

function* persistEnabled() {
  const enabled = yield* selectEnabled.effect();
  yield* call(setLocalStorageItem, ENABLED_KEY, JSON.stringify(enabled));
}

export function* settingsPersistenceSaga() {
  yield* takeEvery([setEnabled, toggleEnabled], persistEnabled);
}
```

## 4. Common Mistakes

### Writing `setX` and `toggleX` by hand

**Mechanism:** hand-rolled pairs drift — `toggle` may use `!state.field` while `set` uses the payload, and tests have to cover both independently. The helper makes them consistent and namespaces the action types automatically.

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { enabled: boolean };
const initialState: SettingsState = { enabled: false };

// GOOD: one factory owns both actions and both reducer cases.
const enabled = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "enabled", setActionName: "setEnabled", toggleActionName: "toggleEnabled",
});
export const reducer = enabled.register(createReducer(initialState));
```

Source: `../SKILL.md §11`.

### Forgetting to call `.register` on the reducer builder

**Mechanism:** the action creators exist, but no reducer case handles them. Dispatch then becomes a silent no-op and the preference never changes.

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

type SettingsState = { enabled: boolean };
const initialState: SettingsState = { enabled: false };
const enabled = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "enabled", setActionName: "setEnabled", toggleActionName: "toggleEnabled",
});

const reducerWithoutHandlers = createReducer(initialState);
reducerWithoutHandlers(undefined, enabled.setAction(true)); // still { enabled: false }

// GOOD: register both generated handlers before giving the reducer to the Store.
const reducer = enabled.register(createReducer(initialState));
reducer(undefined, enabled.setAction(true)); // { enabled: true }
```

Source: `../SKILL.md §11`.

### Pointing `field` at a non-boolean key

**Mechanism:** TypeScript refuses this at compile time because `field` is constrained to `BooleanFieldKey<S>`. Do not widen the type with `as any`: the runtime handler writes a boolean to the selected property, which can corrupt a non-boolean field.

```typescript
import { createBooleanPreference } from "@augmentcode/themis/utils/store/boolean-preference";

type SettingsState = { enabled: boolean; label: string };

// @ts-expect-error: "label" is not a BooleanFieldKey<SettingsState>.
createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "label", setActionName: "setLabel", toggleActionName: "toggleLabel",
});

const validPreference = createBooleanPreference<SettingsState>({
  sliceName: "settings", field: "enabled", setActionName: "setEnabled", toggleActionName: "toggleEnabled",
});
```

Public API: `@augmentcode/themis/utils/store/boolean-preference` (`BooleanFieldKey<S>` constraint).

## 5. See also

- `core/reducers` — `createReducer` builder and the `same-reference on no-op` rule.
- `core/actions` — `createAction<[Params]>` tuple payloads.
- `core/local-storage` — persistence saga for preference fields.