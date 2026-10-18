import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

/** Content admitted for a text edit or save, including an empty file. */
export type EditableText = { kind: 'editable-text'; content: string };

/** Exact file.read contents retained for Undo, never an editor draft for a binary. */
export type RestorableSnapshot = {
  kind: 'restorable-snapshot';
  content: string;
  isBinary: boolean;
};

/** The bytes are unavailable through file.read; downloads use the original-byte route. */
export type PreviewOnly = { kind: 'preview-only'; isBinary: boolean };

export type FileContent = EditableText | RestorableSnapshot | PreviewOnly;

export type FileContentData =
  | { kind: 'preview-only'; originalContent: null; localContent: null; isBinary: boolean }
  | { kind: 'editable-text'; originalContent: string; localContent: string; isBinary: false }
  | { kind: 'restorable-snapshot'; originalContent: string; localContent: string; isBinary: true };

export type FileContentEntry = FileContentData & {
  path: string;
  absolutePath: string | null;
  lastUpdated: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  truncated: boolean;
  /** [] = suffix resolution attempted, no matches; null/absent = not attempted. */
  notFoundCandidates?: string[] | null;
};

export type FileContentReadOptions = {
  gitRoot?: { id: string; relativePath: string };
  maxSize?: number;
  truncateIfLarge?: boolean;
};

export type FileContentUpdateOptions = {
  /** The standalone files route retains explicit-save behavior. */
  autoSave?: boolean;
};

export type FileDeleteOptions = {
  absolutePath: string;
  tabId?: string;
  /** Editor deletion restores the current draft; tree deletion reads the disk. */
  snapshot?: RestorableSnapshot;
};

export type FilesWorkspaceState = {
  files: Collection<FileContentEntry, 'path'>;
};

export type FilesState = {
  byWorkspaceId: Record<string, FilesWorkspaceState>;
};

export type FileReadResponse = {
  success?: boolean;
  data?: string | { content?: string; isBinary?: boolean; truncated?: boolean };
  error?: string | { message?: string; code?: string };
};
