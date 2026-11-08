import { normalizePalettePicks, type PalettePick } from './palette-pick-memory';
import type {
  PaletteMemorySnapshot,
  PaletteMruEntry,
  PaletteMruEntryType,
  PaletteState,
} from './palette-types';

const PALETTE_MEMORY_VERSION = 1;

/** Stored form of `PaletteMemorySnapshot`. */
export type StoredPaletteMemory = {
  version: typeof PALETTE_MEMORY_VERSION;
  mru: PaletteMruEntry[];
  fileMru: Record<string, number>;
  picks: PalettePick[];
};

const MAX_PALETTE_MRU_ENTRIES = 200;
const MAX_PALETTE_FILE_MRU_ENTRIES = 200;

const VALID_MRU_TYPES: Record<PaletteMruEntryType, true> = {
  agent: true,
  note: true,
  change: true,
  terminal: true,
  file: true,
  browser: true,
  command: true,
  workspace: true,
  repo: true,
};

function isPaletteMruEntry(value: unknown): value is PaletteMruEntry {
  const entry = value as PaletteMruEntry;
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof entry.type === 'string' &&
    Object.hasOwn(VALID_MRU_TYPES, entry.type) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.timestamp === 'number' &&
    Number.isFinite(entry.timestamp)
  );
}

function getPaletteMruEntryKey(type: PaletteMruEntryType, id: string): string {
  return `${type}:${id}`;
}

function normalizePaletteMruEntryList(value: unknown): PaletteMruEntry[] {
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

export function normalizePaletteMruState(
  value: unknown,
): Pick<PaletteState, 'mruEntryIds' | 'mruEntriesByKey'> {
  const entries = normalizePaletteMruEntryList(value);
  return {
    mruEntryIds: entries.map((entry) => getPaletteMruEntryKey(entry.type, entry.id)),
    mruEntriesByKey: Object.fromEntries(
      entries.map((entry) => [getPaletteMruEntryKey(entry.type, entry.id), entry]),
    ),
  };
}

export function getPaletteMruEntries(
  state: Pick<PaletteState, 'mruEntryIds' | 'mruEntriesByKey'>,
): PaletteMruEntry[] {
  return state.mruEntryIds
    .map((key) => state.mruEntriesByKey[key])
    .filter((entry): entry is PaletteMruEntry => entry !== undefined);
}

export function normalizePaletteFileMru(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, number] =>
          entry[0].length > 0 && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      )
      .sort(([, left], [, right]) => right - left)
      .slice(0, MAX_PALETTE_FILE_MRU_ENTRIES),
  );
}

export function serializePaletteMemory(state: PaletteMemorySnapshot): StoredPaletteMemory {
  return {
    version: PALETTE_MEMORY_VERSION,
    mru: getPaletteMruEntries(state),
    fileMru: state.fileMru,
    picks: getPalettePicks(state),
  };
}

/** Parse untrusted stored memory; anything unreadable becomes empty memory. */
export function deserializePaletteMemory(value: unknown, now: number): PaletteMemorySnapshot {
  const stored =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<StoredPaletteMemory>)
      : undefined;
  const usable = stored?.version === PALETTE_MEMORY_VERSION ? stored : undefined;
  return {
    ...normalizePaletteMruState(usable?.mru),
    fileMru: normalizePaletteFileMru(usable?.fileMru),
    ...toPalettePickState(normalizePalettePicks(usable?.picks, now)),
  };
}

/** Union of two memories; the newest timestamp wins for each entry. */
export function mergePaletteMemory(
  current: PaletteMemorySnapshot,
  loaded: PaletteMemorySnapshot,
): PaletteMemorySnapshot {
  return {
    ...normalizePaletteMruState([
      ...getPaletteMruEntries(current),
      ...getPaletteMruEntries(loaded),
    ]),
    fileMru: normalizePaletteFileMru(
      Object.fromEntries(
        [...Object.entries(loaded.fileMru), ...Object.entries(current.fileMru)].sort(
          ([, left], [, right]) => left - right,
        ),
      ),
    ),
    ...toPalettePickState(
      normalizePalettePicks([...getPalettePicks(current), ...getPalettePicks(loaded)]),
    ),
  };
}

/** State shape for an already-normalized pick list. */
export function toPalettePickState(
  picks: readonly PalettePick[],
): Pick<PaletteState, 'pickQueries' | 'picksByQuery'> {
  return {
    pickQueries: picks.map((pick) => pick.query),
    picksByQuery: Object.fromEntries(picks.map((pick) => [pick.query, pick])),
  };
}

export function getPalettePicks(
  state: Pick<PaletteState, 'pickQueries' | 'picksByQuery'>,
): PalettePick[] {
  return state.pickQueries
    .map((query) => state.picksByQuery[query])
    .filter((pick): pick is PalettePick => pick !== undefined);
}
