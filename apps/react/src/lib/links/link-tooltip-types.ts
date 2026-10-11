// Display-only types from tooltip/github-link-preview.ts and link-tooltip-state.svelte.ts.
// Keep the live client, integration context, request lifetime and cache out of this module.
import type {
  GitHubIssueDetails,
  GitHubPullRequestDetails,
} from '$shared/types/github-link-preview';
import type {
  RepositoryResourceFailure,
  RepositoryResourceTarget,
} from '$shared/types/repository-resource-read';

export type GitHubLinkPreview =
  | ({ kind: 'pr' } & GitHubPullRequestDetails)
  | ({ kind: 'issue' } & GitHubIssueDetails);

export type GitHubLinkPreviewFailure = 'rate-limited' | 'unavailable';

export interface GitLabLinkPreview {
  provider: 'gitlab';
  resource: RepositoryResourceTarget;
  kind: 'pr' | 'issue';
  number: number;
  title: string;
  state: string;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  headRef: string | null;
  baseRef: string | null;
}

export type GitLabPreviewUpdate =
  | { status: 'idle' }
  | { status: 'loading'; resource: RepositoryResourceTarget }
  | { status: 'ready'; data: GitLabLinkPreview }
  | { status: 'error'; resource: RepositoryResourceTarget; reason: RepositoryResourceFailure };

export type LinkTooltipPreview =
  | GitLabPreviewUpdate
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: GitHubLinkPreview }
  | { status: 'error'; reason: GitHubLinkPreviewFailure };
