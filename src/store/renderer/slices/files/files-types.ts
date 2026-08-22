import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';

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
  /**
   * Suffix-resolution candidates recorded when a read failed with not-found
   * (`[]` = resolution attempted, no matches; `null`/absent = not attempted).
   */
  notFoundCandidates?: string[] | null;
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
