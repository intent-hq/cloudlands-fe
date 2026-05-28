# Core Policy and Boundaries

# Redux Store — Agent Skill

> This codebase uses a CUSTOM Redux setup — NOT Redux Toolkit (RTK). Do not use createSlice, configureStore, createAsyncThunk, or any RTK APIs. Use only the custom utilities documented below.

## 1. Core Policy

- **Redux for ALL shared/domain state.** Svelte stores (`*.store.svelte.ts`) are **DEPRECATED** — never create new ones.
- **Components render; Redux owns state.** Components read via selectors, dispatch actions. Business logic goes in reducers + sagas.
- **Side effects in sagas, not components.** API calls, IPC, localStorage, timers, event listeners → sagas. Use `$effect` only for DOM-local work (focus, scroll, measurements).
- **State must be serializable.** No `Date`, `Map`, `Set`, `RegExp`, `Promise`, `Function`, class instances, `Symbol`. Use plain objects, arrays, strings, numbers, booleans, `null`, `undefined`.
- **Arrays hold primitives only.** For entity/object storage, always use `Collection<T, K>`. Never store `Item[]` in state — use Collections for O(1) lookups and normalized data.
- **Svelte store migration on contact.** If you encounter `.store.svelte.ts`, do not expand it — migrate to Redux per the [Migration Guide](src/lib/store/docs/MIGRATION_GUIDE.md).
- **Types in separate modules.** Define all slice types/interfaces in `{slice-name}-types.ts`, not in `-slice.ts`. This allows safe cross-process imports — importing `-slice.ts` for types pulls in renderer-only dependencies and breaks main-process builds.
- **Main-process Redux store coming soon.** Currently Redux is renderer-only.

## 2. Import Boundaries

Components (`*.svelte`, component-level `*.ts`) may **only** import these from the store:

- ✅ Actions from `*-slice.ts`
- ✅ Selectors from `*-selectors.ts`
- ✅ Types from `*-types.ts`
- ✅ `getDispatch` from `$lib/store/utils/svelte-context`
- ✅ `getReduxStore` from `$lib/store/redux-dispatch-bridge` (for one-time reads in event handlers only)

Components must **never** import:

- ❌ Saga files (`sagas/*.ts`)
- ❌ Operation files or utility modules that dispatch internally
- ❌ Reducer internals or store init/setup modules
- ❌ Collection utils directly (access collections through selectors)
- ❌ The dispatch bridge for direct dispatching (use `getDispatch()` at init time)

**Services and non-component code** may import actions and selectors.
**Sagas** may import anything within the store directory.

## 8. When to Use Redux vs Component-Local State

**Use Redux when:**

- State is shared by multiple components
- State is needed by services or non-Svelte code
- State is persisted, synced over IPC/network, or survives navigation
- State drives business logic, workflows, or cross-feature coordination
- State is derived in multiple places

**Keep in component when:**

- Purely visual and instance-local (hover, focus, open/closed toggles)
- Only matters while this one component is mounted
- Not shared, persisted, or part of business logic

**Use **`$effect`** only when:**

- Effect is directly tied to this component's rendered DOM
- Focus/scroll/measurement work
- Third-party widget lifecycle that can't live elsewhere

**When in doubt → use Redux.**

## 12. State Serialization Rules

### ✅ Allowed types

`string`, `number`, `boolean`, `null`, `undefined`, plain objects `{}`, arrays of primitives `string[]`, `number[]` (for arrays of objects, use `Collection<T, K>` instead)

### ❌ Forbidden types and alternatives

| Forbidden      | Alternative                                       |
| -------------- | ------------------------------------------------- |
| Function       | Store function name/ID, call from saga            |
| Class instance | Plain object { ... }                              |
| Date           | number (timestamp in ms)                          |
| Map / WeakMap  | Record<string, T>                                 |
| Set / WeakSet  | string[] (primitive sets) or Record<string, true> |
| RegExp         | string (pattern)                                  |
| Promise        | Handle in sagas                                   |
| Symbol         | string constants                                  |
| Error          | { message: string; stack?: string }               |

## 16. Deep-Dive References

For detailed patterns beyond this skill file, see:

- `src/lib/store/docs/REDUX_ARCHITECTURE_GUIDE.md` — Full architecture, actions, sagas, collections, performance
- `src/lib/store/docs/REDUCERS_GUIDE.md` — Reducer patterns and pitfalls
- `src/lib/store/docs/SELECTORS_GUIDE.md` — Selector creation, composition, anti-patterns
- `src/lib/store/docs/WAITFOR_SAGA_GUIDE.md` — `waitFor` utility for saga coordination
- `src/lib/store/docs/MIGRATION_GUIDE.md` — Svelte store → Redux migration checklist
- `src/lib/store/AGENTS.md` — Store-specific agent directives (serialization, collections, saga-only slices, utilities)
- `docs/STATE_MANAGEMENT.md` — Core state management policy
