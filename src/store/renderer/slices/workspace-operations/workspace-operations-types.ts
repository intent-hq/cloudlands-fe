/** Serializable projection of an unmerged PR for the archive/delete warnings. */
export interface OpenPrWarningItem {
  number: number;
  title: string;
  /** May be '' when the wire url is empty and no repo owner/name is known to construct one. */
  url: string;
  status: 'Open' | 'Draft';
  mergeConflicts?: boolean;
}

/** One git root row of the `workspace.localChanges` result (PROTOCOL `workspace.localChanges`). */
export interface LocalChangesRoot {
  kind: 'primary' | 'secondary';
  /** Secondary roots only. */
  gitRootId?: string;
  path: string;
  /** Omitted when HEAD is unreadable (detached/unborn). */
  branch?: string;
  hasRemoteRefs: boolean;
  unpushedCount: number;
  uncommittedCount: number;
  /** Present only when the root could not be read; counts are then 0. */
  error?: string;
}

/** Serializable `workspace.localChanges` result carried into the archive/delete warnings. */
export interface LocalChangesWarning {
  roots: LocalChangesRoot[];
  hasUnpushedCommits: boolean;
  hasUncommittedChanges: boolean;
}
