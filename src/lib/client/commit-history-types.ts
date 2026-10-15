import type { CommitInfo } from '../../features/file-tracking/types';

/** PROTOCOL §5.19: current and boundary-inclusive older walks have independent opaque cursors. */
export interface CommitHistoryPageOptions {
  readonly includeOlder: boolean;
  readonly limit: number;
  /** Local cursor name; the daemon router accepts this as nextToken. */
  readonly pageToken?: string;
}

export interface CommitHistoryPage {
  commits: CommitInfo[];
  boundarySha: string | null;
  nextToken: string | null;
}

export interface CommitHistoryReaderDependencies {
  readonly request: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
  readonly isCurrent?: () => boolean;
}
