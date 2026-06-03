import type { PaletteMruEntry, PaletteMruEntryType, PaletteState } from "./palette-types";

export const MAX_PALETTE_MRU_ENTRIES = 50;
export const MAX_PALETTE_FILE_MRU_ENTRIES = 200;

const VALID_MRU_TYPES: Record<PaletteMruEntryType, true> = {
  agent: true,
  note: true,
  change: true,
  terminal: true,
  file: true,
  browser: true,
};

function isPaletteMruEntry(value: unknown): value is PaletteMruEntry {
  const entry = value as PaletteMruEntry;
  return !!entry
    && typeof entry === "object"
    && typeof entry.type === "string"
    && entry.type in VALID_MRU_TYPES
    && typeof entry.id === "string"
    && entry.id.length > 0
    && typeof entry.timestamp === "number"
    && Number.isFinite(entry.timestamp);
}

export function getPaletteMruEntryKey(type: PaletteMruEntryType, id: string): string {
  return `${type}:${id}`;
}

export function normalizePaletteMruEntryList(value: unknown): PaletteMruEntry[] {
  if (!Array.isArray(value)) return [];

  const entriesByKey = new Map<string, PaletteMruEntry>();
  for (const entry of value) {
    if (!isPaletteMruEntry(entry)) continue;

    const key = getPaletteMruEntryKey(entry.type, entry.id);
    const previous = entriesByKey.get(key);
    if (!previous || entry.timestamp > previous.timestamp) {
      entriesByKey.set(key, entry);
    }
  }

  return [...entriesByKey.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_PALETTE_MRU_ENTRIES);
}

export function normalizePaletteMruState(value: unknown): Pick<PaletteState, "mruEntryIds" | "mruEntriesByKey"> {
  const entries = normalizePaletteMruEntryList(value);
  return {
    mruEntryIds: entries.map((entry) => getPaletteMruEntryKey(entry.type, entry.id)),
    mruEntriesByKey: Object.fromEntries(
      entries.map((entry) => [getPaletteMruEntryKey(entry.type, entry.id), entry])
    ),
  };
}

export function getPaletteMruEntries(
  state: Pick<PaletteState, "mruEntryIds" | "mruEntriesByKey">
): PaletteMruEntry[] {
  return state.mruEntryIds
    .map((key) => state.mruEntriesByKey[key])
    .filter((entry): entry is PaletteMruEntry => entry !== undefined);
}

export function normalizePaletteFileMru(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, number] =>
          entry[0].length > 0 && typeof entry[1] === "number" && Number.isFinite(entry[1])
      )
      .sort(([, left], [, right]) => right - left)
      .slice(0, MAX_PALETTE_FILE_MRU_ENTRIES)
  );
}