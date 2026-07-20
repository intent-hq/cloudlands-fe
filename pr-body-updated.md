## Background agent settings persistence + hydration

Adds renderer-side middleware to persist and re-hydrate background-agent model settings via the daemon settings catalog, wiring background-agent settings into the existing settings hydration + `settings:changed` flow so values survive restart.

**Changes:**
- Registers a new background-agent settings persistence middleware in the renderer middleware chain
- Updates settings hydration routing to fall back to current slice state for partial `settings:changed` deltas (so a delta containing only ONE of `backgroundAgents.defaultModel` / `backgroundAgents.typeOverrides` doesn't drop the other)
- Adds a new persistence service + unit tests covering atomic persistence and "no write loop" behavior

**Implementation:**
- `background-agent-settings-persistence-service.ts`: Middleware that persists background-agent settings back to daemon settings on mutations in ONE atomic `settings.update` call (avoids partial deltas + redundant IPC)
- `settings-hydration-service.ts`: Updated `applyBackgroundAgentBundle()` to fall back to current slice state for missing keys in partial `settings:changed` deltas
- `background-agent-settings-persistence-service.test.ts`: 6 unit tests with mutable mock state that simulates reducer behavior and asserts post-action persistence values
- `middleware.test.ts`: Fixed to include new middleware in chain assertions

**Testing:**
- All local checks pass: `pnpm check`, `vitest` (26/26), `tsc` (all 3)
- All CI checks pass: lint, typecheck, build, tests, CodeQL
