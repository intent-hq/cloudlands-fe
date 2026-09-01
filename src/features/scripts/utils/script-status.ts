/**
 * Script status predicates — dependency-light (no stores, services, side
 * effects).
 */

import type { ScriptRuntimeState, ScriptStatus } from '../types';

export type ScriptStatusKind =
  'running' | 'restarting' | 'idle' | 'succeeded' | 'failed' | 'stopped' | 'exited';

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

/** Semantic runtime state used by script status presenters. */
export function getScriptStatusKind(
  runtime: Pick<ScriptRuntimeState, 'status' | 'exitCode'>,
): ScriptStatusKind {
  if (runtime.status === 'restarting') return 'restarting';
  if (isLiveScriptStatus(runtime.status)) return 'running';
  if (runtime.status === 'idle') return 'idle';
  if (runtime.exitCode === 0) return 'succeeded';
  if (runtime.exitCode === null || runtime.exitCode === undefined) return 'exited';
  if (runtime.exitCode >= 128) return 'stopped';
  return 'failed';
}
