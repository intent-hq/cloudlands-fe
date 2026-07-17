## Summary

Restores localStorage-backed user-preferences persistence (GAPs 9–15, 17–18): spellcheck, showArchived, groupByRepo, hasCompletedProviderSetup, agent font style, note font style, code font family, activity-log presets, and promo-banner interactions. Beta-updates and notification settings are excluded (handled by sibling task).

## Changes

- **src/store/renderer/middlewares/user-preferences-persistence-service.ts**
  - Boot-time hydration: reads all preferences from localStorage on first action and dispatches hydrate/set actions
  - Write-after-action persistence: listens for preference-mutating actions and writes to localStorage
  - Uses exact legacy storage keys (e.g., `note-spellcheck-settings`, `workspace-list:showArchived`, `agent-font-settings`) so existing users' stored values are honored
  - Guards against malformed JSON with safe fallback (silent skip)
  
- **src/store/renderer/middleware.ts**
  - Register `createUserPreferencesPersistenceMiddleware()` in the middleware pipeline after `createFileContentPruneService()`
  - Add inline documentation explaining the middleware's purpose

- **src/store/renderer/middleware.test.ts**
  - Add `userPreferencesPersistenceMiddleware` mock to the vi.hoisted mocks block
  - Add vi.mock for `./middlewares/user-preferences-persistence-service`
  - Insert `mocks.userPreferencesPersistenceMiddleware` into all expected middleware pipeline arrays (4 test cases)

- **src/store/renderer/middlewares/user-preferences-persistence-service.test.ts**
  - Boot-time hydration tests: verify each preference group hydrates correctly from localStorage
  - Persistence tests: verify each action type triggers the correct localStorage write
  - Storage key compatibility tests: verify exact legacy keys are used

## Verification

```bash
pnpm vitest run src/store/renderer/middlewares/user-preferences-persistence-service.test.ts
pnpm vitest run src/store/renderer/middleware.test.ts
pnpm run lint
pnpm run check
```

All green.

## Notes

- Dependency-light per `src/store/renderer/AGENTS.md`: imports only the safe-storage helper and slice actions/types — no selectors (importing them would evaluate `store.createSelector` mid store-init)
- Hydration runs once on first action (guarded by `hasHydrated` flag)
- Writes happen after `next(action)` so state is already updated when the middleware reads `api.getState()`
- safeLocalStorage.getJSON handles parse failures gracefully with logged warnings but no throw
