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

export interface HookWakeAttribution {
  /** Hook id (may be empty when the daemon omitted it). */
  hookId: string;
  /** Display name for the hook ("Hook" fallback, truncated to ~20 chars). */
  displayName: string;
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
  const name = rawName || 'Hook';
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;

  return { hookId, displayName };
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
