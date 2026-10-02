export type HomeIntegrationKind = 'prs' | 'linear';
export interface IntegrationRepository {
  key: string;
  name: string;
  owner?: string;
  path?: string;
}
export interface HomeIntegrationScope {
  kind: HomeIntegrationKind;
  repositories: IntegrationRepository[];
  /** Explicit GitHub organization scope, independent of repositories loaded in Home. */
  organization?: string;
  workspaceId?: string;
}
export interface HomeIntegrationItem {
  id: string;
  title: string;
  identifier: string;
  url: string;
  description?: string;
  state?: string;
  author?: string;
  authorAvatarUrl?: string;
  updatedAt?: string;
  labels?: string[];
  owner?: string;
  repo?: string;
  number?: number;
  headRef?: string;
  baseRef?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  team?: string;
  priority?: number;
  assignee?: string;
  project?: string;
}
export interface HomeReviewComment {
  inReplyToId?: number | null;
  createdAt?: string;
  id: number;
  body: string;
  path: string;
  line: number | null;
  user: { login: string; avatarUrl?: string };
  htmlUrl: string;
}
export interface HomeIntegrationsState {
  scope: HomeIntegrationScope | null;
  /** Complete old-daemon org enumeration, retained for PR pagination only. */
  organizationRepositories?: Record<string, IntegrationRepository>;
  generation: number;
  query: string;
  filter: string;
  closed: boolean;
  status: 'idle' | 'loading' | 'ready' | 'disconnected' | 'error';
  error: string | null;
  items: HomeIntegrationItem[];
  cursors: (string | null)[];
  loadingMore: boolean;
  selectedId: string | null;
  detail: HomeIntegrationItem | null;
  detailLoading: boolean;
  detailError: string | null;
  comments: HomeReviewComment[];
  commentsCursor: string | null;
  commentsLoading: boolean;
  commentsError: string | null;
  reviewData: HomePullReviewData | null;
  reviewLoading: boolean;
  reviewError: string | null;
  reviewsCursor: string | null;
  checksLoading: boolean;
  checksError: string | null;
  files: HomePullFile[];
  filesCursor: string | null;
  filesHeadSha: string | null;
  filesTruncated: boolean;
  filesLoading: boolean;
  filesError: string | null;
}

export interface HomePullCheck {
  name: string;
  state: 'pending' | 'success' | 'failure' | 'neutral' | 'cancelled';
  url?: string | null;
}
export interface HomePullReview {
  id: number | string;
  author: string;
  state: string;
  body?: string | null;
  submittedAt?: string | null;
  url?: string | null;
}
export interface HomePullFile {
  filename: string;
  previousFilename?: string | null;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
  url?: string | null;
}
export interface HomePullReviewData {
  headSha: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  checks: HomePullCheck[];
  reviews: HomePullReview[];
  requestedReviewers: string[];
}
