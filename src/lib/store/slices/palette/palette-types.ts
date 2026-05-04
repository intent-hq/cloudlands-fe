export type PaletteState = {
  isOpen: boolean;
  query: string;
  mruEntryIds: string[];
  mruEntriesByKey: Record<string, PaletteMruEntry>;
  fileMru: Record<string, number>;
};

export type PaletteMruEntryType = "agent" | "note" | "change" | "terminal" | "file" | "browser";

export type PaletteMruEntry = {
  type: PaletteMruEntryType;
  id: string;
  timestamp: number;
};

