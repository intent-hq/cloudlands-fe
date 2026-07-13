export interface KnownRepo {
  /** Absolute path to the repository */
  path: string;
  /** Repository name (typically the folder name) */
  name: string;
  /** GitHub organization or user who owns this repository */
  owner?: string;
  /** ISO timestamp of when this repo was first added */
  addedAt: string;
  /** ISO timestamp of when this repo was last used (workspace created) */
  lastUsedAt: string;
}