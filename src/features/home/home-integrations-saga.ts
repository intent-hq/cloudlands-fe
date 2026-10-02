import { all, call, delay, put, select, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { openExternalUrl } from '$lib/utils/open-external';
import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';
import { mutationErrorMessage } from '$lib/client/live/live-support';
import {
  captureIntegrationContext,
  integrationReconnectSettled,
} from '$features/integrations-request-context';
import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  setGitHubAuthState,
  logoutGitHub,
} from '$store/renderer/slices/github-auth/github-auth-slice';
import {
  setLinearAuthState,
  logoutLinear,
} from '$store/renderer/slices/linear-auth/linear-auth-slice';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import type {
  HomeIntegrationItem,
  IntegrationRepository,
  HomeIntegrationsState,
  HomeReviewComment,
  HomePullFile,
  HomePullReview,
  HomePullCheck,
} from './home-integrations-types';
import { selectHomeWorkspaceView } from './home-workspaces-selectors';
import { selectHomeIntegrations } from './home-integrations-selectors';
import {
  mountHomeIntegrations,
  unmountHomeIntegrations,
  suspendHomeIntegrations,
  searchHomeIntegrations,
  refreshHomeIntegrations,
  loadMoreHomeIntegrations,
  selectHomeIntegration,
  loadHomeReviewComments,
  loadHomePullFiles,
  loadHomePullReviewData,
  loadHomePullChecks,
  startHomeIntegrationWorkspace,
  patchHomeIntegrations,
  openHomeIntegrationUrl,
} from './home-integrations-slice';

interface PullWire {
  number: number;
  title: string;
  body?: string;
  htmlUrl: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  user?: { login: string };
  updatedAt?: string;
  labels?: string[];
  owner?: string;
  repo?: string;
  headRef?: string;
  baseRef?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}
function pullItem(pull: PullWire, owner: string, repo: string): HomeIntegrationItem {
  const address = { owner: pull.owner ?? owner, repo: pull.repo ?? repo };
  return {
    id: `${address.owner}/${address.repo}#${pull.number}`,
    ...address,
    number: pull.number,
    identifier: `#${pull.number}`,
    title: pull.title,
    url: pull.htmlUrl,
    description: pull.body,
    state: pull.merged ? 'merged' : pull.draft ? 'draft' : pull.state,
    author: pull.user?.login,
    updatedAt: pull.updatedAt,
    labels: pull.labels,
    headRef: pull.headRef,
    baseRef: pull.baseRef,
    // Legacy pulls projections hardcode these statistics to zero. Real totals
    // are only populated from a complete files read below.
  };
}
function issueItem(issue: LinearIssueResult): HomeIntegrationItem {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url ?? '',
    description: issue.description,
    state: issue.state,
    author: issue.creator,
    updatedAt: issue.updatedAt,
    labels: issue.labels,
    team: issue.teamName ?? issue.teamKey,
    priority: issue.priority,
    assignee: issue.assignee,
    project: issue.project,
  };
}
const message = mutationErrorMessage;

