/**
 * Normalized single-value PR state (the wire carries `state` + `merged` +
 * `draft` + `isInMergeQueue`). `'queued'` is an open, non-draft PR sitting in
 * the merge queue (`isInMergeQueue: true`).
 */
export type GitHubPullRequestState = 'open' | 'closed' | 'merged' | 'draft' | 'queued';

/**
 * One pull request (`github.pulls.get`, §5.27) normalized for link previews:
 * the wire's `state` + `merged` + `draft` + `isInMergeQueue` collapse into a
 * single `state` (merged → `'merged'`, closed → `'closed'`, draft →
 * `'draft'`, `isInMergeQueue: true` → `'queued'`, else `'open'`).
 */
export interface GitHubPullRequestDetails {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: GitHubPullRequestState;
  /** `user.login` of the PR author. */
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  headRef: string;
  baseRef: string;
}

/** One issue (`github.issues.get`, §5.27) normalized for link previews. */
export interface GitHubIssueDetails {
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  /** `user.login` of the issue author. */
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}
