/**
 * IMetadataFS — Filesystem abstraction for workspace metadata operations.
 *
 * Mirrors the subset of Node's `fs/promises` API used by metadata sync
 * and related storage code.
 *
 * Implementation:
 * - `LocalMetadataFS` — thin pass-through to `fs/promises`.
 */

/**
 * Minimal directory-entry shape returned by `readdir` when called with
 * `{ withFileTypes: true }`.  Matches the subset of `fs.Dirent` that
 * consumers actually use.
 */
export interface MetadataDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Minimal stat result matching the subset of `fs.Stats` that consumers use.
 */
export interface MetadataStat {
  size: number;
  mtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Filesystem abstraction for workspace metadata I/O.
 *
 * Every method accepts **absolute** paths — the same paths that
 * `WorkspaceConfig.paths.*` already produces.
 */
export interface IMetadataFS {
  // ── Read ──────────────────────────────────────────────────────────────

  /** Read a file as UTF-8 text. Throws if the file does not exist. */
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;

  /** Get file/directory stats. Throws if the path does not exist. */
  stat(filePath: string): Promise<MetadataStat>;

  /**
   * Check whether a path is accessible (exists).
   * Throws (ENOENT or equivalent) if the path does not exist — same
   * semantics as `fs.access`.
   */
  access(filePath: string): Promise<void>;

  /**
   * List directory entries with type information.
   * Returns entries with `isFile()` / `isDirectory()` helpers.
   */
  readdir(dirPath: string, options: { withFileTypes: true }): Promise<MetadataDirent[]>;

  // ── Write ─────────────────────────────────────────────────────────────

  /** Write UTF-8 text to a file, creating it if it doesn't exist. */
  writeFile(filePath: string, content: string, encoding: 'utf-8'): Promise<void>;

  /** Create a directory (and parents when `recursive` is true). */
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;

  // ── Delete ────────────────────────────────────────────────────────────

  /** Remove a single file. Throws if the file does not exist. */
  unlink(filePath: string): Promise<void>;

  /**
   * Remove a file or directory.
   * When `recursive` + `force` are true, behaves like `rm -rf`.
   */
  rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  // ── Move ──────────────────────────────────────────────────────────────

  /** Rename / move a file or directory. */
  rename(oldPath: string, newPath: string): Promise<void>;
}

