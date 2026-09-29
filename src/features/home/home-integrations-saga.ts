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
  HomeIntegrationsState,
  HomeReviewComment,
} from './home-integrations-types';
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
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
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
  for (const repo of state.scope?.repositories ?? []) {
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
async function fetchPage(state: HomeIntegrationsState, more: boolean) {
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
  const items: HomeIntegrationItem[] = [];
  const cursors: (string | null)[] = [];
  for (const [index, batch] of repositories(state).entries()) {
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
  return { items, cursors };
}
function* listWorker(action: { type: string }): SagaGenerator<void> {
  if (action.type === unmountHomeIntegrations.type || action.type === suspendHomeIntegrations.type)
    return;
  const state = yield* select(selectHomeIntegrations.select);
  if (!state.scope) return;
  const generation = state.generation;
  yield* call(integrationReconnectSettled);
  const context = captureIntegrationContext(state.scope.workspaceId);
  const more = action.type === loadMoreHomeIntegrations.type;
  if (more && !state.cursors.some(Boolean)) return;
  if (more) yield* put(patchHomeIntegrations(generation, { loadingMore: true, error: null }));
  if (action.type === searchHomeIntegrations.type) yield* delay(350);
  try {
    if (state.scope.kind === 'prs' && !repositories(state).length) {
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
    const page = yield* call(fetchPage, state, more);
    if (!context.isCurrent()) return;
    const items = [
      ...new Map(
        [...(more ? state.items : []), ...page.items].map((item) => [item.id, item]),
      ).values(),
    ].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    yield* put(
      patchHomeIntegrations(generation, {
        status: 'ready',
        items,
        cursors: page.cursors,
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
/** Selection owns both detail reads and its pagination watcher, so resets cancel all three. */
function* selectionWorker(action: { type: string }): SagaGenerator<void> {
  if (action.type !== selectHomeIntegration.type) return;
  const state = yield* select(selectHomeIntegrations.select);
  if (!state.selectedId) return;
  yield* all([
    call(detailWorker, action),
    call(commentsWorker),
    takeLatest(loadHomeReviewComments, commentsWorker),
  ]);
}
function* invalidateWorker(action: { type: string }): SagaGenerator<void> {
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
