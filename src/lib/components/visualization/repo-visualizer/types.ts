/**
 * Type definitions for the repo visualizer
 * Ported from githubocto/repo-visualizer
 */

export type CommitType = {
  hash: string;
  subject: string;
  author: string;
  date: string;
  diff: { added: number; removed: number; modified: number };
};

export type FileType = {
  name: string;
  path: string;
  size: number;
  commits?: CommitType[];
  numberOfLines?: number;
  children?: FileType[];
};

export type ExtendedFileType = {
  extension?: string;
  pathWithoutExtension?: string;
  label?: string;
  color?: string;
  value?: number;
  sortOrder?: number;
} & FileType;

export type ProcessedDataItem = {
  data: ExtendedFileType;
  depth: number;
  height: number;
  r: number;
  x: number;
  y: number;
  parent: ProcessedDataItem | null;
  children: ProcessedDataItem[];
  // Added during reflow
  originalX?: number;
  originalY?: number;
};

export type ColorEncoding = 'type' | 'number-of-changes' | 'last-change';

export interface TreeProps {
  data: FileType | null;
  filesChanged?: string[];
  maxDepth?: number;
  colorEncoding?: ColorEncoding;
  customFileColors?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface RepoVisualizerProps {
  workspacePath: string;
  workspaceId: string;
  filesChanged?: string[];
  maxDepth?: number;
  colorEncoding?: ColorEncoding;
  customFileColors?: Record<string, string>;
  class?: string;
}
