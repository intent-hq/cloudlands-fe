import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { PalettePick } from './palette-pick-memory';

export type PaletteState = {
  isOpen: boolean;
  query: string;
  mruEntryIds: string[];
  mruEntriesByKey: Record<string, PaletteMruEntry>;
  fileMru: Record<string, number>;
  /** Pick memory queries, newest first. Persisted per daemon. */
  pickQueries: string[];
  picksByQuery: Record<string, PalettePick>;
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

/** Workspace object types listed in the palette. */
export type PaletteObjectType = 'agent' | 'note' | 'change' | 'terminal' | 'file' | 'browser';

/** Everything that counts as recently picked: objects plus commands, workspaces and repos. */
export type PaletteMruEntryType = PaletteObjectType | 'command' | 'workspace' | 'repo';

export type PaletteMruEntry = {
  type: PaletteMruEntryType;
  id: string;
  timestamp: number;
};

/** Persisted palette memory for one daemon connection. */
export type PaletteMemorySnapshot = Pick<
  PaletteState,
  'mruEntryIds' | 'mruEntriesByKey' | 'fileMru' | 'pickQueries' | 'picksByQuery'
>;
