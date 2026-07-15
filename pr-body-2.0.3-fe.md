## Problem
Packaged builds (2.0.2) showed "not installed" for all providers (auggie, claude) even when they were available, because:
1. Provider availability checks ran before the intentd socket was ready (startup race)
2. All checks failed with ENOENT → all providers marked unavailable
3. `hasCheckedOnce` prevented re-checking on the first Settings mount

## Solution
Re-run the full provider availability check when the backend connection is (re)established, bypassing `hasCheckedOnce`. This ensures providers are re-detected after the daemon is ready.

## Changes
- Provider availability check service now listens for backend connection events
- Bulk re-check triggered on connect/reconnect
- Tests verify the reconnect behavior and avoid TDZ issues

## Verification
- 7/7 tests pass
- `pnpm run check` passes
- All three tsc typechecks pass (tsconfig.json, tsconfig.main.json, tsconfig.preload.json)

Part of the 2.0.3 release (CLI detection fixes).
