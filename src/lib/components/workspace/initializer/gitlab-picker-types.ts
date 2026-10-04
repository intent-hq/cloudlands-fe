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
}

export interface GitLabProjectPickerProps extends GitLabPickerProps<GitLabProjectRow> {
  selectedProjectPath?: string;
  onSelect: (projectPath: string, scopeKey: string) => void;
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
