Completes [INT-14](https://linear.app/shv/issue/INT-14/wire-all-domains-to-the-live-appclient-retire-mock-only-paths) — wire all renderer domains to live sources and retire the `MockAppClient` delegate from `LiveAppClient`.

## Summary

Every renderer domain is now served by a real live source through the `AppClient` boundary. The four domains that previously delegated to `MockAppClient` in live mode (`system`, `skills`, `browser`, `chat`) now connect directly to their correct sources:

- **system** → daemon `system.status` RPC + Electron auto-update IPC
- **skills** → FE-main `skills:list` IPC (via `skills-loader.ts`)
- **browser** → localStorage persistence for `recentUrls` (FE-local per IMPLEMENTATION_SPEC Group C)
- **chat** → narrowed to `subscribeSnapshot` only; removed dead `history`/`tokenUsage`/`subscribe` methods

The `MockAppClient` delegate field and import have been removed from `LiveAppClient`. The mock framework itself remains intact for tests and standalone mock posture.

## Changes

### Commit 1: System domain
- Add `LiveSystemClient` with daemon RPC for system status and Electron IPC for release notes/auto-update
- 7 vitest tests confirm daemon status round-trip and auto-update feature integration

### Commit 2: Skills domain
- Add `LiveSkillsClient` delegating to `skills:list` unbridged IPC
- Add `skills:list` to `UNBRIDGED_INVOKE_ALLOWLIST` (fixes reconciliation suite)
- 7 vitest tests confirm IPC round-trip and renderer `SkillInfo` shape compatibility

### Commit 3: Browser domain
- Add `LiveBrowserClient` with localStorage round-trip for `browser.recentUrls`
- Add `browserPersistenceMiddleware` to sync Redux browser slice to localStorage
- Fix transitive test breakage: export `createLogger` in PRSection mock, add `browserPersistenceMiddleware` to `middleware.test.ts`
- 6 vitest tests confirm localStorage hydration/persistence cycle

### Commit 4: Chat domain retirement
- Remove `chat.history`, `chat.tokenUsage`, `chat.subscribe` from `ChatClient` interface (no consumers found)
- Narrow `LiveChatClient` to `subscribeSnapshot` only
- Update `MockAppClient` to match narrowed contract
- 7 vitest tests confirm `subscribeSnapshot` remains functional

### Commit 5: MockAppClient removal
- Remove `this.mock` field and `MockAppClient` import from `LiveAppClient`
- Wire system/skills/browser/chat domains directly to their respective live clients
- Zero `MockAppClient`/`this.mock` references remain in `live-app-client.ts`

## Testing

- 27 targeted vitest tests (system/skills/browser/chat live clients) — all green
- `pnpm run check` — 0 errors
- All three tsc typechecks (`tsconfig.json`, `tsconfig.main.json`, `tsconfig.preload.json`) — pass
- Full suite: 714 test files pass

## Verification

All acceptance criteria met:
- ✅ `live-app-client.ts` contains zero references to `MockAppClient` / `this.mock`
- ✅ Live boot: system status, skills, and recent URLs are real (daemon / FE-main IPC / localStorage) — no fixture data reaches Redux in live mode
- ✅ `ChatClient` has no mock-delegated methods
- ✅ All targeted vitest suites pass; `pnpm run check` + all three tsc typechecks pass
