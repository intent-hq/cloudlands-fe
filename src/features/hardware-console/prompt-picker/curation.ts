/**
 * Pure prompt-usage curation for the joystick radial prompt picker.
 *
 * Tracks how often the user submits each composer prompt and ranks the
 * most-used ones for the radial menu. Counts are kept normalized: whenever
 * any prompt's count reaches {@link COUNT_RESCALE_THRESHOLD} every count is
 * halved (entries decayed to zero are dropped), so frequencies stay bounded
 * and long-dead prompts fade out instead of dominating forever. The tracked
 * set itself is capped at {@link MAX_TRACKED_PROMPTS} entries by rank.
 *
 * Pure module — no store, no services, no side effects.
 */

/** One tracked prompt inside the `hardwareConsole.state` daemon bag. */
export interface PromptUsageEntry {
  /** Trimmed prompt text, exactly as it will be inserted. */
  text: string;
  /** Normalized usage count (rescaled, never grows unbounded). */
  count: number;
  /** ISO timestamp of the most recent submission (ranking tie-break). */
  lastUsedAt: string;
}

/** Default top-N surface of the radial picker. */
export const DEFAULT_PROMPT_PICKER_LIMIT = 8;
/** Hard cap on the top-N surface (sector legibility limit). */
export const MAX_PROMPT_PICKER_LIMIT = 12;
/** Maximum number of distinct prompts kept in the tracker. */
export const MAX_TRACKED_PROMPTS = 64;
/** Prompts longer than this are not tracked (keeps the settings bag small). */
export const MAX_TRACKED_PROMPT_LENGTH = 1000;
/** When any count reaches this, all counts are halved (normalization). */
export const COUNT_RESCALE_THRESHOLD = 1024;

/**
 * Identity key for a prompt: whitespace-collapsed trimmed text, so
 * reflowed/re-indented copies of the same prompt count as one.
 */
export function promptKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Clamp the picker limit setting to a usable integer in [1, 12]. */
export function clampPromptPickerLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PROMPT_PICKER_LIMIT;
  const limit = Math.floor(value);
  if (limit < 1) return 1;
  return limit > MAX_PROMPT_PICKER_LIMIT ? MAX_PROMPT_PICKER_LIMIT : limit;
}

/** Rank: count desc, then most recently used, then text (deterministic). */
export function rankPromptUsage(entries: readonly PromptUsageEntry[]): PromptUsageEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.count - a.count ||
      b.lastUsedAt.localeCompare(a.lastUsedAt) ||
      a.text.localeCompare(b.text),
  );
}

/** The top-N prompt texts for the radial menu (may be fewer than `limit`). */
export function topPromptTexts(entries: readonly PromptUsageEntry[], limit: number): string[] {
  return rankPromptUsage(entries)
    .slice(0, clampPromptPickerLimit(limit))
    .map((entry) => entry.text);
}

/**
 * Record one composer submission. Returns the updated entry list, or `null`
 * when the text is not trackable (blank, or longer than
 * {@link MAX_TRACKED_PROMPT_LENGTH}) and the caller should keep its state.
 */
export function recordPromptUsage(
  entries: readonly PromptUsageEntry[],
  text: string,
  nowIso: string,
): PromptUsageEntry[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TRACKED_PROMPT_LENGTH) return null;
  const key = promptKey(trimmed);

  let found = false;
  let next = entries.map((entry) => {
    if (promptKey(entry.text) !== key) return entry;
    found = true;
    // Refresh the stored text so the newest phrasing wins on insert.
    return { text: trimmed, count: entry.count + 1, lastUsedAt: nowIso };
  });
  if (!found) next.push({ text: trimmed, count: 1, lastUsedAt: nowIso });

  if (next.some((entry) => entry.count >= COUNT_RESCALE_THRESHOLD)) {
    next = next
      .map((entry) => ({ ...entry, count: Math.floor(entry.count / 2) }))
      .filter((entry) => entry.count > 0);
  }

  return next.length > MAX_TRACKED_PROMPTS
    ? rankPromptUsage(next).slice(0, MAX_TRACKED_PROMPTS)
    : next;
}

/**
 * Tolerant parse of the bag's `promptUsage` field. Malformed entries are
 * dropped; anything non-array yields an empty tracker.
 */
export function parsePromptUsage(value: unknown): PromptUsageEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: PromptUsageEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { text, count, lastUsedAt } = item as Record<string, unknown>;
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) continue;
    entries.push({
      text: text.trim(),
      count: Math.floor(count),
      lastUsedAt: typeof lastUsedAt === 'string' ? lastUsedAt : '',
    });
  }
  return entries.slice(0, MAX_TRACKED_PROMPTS);
}
