import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type PaletteState = {
  isOpen: boolean;
  query: string;
  mruEntryIds: string[];
  mruEntriesByKey: Record<string, PaletteMruEntry>;
  fileMru: Record<string, number>;
  noteSearches: Collection<PaletteNoteSearchEntry, 'consumerId'>;
};

type PaletteNoteSearchItem = {
  id: string;
  type: 'note';
  noteId: string;
  workspaceId: string;
  label: string;
  description: string;
  score: number;
  updatedAt: string;
  isArchived: boolean;
  isArchivedWorkspace: boolean;
  workspaceName?: string;
  repoLabel?: string;
};

export type PaletteNoteSearchUpdate = {
  items: PaletteNoteSearchItem[];
  loading: boolean;
  capability: 'unknown' | 'indexed' | 'legacy';
  fallback: boolean;
  error?: string;
};

type PaletteNoteSearchEntry = PaletteNoteSearchUpdate & {
  consumerId: string;
  requestId: string;
  query: string;
  preferWorkspaceId?: string;
  authority: string | null;
};

export type PaletteMruEntryType = 'agent' | 'note' | 'change' | 'terminal' | 'file' | 'browser';

export type PaletteMruEntry = {
  type: PaletteMruEntryType;
  id: string;
  timestamp: number;
};
