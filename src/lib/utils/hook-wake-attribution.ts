/**
 * Background-hook wake message attribution.
 *
 * The daemon tags user-role rows delivered by a background hook wake with
 * `{ type: 'hook_wake', hookId, hookName, reason }` — on the row's
 * `metadata`, on the persisted text block's `messageMetadata`, and on queued
 * entries' `messageMetadata` (PROTOCOL §5.40). This util extracts that
 * attribution metadata-first, with the protocol prefix as a legacy fallback.
 */

import { m } from '$shared/paraglide/messages.js';

export interface HookWakeAttribution {
  /** Hook id (may be empty when the daemon omitted it). */
  hookId: string;
  /** Display name for the hook (localized fallback, truncated to ~20 chars). */
  displayName: string;
  /**
   * Verbatim hook name from metadata (empty when absent) — untrimmed and
   * untruncated, exactly as the daemon used it in the literal wake prefix.
   * Used for the exact-prefix strip in {@link stripHookWakePrefix} so names
   * containing double quotes or edge whitespace strip correctly.
   */
  rawName: string;
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

function buildHookWakeAttribution(
  rawName: string,
  fields: { hookId?: unknown; reason?: unknown; hookStillActive?: unknown } = {},
): HookWakeAttribution {
  const name = rawName.trim() || m.chat_hookWakeAttribution_fallbackName_label();
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;
  const attribution: HookWakeAttribution = {
    hookId: typeof fields.hookId === 'string' ? fields.hookId.trim() : '',
    displayName,
    rawName,
    reason: typeof fields.reason === 'string' ? fields.reason : '',
  };
  if (typeof fields.hookStillActive === 'boolean') {
    attribution.hookStillActive = fields.hookStillActive;
  }
  return attribution;
}

/**
 * Extract hook-wake attribution from metadata or a legacy protocol prefix.
 */
export function getHookWakeAttribution(
  metadata: unknown,
  legacyContent?: string,
): HookWakeAttribution | null {
  if (metadata && typeof metadata === 'object') {
    const md = metadata as Record<string, unknown>;
    if (md.type === 'hook_wake') {
      return buildHookWakeAttribution(typeof md.hookName === 'string' ? md.hookName : '', md);
    }
  }

  const legacyMatch = legacyContent?.match(/^\[Background hook "([^"]*)"\]\s*/);
  return legacyMatch ? buildHookWakeAttribution(legacyMatch[1]) : null;
}

/**
 * Literal wake prefix the daemon prepends to hook wake message content:
 * `[Background hook "<name>"] `. Display-only strip — the stored message
 * text is never mutated. Returns the input unchanged when no prefix matches.
 *
 * When the verbatim (untrimmed, untruncated) hook name from metadata is
 * available, the exact literal prefix built from it is stripped first — this
 * handles names containing double quotes or edge whitespace, which the regex
 * fallback cannot match. Without a raw name (or when the literal prefix does
 * not match), the regex fallback preserves the previous behavior.
 */
const HOOK_WAKE_PREFIX = /^\[Background hook "[^"]*"\]\s*/;

export function stripHookWakePrefix(text: string, rawName?: string): string {
  if (rawName) {
    const prefix = `[Background hook "${rawName}"]`;
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length).replace(/^\s*/, '');
    }
  }
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
