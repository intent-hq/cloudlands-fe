import type { Snippet } from 'svelte';

/**
 * Presentation-only props. Shared checkout state owns admitted responses,
 * cursors, branch restoration and request retirement. A scopeKey identifies
 * that consumer snapshot; it never grants repository access.
 */
type GitLabPickerPage<T> =
  | { status: 'loading' }
  | { status: 'ready'; items: readonly T[]; hasMore: boolean; loadingMore?: boolean }
  | { status: 'unavailable'; message: string; detail?: string; actionLabel?: string };

interface GitLabPickerCopy {
  searchLabel: string;
  searchPlaceholder: string;
  listLabel: string;
  loadingLabel: string;
  emptyLabel: string;
  emptySearchLabel: string;
  loadMoreLabel: string;
  loadingMoreLabel: string;
}

export interface GitLabPickerProps<T> {
  /** Optional shared forge chooser inside the search field. */
  prefix?: Snippet;
  scopeKey: string;
  instanceBaseUrl?: string;
  query: string;
  page: GitLabPickerPage<T>;
  copy: GitLabPickerCopy;
  onSearch: (query: string, scopeKey: string) => void;
  /** Optional explicit action, separate from server search and list selection. */
  onSubmit?: (query: string, scopeKey: string) => void;
  submitLabel?: string;
  onMore: (scopeKey: string) => void;
  onRecover?: (scopeKey: string) => void;
}

/** Displayed subset of the producer's Project, without a client-authored clone target. */
interface GitLabProjectRow {
  projectPath: string;
  name: string;
  namespace: string;
  ownerAvatarUrl?: string;
}

export interface GitLabProjectPickerProps extends GitLabPickerProps<GitLabProjectRow> {
  /** Current configured-root authentication, independent of a pending checkout capture. */
  authenticated?: boolean;
  selectedProjectPath?: string;
  selectedProject?: GitLabProjectRow;
  onSelect: (projectPath: string, scopeKey: string) => void;
  /** Explicit recent selection may begin a capture for this verified configured root. */
  onSelectRecent?: (projectPath: string, instanceBaseUrl: string) => void;
  onOpenChange?: (open: boolean, scopeKey: string) => void;
}

interface GitLabBranchRow {
  name: string;
  commitSha: string;
  /** Cached refs may not include provider-observed protection metadata. */
  protected?: boolean;
}

export interface GitLabBranchPickerProps extends GitLabPickerProps<GitLabBranchRow> {
  projectPath: string;
  selectedBranch?: Pick<GitLabBranchRow, 'name' | 'commitSha'>;
  placeholder: string;
  protectedLabel: string;
  triggerClass?: string;
  onSelect: (branch: Pick<GitLabBranchRow, 'name' | 'commitSha'>, scopeKey: string) => void;
  onOpenChange?: (open: boolean, scopeKey: string) => void;
}
