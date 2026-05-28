# File Structure, Registration, and Utilities

## 9. File Structure & Registration

### Slice directory layout

```
src/lib/store/slices/{slice-name}/
  {slice-name}-types.ts          # Types, interfaces, enums (safe to import from any process)
  {slice-name}-slice.ts          # Actions, reducer (imports types from -types.ts)
  {slice-name}-selectors.ts      # Selectors
  {slice-name}-slice.test.ts     # Reducer tests
  sagas/
    {slice-name}-saga.ts         # Saga logic
    {slice-name}-saga.test.ts    # Saga tests
```

### Saga-only slices

Some slices exist only to define saga trigger actions with **no meaningful state**. For these, keep the action creators and saga but **do not register a reducer** in `src/lib/store/reducer.ts`. Examples: `auth`, `auto-update`, `ui-notifications`, `app-layout`.

### Registration steps

**1. Register reducer** in `src/lib/store/reducer.ts` (skip for saga-only slices):

```typescript
import { mySliceReducer } from './slices/my-slice/my-slice-slice';
export const reducers = { /* ...existing */ mySlice: mySliceReducer } as const;
```

**2. Register saga** in `src/lib/store/sagas.ts`:

```typescript
import { mySliceSaga } from './slices/my-slice/sagas/my-slice-saga';
export const sagas = { /* ...existing */ mySliceSaga } as const;
```

**3. Start saga** via `<RunSaga>` in appropriate layout:

```svelte
<script>
  import RunSaga from '$lib/store/components/RunSaga.svelte';
</script>

<RunSaga sagaName="mySliceSaga" />
```

### Naming conventions

- **Type definitions:** `{slice-name}-types.ts` (e.g., `notifications-types.ts`) — all types, interfaces, enums
- **State type:** `{Feature}State` (e.g., `NotificationsState`) — defined in `-types.ts`
- **Reducer:** `{feature}Reducer` (e.g., `notificationsReducer`)
- **Actions:** verb phrases (e.g., `addNotification`, `fetchItems`)
- **Selectors:** `select` prefix (e.g., `selectNotifications`, `selectIsLoading`)
- **Action types:** `"sliceName/actionName"` (e.g., `"notifications/addNotification"`)

## 10. Workspace-Scoped State

For state keyed by workspace ID, use `createWorkspaceScopedHelpers`:

```typescript
import { createWorkspaceScopedHelpers } from "$lib/store/utils/workspace-scoped";

const emptyState: MyWorkspaceState = { items: createCollection<Item, "id">("id") };
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyState);

// State shape: { byWorkspaceId: Record<string, MyWorkspaceState> }

// In reducer:
.with(setItems, (state, { payload: [wsId, items] }) =>
  setWorkspaceState(state, wsId, { ...getWorkspaceState(state, wsId), items })
)
.with(clearWorkspace, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
```

## 11. Boolean Preference Utility

For boolean preference fields, use `createBooleanPreference` instead of hand-writing `setX` / `toggleX` pairs:

```typescript
import { createBooleanPreference } from '$lib/store/utils/boolean-preference';

const spellcheck = createBooleanPreference<MyState>({
  sliceName: 'userPrefs',
  field: 'spellcheckEnabled',
  setActionName: 'setSpellcheck',
  toggleActionName: 'toggleSpellcheck',
});
export const setSpellcheck = spellcheck.setAction;
export const toggleSpellcheck = spellcheck.toggleAction;

// Chain register() on the reducer builder:
export const myReducer = spellcheck.register(
  createReducer<MyState>(initialState),
  // ... other .with() handlers
);
```