// Installed daemons report absent Linear credentials as an Internal error whose
// data/detail names the missing configuration, rather than authenticated: false.
function isLinearNotConfigured(error: unknown): boolean {
  return /^(?:Internal error: )?linear(?: is)? not configured(?::|\.|$)/i.test(message(error));
}
function repositories(state: HomeIntegrationsState) {
  const unique = new Map<string, { owner: string; repo: string }>();
  for (const repo of (state.organizationRepositories
    ? Object.values(state.organizationRepositories)
    : state.scope?.repositories) ?? []) {
    if (repo.owner)
      unique.set(`${repo.owner}/${repo.name}`.toLowerCase(), {
        owner: repo.owner,
        repo: repo.name,
      });
  }
  const values = [...unique.values()];
  return Array.from({ length: Math.ceil(values.length / 6) }, (_, index) =>
    values.slice(index * 6, index * 6 + 6),
  );
}
async function organizationRepositories(
  organization: string,
  workspaceId: string | undefined,
  isCurrent: () => boolean,
): Promise<Record<string, IntegrationRepository>> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(organization))
    throw new Error(m.home_integrations_org_scope_incomplete());
  const repos = new Map<string, IntegrationRepository>();
  const seen = new Set<string>();
  let nextToken: string | undefined;
  let received = 0;
  let pages = 0;
  do {
    if (!isCurrent()) throw new Error('Organization search cancelled');
    const page = await backendRequest<{
      repos: { owner: string; name: string }[];
      nextToken?: string | null;
    }>('github.repos.search', {
      query: `user:${organization} fork:true`,
      limit: 100,
      workspaceId,
      ...(nextToken ? { nextToken } : {}),
    });
    received += page.repos.length;
    pages++;
    for (const repo of page.repos) {
      if (!repo.owner || !repo.name || repo.owner.toLowerCase() !== organization.toLowerCase())
        throw new Error(m.home_integrations_org_scope_incomplete());
      const key = `${repo.owner}/${repo.name}`.toLowerCase();
      repos.set(key, { key, owner: repo.owner, name: repo.name });
    }
    nextToken = page.nextToken ?? undefined;
    // GitHub search exposes at most 1000 hits, even if further repositories exist.
    if (received >= 1000 || (nextToken && (seen.has(nextToken) || pages >= 10)))
      throw new Error(m.home_integrations_org_scope_incomplete());
    if (nextToken) seen.add(nextToken);
  } while (nextToken);
  return Object.fromEntries(repos);
}
async function fetchPage(state: HomeIntegrationsState, more: boolean, isCurrent: () => boolean) {
  const scope = state.scope!;
  const params = { workspaceId: scope.workspaceId, limit: 30 };
  if (scope.kind === 'linear') {
    const response = await backendRequest<{
      issues: LinearIssueResult[];
      nextToken?: string | null;
    }>(state.query.trim() ? 'linear.searchIssues' : 'linear.listIssues', {
      ...params,
      ...(state.query.trim() ? { query: state.query.trim() } : { filter: state.filter }),
      ...(more ? { nextToken: state.cursors[0] } : {}),
    });
    return { items: response.issues.map(issueItem), cursors: [response.nextToken ?? null] };
  }
  const organization = scope.organization?.trim();
  if (organization && !state.organizationRepositories) {
    try {
      const response = await backendRequest<{ pulls: PullWire[]; nextToken?: string | null }>(
        'github.pulls.search',
        {
          ...params,
          org: organization,
          filter: state.filter,
          state: state.closed ? 'closed' : 'open',
          query: state.query.trim() || undefined,
          ...(more ? { nextToken: state.cursors[0] } : {}),
        },
      );
      return {
        items: response.pulls.map((pull) => pullItem(pull, organization, pull.repo ?? '')),
        cursors: [response.nextToken ?? null],
      };
    } catch (error) {
      if (!/Missing required parameter: owner(?:\b|$)/i.test(message(error))) throw error;
      const complete = await organizationRepositories(organization, scope.workspaceId, isCurrent);
      state = { ...state, organizationRepositories: complete };
    }
  }
  const items: HomeIntegrationItem[] = [];
  const cursors: (string | null)[] = [];
  for (const [index, batch] of repositories(state).entries()) {
    if (!isCurrent()) throw new Error('Organization search cancelled');
    if (more && !state.cursors[index]) {
      cursors.push(null);
      continue;
    }
    const [first, ...extras] = batch;
    const response = await backendRequest<{ pulls: PullWire[]; nextToken?: string | null }>(
      'github.pulls.search',
      {
        ...params,
        ...first,
        repos: extras,
        filter: state.filter,
        state: state.closed ? 'closed' : 'open',
        query: state.query.trim() || undefined,
        ...(more ? { nextToken: state.cursors[index] } : {}),
      },
    );
    items.push(...response.pulls.map((pull) => pullItem(pull, first.owner, first.repo)));
    cursors.push(response.nextToken ?? null);
  }
  return { items, cursors, organizationRepositories: state.organizationRepositories };
}
// Short-lived, account/connection-scoped list cache. Detail stays independently fetched.
const listCache = new Map<
  string,
  {
    at: number;
    page: Pick<HomeIntegrationsState, 'items' | 'cursors' | 'organizationRepositories'>;
  }
