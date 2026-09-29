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
  id: number;
  body: string;
  path: string;
  line: number | null;
  user: { login: string };
  htmlUrl: string;
}
export interface HomeIntegrationsState {
  scope: HomeIntegrationScope | null;
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
}
