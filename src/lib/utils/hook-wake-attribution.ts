/**
 * Background-hook wake message attribution.
 *
 * The daemon tags user-role rows delivered by a background hook wake with
 * `{ type: 'hook_wake', hookId, hookName, reason }` — on the row's
 * `metadata`, on the persisted text block's `messageMetadata`, and on queued
 * entries' `messageMetadata` (PROTOCOL §5.40). This util extracts that
 * attribution metadata-first with graceful fallback: absent or malformed
 * metadata returns `null` so the message renders exactly as before.
 */

import { m } from '$shared/paraglide/messages.js';

export interface HookWakeAttribution {
  /** Hook id (may be empty when the daemon omitted it). */
  hookId: string;
  /** Display name for the hook (localized fallback, truncated to ~20 chars). */
  displayName: string;
  /** Wake reason (`dispatched` / `evicted` / …; empty when absent). */
  reason: string;
  /**
   * Whether the hook remains active after a `dispatched` wake (perpetual
   * re-arm) or is retired. Absent on other reasons and on messages persisted
   * before the daemon added the field (presence-detected additive field).
   */
  hookStillActive?: boolean;
}

const MAX_NAME_LENGTH = 20;

/**
 * Extract hook-wake attribution from an opaque metadata object. Returns
 * `null` unless `metadata.type === 'hook_wake'`.
 */
export function getHookWakeAttribution(metadata: unknown): HookWakeAttribution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  if (md.type !== 'hook_wake') return null;

  const hookId = typeof md.hookId === 'string' ? md.hookId.trim() : '';
  const rawName = typeof md.hookName === 'string' ? md.hookName.trim() : '';
  const name = rawName || m.chat_hookWakeAttribution_fallbackName_label();
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;
  const reason = typeof md.reason === 'string' ? md.reason : '';

  const attribution: HookWakeAttribution = { hookId, displayName, reason };
  if (typeof md.hookStillActive === 'boolean') {
    attribution.hookStillActive = md.hookStillActive;
  }
  return attribution;
}

/**
 * Literal wake prefix the daemon prepends to hook wake message content:
 * `[Background hook "<name>"] `. Display-only strip — the stored message
 * text is never mutated. Returns the input unchanged when no prefix matches.
 */
const HOOK_WAKE_PREFIX = /^\[Background hook "[^"]*"\]\s*/;

export function stripHookWakePrefix(text: string): string {
  return text.replace(HOOK_WAKE_PREFIX, '');
}

/**
 * Trailing state note the daemon appends to dispatched/evicted hook wake
 * messages as a final single-line paragraph starting with `[This hook` and
 * ending with `]` (old and new daemon wordings alike). The attribution chip
 * conveys the post-fire state instead. Also matches a note constituting the
 * whole string — an empty dispatch message leaves no preceding blank line
 * after the prefix strip. Display-only strip — the stored message text is
 * never mutated. Returns the input unchanged when no match exists.
 */
const HOOK_WAKE_STATE_NOTE = /(?:\n[ \t]*\n|^)\[This hook [^\n]*\]\s*$/;

export function stripHookWakeStateNote(text: string): string {
  return text.replace(HOOK_WAKE_STATE_NOTE, '');
}
