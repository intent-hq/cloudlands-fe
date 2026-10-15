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

/** Observed UTF-8 prefix, never an editable document or an Undo snapshot. */
type ReadOnlyText = {
  kind: 'read-only-text';
  content: string;
  bytesRead: number;
  totalBytes: number;
};

export type FileContent = EditableText | RestorableSnapshot | PreviewOnly | ReadOnlyText;

export type FileContentData =
  | {
      kind: 'read-only-text';
      originalContent: string;
      localContent: null;
      isBinary: false;
      bytesRead: number;
      totalBytes: number;
    }
  | { kind: 'preview-only'; originalContent: null; localContent: null; isBinary: boolean }
  | { kind: 'editable-text'; originalContent: string; localContent: string; isBinary: false }
  | { kind: 'restorable-snapshot'; originalContent: string; localContent: string; isBinary: true };

export type FileContentEntry = FileContentData & {
  path: string;
  absolutePath: string | null;
  lastUpdated: number;
  loading: boolean;
  saving: boolean;
  /** Correlates opt-in guarded saves; never a persisted document identity. */
  saveRequestId?: string;
  error: string | null;
  truncated: boolean;
  /** [] = suffix resolution attempted, no matches; null/absent = not attempted. */
  notFoundCandidates?: string[] | null;
};

export type FileContentReadOptions = {
  gitRoot?: { id: string; relativePath: string };
  maxSize?: number;
  truncateIfLarge?: boolean;
  /** Explicit bounded read-only observation; never substitutes for a full read. */
  readOnlyPreview?: boolean;
  attachment?: { id: string; agentId: string };
};

export type FileReadTransportOptions = { gitRootId?: string; readOnlyPreview?: boolean };

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

export type FileSaveOptions = {
  requestId: string;
  authority: string;
  /** Desktop autosave/flush may queue behind an admitted write; never sent on the wire. */
  serialize?: boolean;
};
export type FileSaveStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'uncertain';
export type FileSaveOperation = FileSaveOptions & {
  workspaceId: string;
  path: string;
  absolutePath: string;
  status: FileSaveStatus;
  error?: string;
};

export type FilesState = {
  /** Latest settled receipt per resource/authority plus pending/uncertain outcomes; never persisted/replayed. */
  saveOperations?: Collection<FileSaveOperation, 'requestId'>;
  byWorkspaceId: Record<string, FilesWorkspaceState>;
};

export type FileReadResponse = {
  success?: boolean;
  data?: string | { content?: string; isBinary?: boolean; truncated?: boolean };
  error?: string | { message?: string; code?: string };
};