>();
function* listWorker(action: { type: string }): SagaGenerator<void> {
  if (action.type === unmountHomeIntegrations.type || action.type === suspendHomeIntegrations.type)
    return;
  const state = yield* select(selectHomeIntegrations.select);
  if (!state.scope) return;
  const generation = state.generation;
  yield* call(integrationReconnectSettled);
  const context = captureIntegrationContext(state.scope.workspaceId);
  const more = action.type === loadMoreHomeIntegrations.type;
  const preferences = yield* select(selectHomeWorkspaceView.select);
  const cacheKey = JSON.stringify([
    context.key,
    preferences.persistenceScope,
    state.scope,
    state.query,
    state.filter,
    state.closed,
  ]);
  const cached = listCache.get(cacheKey);
  if (
    !more &&
    action.type !== refreshHomeIntegrations.type &&
    cached &&
    Date.now() - cached.at < 120_000
  ) {
    yield* put(
      patchHomeIntegrations(generation, {
        ...cached.page,
        status: 'ready',
        loadingMore: false,
        error: null,
      }),
    );
    return;
  }

  if (more && !state.cursors.some(Boolean)) return;
  if (more) yield* put(patchHomeIntegrations(generation, { loadingMore: true, error: null }));
  if (action.type === searchHomeIntegrations.type) yield* delay(350);
  let active = true;
  try {
    if (
      state.scope.kind === 'prs' &&
      !state.scope.organization?.trim() &&
      !repositories(state).length
    ) {
      yield* put(
        patchHomeIntegrations(generation, {
          status: 'ready',
          items: [],
          cursors: [],
          loadingMore: false,
        }),
      );
      return;
    }
    const auth = yield* call(
      backendRequest<{ isConfigured?: boolean; authenticated?: boolean }>,
      state.scope.kind === 'prs' ? 'github.authStatus' : 'linear.authStatus',
      { workspaceId: state.scope.workspaceId },
    );
    if (!context.isCurrent()) return;
    if (!(auth.isConfigured ?? auth.authenticated)) {
      yield* put(
        patchHomeIntegrations(generation, {
          status: 'disconnected',
          loadingMore: false,
          items: [],
          cursors: [],
          selectedId: null,
          detail: null,
        }),
      );
      return;
    }
    const page = yield* call(fetchPage, state, more, () => active && context.isCurrent());
    if (!context.isCurrent()) return;
    const items = [
      ...new Map(
        [...(more ? state.items : []), ...page.items].map((item) => [item.id, item]),
      ).values(),
    ].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    listCache.delete(cacheKey);
    listCache.set(cacheKey, {
      at: Date.now(),
      page: {
        items,
        cursors: page.cursors,
        organizationRepositories: page.organizationRepositories,
      },
    });
    if (listCache.size > 20) listCache.delete(listCache.keys().next().value!);
    yield* put(
      patchHomeIntegrations(generation, {
        status: 'ready',
        items,
        cursors: page.cursors,
        organizationRepositories:
          'organizationRepositories' in page ? page.organizationRepositories : undefined,
        loadingMore: false,
        error: null,
      }),
    );
  } catch (error) {
    if (context.isCurrent() && state.scope.kind === 'linear' && isLinearNotConfigured(error)) {
      yield* put(
        patchHomeIntegrations(generation, {
          status: 'disconnected',
          error: null,
          loadingMore: false,
          items: [],
          cursors: [],
          selectedId: null,
          detail: null,
          detailLoading: false,
          comments: [],
          commentsCursor: null,
          commentsError: null,
        }),
      );
      return;
    }
    if (context.isCurrent())
      yield* put(
        patchHomeIntegrations(generation, {
          status: more ? 'ready' : 'error',
          loadingMore: false,
          error: message(error),
        }),
      );
  } finally {
    active = false;
  }
}
function* commentsWorker(): SagaGenerator<void> {
  const state = yield* select(selectHomeIntegrations.select);
  const item = state.detail ?? state.items.find((entry) => entry.id === state.selectedId);
  if (!item?.number || !state.scope || state.commentsLoading) return;
  const context = captureIntegrationContext(state.scope.workspaceId);
  yield* put(
    patchHomeIntegrations(state.generation, { commentsLoading: true, commentsError: null }),
  );
  try {
    const response = yield* call(
      backendRequest<{ comments: HomeReviewComment[]; nextToken?: string | null }>,
      'github.listReviewComments',
      {
        owner: item.owner,
        repo: item.repo,
        number: item.number,
        workspaceId: state.scope.workspaceId,
        limit: 30,
        nextToken: state.commentsCursor ?? undefined,
      },
    );
    const current = yield* select(selectHomeIntegrations.select);
    if (context.isCurrent() && current.selectedId === item.id)
      yield* put(
        patchHomeIntegrations(state.generation, {
          comments: [
            ...new Map(
              [...state.comments, ...response.comments].map((comment) => [comment.id, comment]),
            ).values(),
          ],
          commentsCursor: response.nextToken ?? null,
          commentsLoading: false,
        }),
      );
  } catch (error) {
    const current = yield* select(selectHomeIntegrations.select);
    if (context.isCurrent() && current.selectedId === item.id)
      yield* put(
        patchHomeIntegrations(state.generation, {
          commentsLoading: false,
          commentsError: message(error),
        }),
      );
  }
}
function* detailWorker(action: { type: string }): SagaGenerator<void> {
  if (action.type !== selectHomeIntegration.type) return;
  const state = yield* select(selectHomeIntegrations.select);
  const item = state.items.find((entry) => entry.id === state.selectedId);
  if (!item || !state.scope) return;
  const context = captureIntegrationContext(state.scope.workspaceId);
  try {
    let detail: HomeIntegrationItem;
    if (state.scope.kind === 'prs') {
      const response = yield* call(backendRequest<{ pull: PullWire | null }>, 'github.pulls.get', {
        owner: item.owner,
        repo: item.repo,
        number: item.number,
        workspaceId: state.scope.workspaceId,
      });
      if (!response.pull) throw new Error('Pull request is no longer available.'); // i18n-ignore (wire-error normalization)
      detail = pullItem(response.pull, item.owner!, item.repo!);
    } else {
      const response = yield* call(backendRequest<LinearIssueResult>, 'linear.getIssue', {
        id: item.id,
        workspaceId: state.scope.workspaceId,
      });
      detail = issueItem(response);
    }
    if (!context.isCurrent()) return;
    yield* put(patchHomeIntegrations(state.generation, { detail, detailLoading: false }));
  } catch (error) {
    if (context.isCurrent())
      yield* put(
        patchHomeIntegrations(state.generation, {
          detailError: message(error),
          detailLoading: false,
        }),
      );
  }
}
const emptyReviewData = { headSha: '', checks: [], reviews: [], requestedReviewers: [] };
function readError(error: unknown): string {
  const text = message(error);
  return /method not found|-32601|unsupported/i.test(text)
    ? m.home_integrations_read_upgrade()
    : text;
}
function pullAddress(state: HomeIntegrationsState) {
  const item = state.items.find((entry) => entry.id === state.selectedId);
  if (state.scope?.kind !== 'prs' || !item?.owner || !item.repo || !item.number) return null;
  return {
    owner: item.owner,
    repo: item.repo,
    number: item.number,
    workspaceId: state.scope.workspaceId,
  };
}
function* checksWorker(): SagaGenerator<void> {
  const state = yield* select(selectHomeIntegrations.select);
  const address = pullAddress(state);
  if (!address) return;
  const context = captureIntegrationContext(address.workspaceId);
  yield* put(patchHomeIntegrations(state.generation, { checksLoading: true, checksError: null }));
  try {
    const response = yield* call(
      backendRequest<{ headSha: string; checks: HomePullCheck[] }>,
      'github.pulls.checks',
      address,
    );
    if (!context.isCurrent()) return;
    const current = yield* select(selectHomeIntegrations.select);
    yield* put(
      patchHomeIntegrations(state.generation, {
        checksLoading: false,
        reviewData: { ...(current.reviewData ?? emptyReviewData), ...response },
      }),
    );
  } catch (error) {
    if (context.isCurrent())
      yield* put(
        patchHomeIntegrations(state.generation, {
          checksLoading: false,
          checksError: readError(error),
        }),
      );
  }
}
function* reviewsWorker(): SagaGenerator<void> {
  const state = yield* select(selectHomeIntegrations.select);
  const address = pullAddress(state);
  if (!address) return;
  const context = captureIntegrationContext(address.workspaceId);
  yield* put(patchHomeIntegrations(state.generation, { reviewLoading: true, reviewError: null }));
  try {
    const response = yield* call(
      backendRequest<{ reviews: HomePullReview[]; nextToken?: string | null }>,
      'github.pulls.reviews',
      { ...address, limit: 50, ...(state.reviewsCursor ? { nextToken: state.reviewsCursor } : {}) },
    );
    if (!context.isCurrent()) return;
    const current = yield* select(selectHomeIntegrations.select);
    const reviews = [
      ...new Map(
        [
          ...(state.reviewsCursor ? (current.reviewData?.reviews ?? []) : []),
          ...response.reviews,
        ].map((review) => [review.id, review]),
      ).values(),
    ];
    yield* put(
      patchHomeIntegrations(state.generation, {
        reviewLoading: false,
        reviewsCursor: response.nextToken ?? null,
        reviewData: { ...(current.reviewData ?? emptyReviewData), reviews },
      }),
    );
  } catch (error) {
    if (context.isCurrent())
      yield* put(
        patchHomeIntegrations(state.generation, {
          reviewLoading: false,
          reviewError: readError(error),
        }),
      );
  }
}
function* filesWorker(): SagaGenerator<void> {
  const state = yield* select(selectHomeIntegrations.select);
  const address = pullAddress(state);
  if (!address) return;
  const context = captureIntegrationContext(address.workspaceId);
  yield* put(patchHomeIntegrations(state.generation, { filesLoading: true, filesError: null }));
  try {
    const response = yield* call(
      backendRequest<{
        headSha: string;
        truncated: boolean;
        files: HomePullFile[];
        nextToken?: string | null;
      }>,
      'github.pulls.files',
      {
        ...address,
        limit: 50,
        ...(state.filesCursor
          ? { nextToken: state.filesCursor, expectedHeadSha: state.filesHeadSha }
          : {}),
      },
    );
    if (!context.isCurrent()) return;
    const current = yield* select(selectHomeIntegrations.select);
    if (state.filesHeadSha && response.headSha !== state.filesHeadSha) {
      yield* put(
        patchHomeIntegrations(state.generation, {
          files: [],
          filesCursor: null,
          filesHeadSha: null,
          filesLoading: false,
          filesError: m.home_integrations_pr_head_changed(),
        }),
      );
      return;
    }
    const files = [
      ...new Map(
        [...(state.filesCursor ? state.files : []), ...response.files].map((file) => [
          file.filename,
          file,
        ]),
      ).values(),
    ];
    const totals =
      response.nextToken || response.truncated
        ? {}
        : {
            additions: files.reduce((sum, file) => sum + file.additions, 0),
            deletions: files.reduce((sum, file) => sum + file.deletions, 0),
            changedFiles: files.length,
          };
    yield* put(
      patchHomeIntegrations(state.generation, {
        files,
        filesCursor: response.nextToken ?? null,
        filesHeadSha: response.headSha,
        filesTruncated: response.truncated,
        filesLoading: false,
        reviewData: { ...(current.reviewData ?? emptyReviewData), ...totals },
        items: current.items.map((item) =>
          item.id === state.selectedId ? { ...item, ...totals } : item,
        ),
      }),
    );
  } catch (error) {
    if (context.isCurrent())
      yield* put(
        patchHomeIntegrations(
          state.generation,
          /conflict|head.*changed/i.test(message(error))
            ? {
                files: [],
                filesCursor: null,
                filesHeadSha: null,
                filesLoading: false,
                filesError: m.home_integrations_pr_head_changed(),
              }
            : { filesLoading: false, filesError: readError(error) },
        ),
      );
  }
}
/** Selection owns both detail reads and its pagination watcher, so resets cancel all three. */
function* selectionWorker(action: { type: string }): SagaGenerator<void> {
  if (action.type !== selectHomeIntegration.type) return;
  const state = yield* select(selectHomeIntegrations.select);
  if (!state.selectedId) return;
  yield* all([
    call(detailWorker, action),
    call(commentsWorker),
    call(checksWorker),
    call(reviewsWorker),
    takeLatest(loadHomePullFiles, filesWorker),
    takeLatest(loadHomePullReviewData, reviewsWorker),
    takeLatest(loadHomePullChecks, checksWorker),
    takeLatest(loadHomeReviewComments, commentsWorker),
  ]);
}
const authSnapshots = new Map<string, string>();
function* invalidateWorker(action: { type: string; payload?: unknown }): SagaGenerator<void> {
  if (action.type === setGitHubAuthState.type || action.type === setLinearAuthState.type) {
    const snapshot = JSON.stringify(action.payload);
    if (authSnapshots.get(action.type) === snapshot) return;
    authSnapshots.set(action.type, snapshot);
  } else {
    authSnapshots.clear();
  }
  listCache.clear();
  const state = yield* select(selectHomeIntegrations.select);
  if (state.scope)
    yield* put(
      action.type === logoutGitHub.type || action.type === logoutLinear.type
        ? suspendHomeIntegrations()
        : refreshHomeIntegrations(),
    );
}
function* workspaceWorker(): SagaGenerator<void> {
  if (yield* select(selectIsCollaboratorOnlyClient.select)) return;
  const state = yield* select(selectHomeIntegrations.select);
  const item = state.detail;
  if (!item) return;
  if (item.owner && item.repo && item.number) {
    if (!item.headRef?.trim()) {
      yield* put(
        patchHomeIntegrations(state.generation, {
          detailError: m.workspace_branchSelector_fetchBranchesFailed_error(),
        }),
      );
      return;
    }
    yield* put(
      setWorkspaceInitializerPendingGitHubPrefill({
        owner: item.owner,
        repo: item.repo,
        number: item.number,
        kind: 'pr',
        url: item.url,
        sourceBranch: item.headRef,
        targetBranch: item.baseRef,
        title: item.title,
      }),
    );
  } else {
    // Existing initializer prefill seam; opening the form never creates a workspace.
    yield* call(() =>
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({
          title: item.title,
          prompt: `${item.identifier}: ${item.title}\n${item.url}\n\n${item.description ?? ''}`,
        }),
      ),
    );
  }
  yield* put(setShowCreateModal(true));
}
function* openUrlWorker(action: ReturnType<typeof openHomeIntegrationUrl>): SagaGenerator<void> {
  try {
    yield* call(openExternalUrl, action.payload[0]);
  } catch (error) {
    const state = yield* select(selectHomeIntegrations.select);
    yield* put(patchHomeIntegrations(state.generation, { error: message(error) }));
  }
}
export function* homeIntegrationsSaga(): SagaGenerator<void> {
  const resets = [
    suspendHomeIntegrations,
    mountHomeIntegrations,
    unmountHomeIntegrations,
    searchHomeIntegrations,
    refreshHomeIntegrations,
  ];
  yield* all([
    takeLatest([...resets, loadMoreHomeIntegrations], listWorker),
    takeLatest([...resets, selectHomeIntegration], selectionWorker),
    takeLatest(
      [backendReconnected, setGitHubAuthState, logoutGitHub, setLinearAuthState, logoutLinear],
      invalidateWorker,
    ),
    takeLatest(startHomeIntegrationWorkspace, workspaceWorker),
    takeLatest(openHomeIntegrationUrl, openUrlWorker),
  ]);
}
