import type { Collection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type { SentryIssueResult } from '$features/sentry-auth/types';

export type IssueSuggestionSource =
  | 'linear-assigned'
  | 'linear-created'
  | 'linear-search'
  | 'sentry'
  | 'github-issues'
  | 'github-prs'
  | 'github-pr-detail';

export type ContextSource = 'linear' | 'github-issues' | 'github-prs' | 'sentry';

type PullRequestFilter = 'all' | 'assigned' | 'created' | 'review-requested' | 'involves';

export interface GitHubIssueSuggestion {
  id: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  owner: string;
  repo: string;
  body?: string;
  author?: string;
  assignee?: string;
  labels?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GitHubPullRequestSuggestion {
  id: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged' | 'draft';
  owner: string;
  repo: string;
  body?: string;
  authorLogin?: string;
  authorName?: string;
  assignees?: string[];
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type IssueSuggestion =
  LinearIssueResult | SentryIssueResult | GitHubIssueSuggestion | GitHubPullRequestSuggestion;

export interface IssueSuggestionRequest {
  query?: string;
  nextToken?: string;
  owner?: string;
  repo?: string;
  filter?: PullRequestFilter;
  number?: number;
}

export interface IssueSuggestionPageState {
  items: Collection<IssueSuggestion, 'id'>;
  nextToken: string | null;
  isFetching: boolean;
  isLoadingMore: boolean;
  error: string | null;
  version: number;
}

export interface IssueSuggestionsState {
  byRequestKey: Record<string, IssueSuggestionPageState>;
  lastUsedContextSource: ContextSource | null;
}
