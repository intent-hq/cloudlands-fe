/**
 * Script status predicates — dependency-light (no stores, services, side
 * effects).
 */

import type { ScriptStatus } from '../types';

/**
 * Statuses with no live PTY group daemon-side — the only states where a
 * §5.8 `script.create` scriptId upsert is safe to issue (the upsert tears
 * down any live group). Deliberately an allowlist: `running`, `restarting`,
 * and any future transitional status are treated as live by default.
 */
const SAFE_TO_UPSERT_STATUSES: readonly ScriptStatus[] = ['idle', 'exited'];

/**
 * True when the script's process is live (running, restarting, or any
 * unknown/transitional status outside the safe-to-upsert allowlist).
 */
export function isLiveScriptStatus(status: ScriptStatus | undefined): boolean {
  return status === undefined || !SAFE_TO_UPSERT_STATUSES.includes(status);
}
