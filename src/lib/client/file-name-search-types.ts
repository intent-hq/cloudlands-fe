/** Metadata returned by the bounded search.fileNames read; no pagination or total is inferred. */
export interface FileNameSearchResult {
  files: string[];
  truncated: boolean;
}
