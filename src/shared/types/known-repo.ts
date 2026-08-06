export interface KnownRepo {
  /**
   * Registry key. Absolute path to the repository for local entries; for
   * path-less GitHub picks (no local checkout) this is the `owner/repo`
   * shorthand and `githubUrl` is set.
   */
  path: string;
  /** Repository name (typically the folder name) */
  name: string;
  /** GitHub organization or user who owns this repository */
  owner?: string;
  /** GitHub URL for path-less GitHub picks (e.g. https://github.com/owner/repo) */
  githubUrl?: string;
  /** ISO timestamp of when this repo was first added */
  addedAt: string;
  /** ISO timestamp of when this repo was last used (workspace created) */
  lastUsedAt: string;
}