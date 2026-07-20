import type { Collection } from '$lib/store-shim/utils/collections/collection-utils';

export type FileContentSource = 'agent' | 'external' | 'user';

export type FileContentEntry = {
  path: string;
  absolutePath: string | null;
  originalContent: string | null;
  localContent: string | null;
  lastUpdated: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  isBinary: boolean;
  truncated: boolean;
};

export type FileContentReadOptions = {
  maxSize?: number;
  truncateIfLarge?: boolean;
};

export type FileContentSaveOptions = {
  intent?: 'save' | 'restore';
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

export type FileWriteResponse = {
  success?: boolean;
  error?: string | { message?: string; code?: string };
};

export type FileContentChangedEvent = {
  workspaceId?: string;
  path?: string;
  relativePath?: string;
  filePath?: string;
  content?: string;
  source?: FileContentSource;
};

export type WatcherFileChangedEvent = {
  workspaceId: string;
  path: string;
  relativePath: string;
  type: 'change' | 'add';
};

export type AgentFileChangedEvent = {
  workspaceId?: string;
  filePath?: string;
  path?: string;
  source?: FileContentSource;
};

export type FileChangedEvent = {
  workspaceId?: string;
  data?: {
    path?: string;
    relativePath?: string;
    action?: string;
    files?: Array<string | { path?: string; relativePath?: string; action?: string }>;
  };
};
