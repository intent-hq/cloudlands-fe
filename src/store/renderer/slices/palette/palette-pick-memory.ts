/**
 * Pick memory: which item the user chose for which typed query. Pure helpers
 * shared by the palette store (persistence) and the ranker (lookups).
 */

export type PalettePick = {
  /** Normalized query (see `normalizePalettePickQuery`). */
  query: string;
  /** `palettePickItemKey(type, id)` of the chosen item. */
  itemKey: string;
  timestamp: number;
};

export type PalettePickWeights = {
  /** itemKey -> fade weight for a pick made with exactly this query. */
  exact: Map<string, number>;
  /** itemKey -> best fade weight for picks whose query is a prefix of, or extends, this query. */
  related: Map<string, number>;
};

export const MAX_PALETTE_PICKS = 200;
export const PALETTE_PICK_FADE_MS = 30 * 24 * 60 * 60 * 1000;

export function palettePickItemKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export function normalizePalettePickQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 1 for a pick made now, falling linearly to 0 at `PALETTE_PICK_FADE_MS`. */
export function palettePickFade(timestamp: number, now: number): number {
  const age = Math.max(0, now - timestamp);
  return Math.max(0, 1 - age / PALETTE_PICK_FADE_MS);
}

function isPalettePick(value: unknown): value is PalettePick {
  const pick = value as PalettePick;
  return (
    !!pick &&
    typeof pick === 'object' &&
    typeof pick.query === 'string' &&
    typeof pick.itemKey === 'string' &&
    pick.itemKey.length > 0 &&
    typeof pick.timestamp === 'number' &&
    Number.isFinite(pick.timestamp)
  );
}

/**
 * Validate untrusted picks: one item per query (the newest), newest first,
 * capped; with `now`, faded-out picks are dropped too.
 */
export function normalizePalettePicks(value: unknown, now?: number): PalettePick[] {
  if (!Array.isArray(value)) return [];

  const byQuery = new Map<string, PalettePick>();
  for (const entry of value) {
    if (!isPalettePick(entry)) continue;
    const query = normalizePalettePickQuery(entry.query);
    if (!query) continue;
    if (now !== undefined && palettePickFade(entry.timestamp, now) <= 0) continue;
    const previous = byQuery.get(query);
    if (!previous || entry.timestamp > previous.timestamp) {
      byQuery.set(query, { query, itemKey: entry.itemKey, timestamp: entry.timestamp });
    }
  }

  return [...byQuery.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_PALETTE_PICKS);
}

export function addPalettePick(picks: readonly PalettePick[], pick: PalettePick): PalettePick[] {
  return normalizePalettePicks([pick, ...picks]);
}

/**
 * Pick weights for `query`. The caller must still check that each item
 * matches the query before using its weight.
 */
export function getPalettePickWeights(
  picks: readonly PalettePick[],
  query: string,
  now: number,
): PalettePickWeights {
  const exact = new Map<string, number>();
  const related = new Map<string, number>();
  const typed = normalizePalettePickQuery(query);
  if (!typed) return { exact, related };

  for (const pick of picks) {
    const weight = palettePickFade(pick.timestamp, now);
    if (weight <= 0) continue;
    if (pick.query === typed) {
      exact.set(pick.itemKey, Math.max(weight, exact.get(pick.itemKey) ?? 0));
    } else if (pick.query.startsWith(typed) || typed.startsWith(pick.query)) {
      related.set(pick.itemKey, Math.max(weight, related.get(pick.itemKey) ?? 0));
    }
  }
  for (const itemKey of exact.keys()) related.delete(itemKey);
  return { exact, related };
}
