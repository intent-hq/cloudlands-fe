import {
  linearAuthClient,
  type LinearIssuePage,
  type LinearIssuePageOptions,
} from '$features/linear-auth/renderer/linear-auth.client';
import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
import type { FetchIssuesRequest, SentryIssuePage } from '$features/sentry-auth/types';
import { invoke } from '$shared/generated/ipc-client';
import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { getLocalStorageItem, setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import {
  contextSourcePreferenceHydrated,
  issueSuggestionsFailed,
  issueSuggestionsLoaded,
  issueSuggestionRequestKey,
  loadIssueSuggestionsRequested,
  setContextSourcePreference,
} from '../issue-suggestions-slice';
import type {
  ContextSource,
  GitHubIssueSuggestion,
  GitHubPullRequestSuggestion,
  GitHubRelatedRepoSuggestion,
  IssueSuggestion,
} from '../issue-suggestions-types';

type RequestAction = ReturnType<typeof loadIssueSuggestionsRequested>;
export const LAST_CONTEXT_SOURCE_STORAGE_KEY = 'context-picker:last-source';
const CONTEXT_SOURCES: readonly ContextSource[] = [
  'linear',
  'github-issues',
  'github-prs',
  'sentry',
];
interface GitHubUserResult {
  login?: string;
  name?: string;
}

interface GitHubIssueResult {
  id: string;
  number: number;
  title: string;
  body?: string;
  htmlUrl: string;
  state: 'open' | 'closed';
  owner: string;
  repo: string;
  author?: GitHubUserResult;
  assignee?: GitHubUserResult;
  labels?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface GitHubPullRequestResult {
  id?: string;
  number: number;
  title: string;
  description?: string;
  htmlUrl?: string;
  url?: string;
  state: 'open' | 'closed' | 'merged' | 'draft';
  author?: GitHubUserResult;
  assignees?: string[];
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  updatedAt?: string;
  owner?: string;
  repo?: string;
}

interface GitHubRelatedRepoResult {
  owner: string;
  repo: string;
  path?: string;
}

interface WireResult {
  success?: boolean;
  data?:
    | GitHubIssueResult[]
    | GitHubPullRequestResult[]
    | GitHubPullRequestResult
    | GitHubRelatedRepoResult[];
  nextToken?: string | null;
  error?: string;
}

function fetchLinearIssues(
  filter: 'assigned' | 'created',
  options?: LinearIssuePageOptions,
): Promise<LinearIssuePage> {
  return linearAuthClient.fetchMyIssuesPage(filter, options);
}

function searchLinearIssues(
  query: string,
  options?: LinearIssuePageOptions,
): Promise<LinearIssuePage> {
  return linearAuthClient.searchIssuesPage(query, options);
}

function fetchSentryIssues(request?: FetchIssuesRequest): Promise<SentryIssuePage> {
  return sentryAuthClient.fetchIssuesPage(request);
}

function searchSentryIssues(
  query: string,
  options?: { nextToken?: string },
): Promise<SentryIssuePage> {
  return sentryAuthClient.searchIssuesPage(query, undefined, options);
}

function invokeGitHub(channel: string, params: Record<string, unknown>): Promise<WireResult> {
  return invoke<WireResult>(channel, params);
}

function mapGitHubIssue(issue: GitHubIssueResult): GitHubIssueSuggestion {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.htmlUrl,
    state: issue.state,
    owner: issue.owner,
    repo: issue.repo,
    author: issue.author?.name || issue.author?.login,
    assignee: issue.assignee?.name || issue.assignee?.login,
    labels: issue.labels?.join(', '),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function mapPullRequest(
  pr: GitHubPullRequestResult,
  owner: string,
  repo: string,
): GitHubPullRequestSuggestion {
  return {
    id: pr.id ?? `${pr.owner ?? owner}/${pr.repo ?? repo}#${pr.number}`,
    number: pr.number,
    title: pr.title,
    body: pr.description,
    url: pr.htmlUrl ?? pr.url ?? '',
    state: pr.state,
    owner: pr.owner ?? owner,
    repo: pr.repo ?? repo,
    authorLogin: pr.author?.login,
    authorName: pr.author?.name,
    assignees: pr.assignees || [],
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

function* fetchPage(action: RequestAction): SagaGenerator<void> {
  const [source, request, append = false] = action.payload;
  const requestKey = issueSuggestionRequestKey(source, request);
  try {
    let items: IssueSuggestion[] = [];
    let nextToken: string | null = null;
    if (source === 'linear-assigned' || source === 'linear-created') {
      const filter = source === 'linear-assigned' ? 'assigned' : 'created';
      const options = request.nextToken ? { nextToken: request.nextToken } : undefined;
      const page = yield* call(() => fetchLinearIssues(filter, options));
      items = page.issues;
      nextToken = page.nextToken;
    } else if (source === 'linear-search') {
      const page = yield* call(
        searchLinearIssues,
        request.query ?? '',
        request.nextToken ? { nextToken: request.nextToken } : undefined,
      );
      items = page.issues;
      nextToken = page.nextToken;
    } else if (source === 'sentry') {
      const page = request.query
        ? yield* call(
            searchSentryIssues,
            request.query,
            request.nextToken ? { nextToken: request.nextToken } : undefined,
          )
        : yield* call(
            fetchSentryIssues,
            request.nextToken ? { nextToken: request.nextToken } : undefined,
          );
      items = page.issues;
      nextToken = page.nextToken;
    } else {
      const owner = request.owner ?? '';
      const repo = request.repo ?? '';
      const channel =
        source === 'github-related-repos'
          ? 'git-tracking:list-related-repos'
          : source === 'github-issues'
            ? 'git-tracking:search-github-issues'
            : source === 'github-prs'
              ? 'git-tracking:search-pull-requests'
              : 'git-tracking:get-pull-request';
      const params =
        source === 'github-related-repos'
          ? { owner, repo }
          : source === 'github-pr-detail'
            ? { owner, repo, number: request.number }
            : {
                owner,
                repo,
                options: {
                  state: 'open',
                  per_page: source === 'github-issues' ? 20 : 50,
                  filter: request.filter ?? 'all',
                  ...(request.repos?.length ? { repos: request.repos } : {}),
                  ...(request.query ? { query: request.query } : {}),
                  ...(request.nextToken ? { nextToken: request.nextToken } : {}),
                },
              };
      const response = yield* call(invokeGitHub, channel, params);
      if (!response?.success) throw new Error(response?.error ?? 'GitHub request failed');
      if (source === 'github-related-repos') {
        const seen = new Set([`${owner}/${repo}`]);
        items = (Array.isArray(response.data) ? response.data : [])
          .filter((entry): entry is GitHubRelatedRepoResult => 'owner' in entry && 'repo' in entry)
          .filter((entry) => {
            const id = `${entry.owner}/${entry.repo}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .slice(0, 5)
          .map<GitHubRelatedRepoSuggestion>((entry) => ({
            id: `${entry.owner}/${entry.repo}`,
            owner: entry.owner,
            repo: entry.repo,
            path: entry.path,
          }));
      } else if (source === 'github-issues') {
        items = (Array.isArray(response.data) ? response.data : []).map((issue) =>
          mapGitHubIssue(issue as GitHubIssueResult),
        );
      } else if (source === 'github-prs') {
        items = (Array.isArray(response.data) ? response.data : []).map((pull) =>
          mapPullRequest(pull as GitHubPullRequestResult, owner, repo),
        );
      } else if (response.data && !Array.isArray(response.data)) {
        items = [mapPullRequest(response.data, owner, repo)];
      }
      nextToken = typeof response.nextToken === 'string' ? response.nextToken : null;
    }
    yield* put(issueSuggestionsLoaded(requestKey, items, nextToken, append));
  } catch (error) {
    yield* put(
      issueSuggestionsFailed(requestKey, error instanceof Error ? error.message : String(error)),
    );
  }
}

function* hydrateContextSourcePreference(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageItem, LAST_CONTEXT_SOURCE_STORAGE_KEY);
  const source = CONTEXT_SOURCES.includes(stored as ContextSource)
    ? (stored as ContextSource)
    : null;
  yield* put(contextSourcePreferenceHydrated(source));
}

function* persistContextSourcePreference(
  action: ReturnType<typeof setContextSourcePreference>,
): SagaGenerator<void> {
  yield* call(setLocalStorageItem, LAST_CONTEXT_SOURCE_STORAGE_KEY, action.payload[0]);
}

function* watchIssueSuggestionRequests(): SagaGenerator<void> {
  yield* takeLatestInContext(
    loadIssueSuggestionsRequested,
    (action) => action.payload[0],
    fetchPage,
  );
}

export function* issueSuggestionsSaga(): SagaGenerator<void> {
  yield* all([
    call(hydrateContextSourcePreference),
    call(watchIssueSuggestionRequests),
    takeEvery(setContextSourcePreference, persistContextSourcePreference),
  ]);
}
