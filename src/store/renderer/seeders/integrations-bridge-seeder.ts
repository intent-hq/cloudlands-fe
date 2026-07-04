/**
 * Integrations IPC bridge — routes the legacy renderer→main GitHub / Linear /
 * Sentry auth+issue probes to the daemon's `github.*` / `linear.*` /
 * `sentry.*` JSON-RPC namespaces (PROTOCOL §5.27–5.29).
 *
 * The Add-context pane (`IssueSuggestions.svelte`) and the connections
 * settings read these channels directly through `invoke()`, which resolves
 * through the in-memory mock IPC router — so the boot-time fixture stubs that
 * used to live in settings-integrations-seeder.ts made every tab render mock
 * data in the live app. Per the integration principle BE = source of truth:
 * each handler forwards to the canonical daemon RPC and maps the response to
 * the legacy envelope the call sites already consume — never synthesizing
 * data. Failures fold to each channel's unauthenticated/empty legacy default
 * so an unconfigured integration renders the pane's auth hint, not a crash.
 *
 * Handlers are registered at import time (mirroring host-bridge-seeder) so
 * the pane's preload — which fires on the first home-screen mount — already
 * sees daemon-backed answers.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { GITHUB_AUTH_CHANNELS } from '$features/github-auth/constants';
import type {
  GitHubAuthState,
  GitHubAuthStatus,
  GithubRepo,
  StartAuthResult,
} from '$features/github-auth/types';
import { LINEAR_AUTH_CHANNELS } from '$features/linear-auth/constants';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import { SENTRY_AUTH_CHANNELS } from '$features/sentry-auth/constants';
import type {
  SentryAuthState,
  SentryIssueResult,
  SentryProject,
} from '$features/sentry-auth/types';
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveIntegrationsClient } from '$lib/client/live/live-integrations-client';

/** Single mapping point for `github.getUser` → FE `GitHubUser`. */
const liveIntegrations = new LiveIntegrationsClient();

/** Coerce a possibly-unknown argument into a plain object record. */
function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── GitHub auth & identity (PROTOCOL §5.27) ──

/** `github.authStatus` — probes the env PAT via GET /user; null = probe failed. */
async function githubAuthStatus(): Promise<GitHubAuthStatus | null> {
  try {
    return await backendRequest<GitHubAuthStatus>('github.authStatus');
  } catch {
    return null;
  }
}

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.IS_AUTHENTICATED, async () => {
  const status = await githubAuthStatus();
  return status?.isConfigured === true;
});

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.GET_USER, async () => liveIntegrations.githubUser());

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE, async (): Promise<GitHubAuthState> => {
  const status = await githubAuthStatus();
  const isConfigured = status?.isConfigured === true;
  const user = isConfigured ? await liveIntegrations.githubUser() : null;
  return {
    isAuthenticated: isConfigured && user !== null,
    requiresAugmentAuth: false,
    user,
    needsScopeUpdate: status?.configuredButNeedsUpdate === true,
    oauthUrl: undefined,
  };
});

registerMockIpcHandler(
  GITHUB_AUTH_CHANNELS.GET_STATUS,
  async (): Promise<GitHubAuthStatus> =>
    (await githubAuthStatus()) ?? {
      isConfigured: false,
      oauthUrl: '',
      configuredButNeedsUpdate: false,
      updatedScopes: '',
    },
);

// The OAuth-flow channels map onto the PAT-from-env model (§5.27 auth &
// identity): there is no device/OAuth flow to start, poll, or cancel, so
// "start" reports the daemon's `github.connect` guidance when the env PAT is
// absent, "poll" completes as soon as `github.authStatus` validates, and
// logout surfaces the `github.revoke` no-op (the token is environment-owned).

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.START_AUTH, async (): Promise<StartAuthResult> => {
  const status = await githubAuthStatus();
  if (status?.isConfigured === true) {
    return {
      success: true,
      alreadyAuthenticated: true,
      needsScopeUpdate: status.configuredButNeedsUpdate === true,
    };
  }
  try {
    const result = await backendRequest<{ ok?: boolean; guidance?: string }>('github.connect');
    return {
      success: false,
      error:
        result?.guidance ??
        'GitHub is not configured — set GITHUB_TOKEN in the daemon environment.',
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.POLL_FOR_TOKEN, async () => {
  const status = await githubAuthStatus();
  const isComplete = status?.isConfigured === true;
  const user = isComplete ? await liveIntegrations.githubUser() : null;
  return { success: true, data: { user, isComplete } };
});

// Nothing is in flight in the PAT model — cancel is a successful no-op.
registerMockIpcHandler(GITHUB_AUTH_CHANNELS.CANCEL_AUTH, async () => ({ success: true }));

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.LOGOUT, async () => {
  try {
    return await backendRequest('github.revoke');
  } catch (error) {
    return { ok: false, guidance: errorMessage(error) };
  }
});

// ── GitHub repos (PROTOCOL §5.27 repos & branches) ──

/** Daemon `GithubRepo` — camelCase on the wire (§5.27 field naming). */
interface GithubRepoWire {
  owner: string;
  name: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  defaultBranch?: string;
}

/** Map the wire repo to the FE's legacy snake_case `GithubRepo`. */
function toLegacyRepo(repo: GithubRepoWire): GithubRepo {
  return {
    owner: repo.owner,
    name: repo.name,
    html_url: repo.htmlUrl,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    default_branch: repo.defaultBranch,
  };
}

// The legacy channel pages with `{ page }`; the daemon paginates with an
// opaque `nextToken` cursor, so the first daemon page (default limit 50)
// serves every legacy page request.
registerMockIpcHandler(GITHUB_AUTH_CHANNELS.LIST_REPOS, async () => {
  try {
    const result = await backendRequest<{ repos?: GithubRepoWire[] }>('github.repos.list');
    return { success: true, data: (result?.repos ?? []).map(toLegacyRepo) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

registerMockIpcHandler(GITHUB_AUTH_CHANNELS.SEARCH_REPOS, async (arg) => {
  const query = asRecord(arg).query;
  if (typeof query !== 'string' || query.length === 0) {
    return { success: false, error: 'query is required' };
  }
  try {
    const result = await backendRequest<{ repos?: GithubRepoWire[] }>('github.repos.search', {
      query,
    });
    return { success: true, data: (result?.repos ?? []).map(toLegacyRepo) };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── GitHub issues & PRs for the Add-context pane (PROTOCOL §5.27) ──

/** Daemon `GithubUser` — derived identity only (§5.27). */
interface GithubUserWire {
  login: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

/** Daemon `GithubIssue` (§5.27 DTO schemas). */
interface GithubIssueWire {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  user?: GithubUserWire;
  labels?: string[];
  owner?: string;
  repo?: string;
}

/** Daemon `GithubPullRequest` (§5.27 DTO schemas — subset the pane consumes). */
interface GithubPullWire {
  number: number;
  title: string;
  body?: string;
  state: string;
  htmlUrl: string;
  createdAt?: string;
  updatedAt?: string;
  user?: GithubUserWire;
  headRef?: string;
  baseRef?: string;
  merged?: boolean;
  draft?: boolean;
  assignees?: GithubUserWire[];
}

/** Legacy search params sent by IssueSuggestions: `{ owner, repo, options }`. */
function searchParams(arg: unknown): {
  owner: string;
  repo: string;
  filter?: string;
  state?: string;
  limit?: number;
} | null {
  const params = asRecord(arg);
  const owner = params.owner;
  const repo = params.repo;
  if (typeof owner !== 'string' || !owner || typeof repo !== 'string' || !repo) return null;
  const options = asRecord(params.options);
  return {
    owner,
    repo,
    filter: typeof options.filter === 'string' ? options.filter : undefined,
    state: typeof options.state === 'string' ? options.state : undefined,
    limit: typeof options.per_page === 'number' ? options.per_page : undefined,
  };
}

// `git-tracking:search-github-issues` → daemon `github.issues.search`. The
// pane maps `{ id, htmlUrl, author.login, labels[] }`; the wire keys issues by
// `number` (no separate id), so `id` echoes the number.
registerMockIpcHandler(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, async (arg) => {
  const params = searchParams(arg);
  if (!params) return { success: false, error: 'owner and repo are required' };
  try {
    const result = await backendRequest<{ issues?: GithubIssueWire[] }>(
      'github.issues.search',
      params,
    );
    const data = (result?.issues ?? []).map((issue) => ({
      id: String(issue.number),
      number: issue.number,
      title: issue.title,
      body: issue.body,
      htmlUrl: issue.htmlUrl,
      state: issue.state,
      owner: issue.owner ?? params.owner,
      repo: issue.repo ?? params.repo,
      author: issue.user ? { login: issue.user.login } : undefined,
      labels: issue.labels ?? [],
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// `git-tracking:search-pull-requests` → daemon `github.pulls.search`. The pane
// renders a single `state: open|closed|merged|draft`, which the wire carries
// as `state` + `merged` + `draft` booleans.
registerMockIpcHandler(IPC_CHANNELS.GIT_TRACKING.SEARCH_PULL_REQUESTS, async (arg) => {
  const params = searchParams(arg);
  if (!params) return { success: false, error: 'owner and repo are required' };
  try {
    const result = await backendRequest<{ pulls?: GithubPullWire[] }>(
      'github.pulls.search',
      params,
    );
    const data = (result?.pulls ?? []).map((pull) => ({
      id: String(pull.number),
      number: pull.number,
      title: pull.title,
      description: pull.body,
      htmlUrl: pull.htmlUrl,
      state: pull.merged === true ? 'merged' : pull.draft === true ? 'draft' : pull.state,
      author: pull.user ? { login: pull.user.login } : undefined,
      assignees: (pull.assignees ?? []).map((user) => user.login),
      sourceBranch: pull.headRef,
      targetBranch: pull.baseRef,
      createdAt: pull.createdAt,
      updatedAt: pull.updatedAt,
    }));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// `git-tracking:get-pull-request` → daemon `github.pulls.get`. The pickers
// call this for one PR's branch info (the search API omits head/base refs);
// they consume `data.sourceBranch` / `data.targetBranch`.
registerMockIpcHandler(IPC_CHANNELS.GIT_TRACKING.GET_PULL_REQUEST, async (arg) => {
  const params = asRecord(arg);
  const { owner, repo, number } = params;
  if (typeof owner !== 'string' || !owner || typeof repo !== 'string' || !repo) {
    return { success: false, error: 'owner and repo are required' };
  }
  if (typeof number !== 'number') {
    return { success: false, error: 'number is required' };
  }
  try {
    const result = await backendRequest<{ pull?: GithubPullWire | null }>('github.pulls.get', {
      owner,
      repo,
      number,
    });
    const pull = result?.pull;
    if (!pull) return { success: false, error: `Pull request #${number} not found` };
    return {
      success: true,
      data: {
        number: pull.number,
        title: pull.title,
        state: pull.merged === true ? 'merged' : pull.draft === true ? 'draft' : pull.state,
        url: pull.htmlUrl,
        sourceBranch: pull.headRef,
        targetBranch: pull.baseRef,
      },
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
});

// ── Linear (PROTOCOL §5.28 — bare results, no envelope) ──

/** `linear.authStatus` probe → boolean; a failed probe is "not connected". */
async function linearAuthenticated(): Promise<boolean> {
  try {
    const status = await backendRequest<{ authenticated?: boolean }>('linear.authStatus');
    return status?.authenticated === true;
  } catch {
    return false;
  }
}

registerMockIpcHandler(LINEAR_AUTH_CHANNELS.IS_AUTHENTICATED, () => linearAuthenticated());

// There is no Linear OAuth flow in the env-key model (§5.28): `oauthUrl` is
// omitted and `requiresAugmentAuth` is always false — connect = set
// LINEAR_API_KEY and restart.
registerMockIpcHandler(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE, async () => ({
  isAuthenticated: await linearAuthenticated(),
  requiresAugmentAuth: false,
}));

registerMockIpcHandler(LINEAR_AUTH_CHANNELS.GET_STATUS, async () => ({
  isConfigured: await linearAuthenticated(),
  oauthUrl: '',
}));

// `fetchMyIssues(filter)` passes the filter positionally; the daemon takes it
// as `{ filter }` and returns the flattened LinearIssueResult[] verbatim.
registerMockIpcHandler(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, async (filter) => {
  try {
    const params = typeof filter === 'string' && filter ? { filter } : {};
    const issues = await backendRequest<LinearIssueResult[]>('linear.listIssues', params);
    return Array.isArray(issues) ? issues : [];
  } catch {
    return [];
  }
});

registerMockIpcHandler(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, async (query) => {
  if (typeof query !== 'string' || query.length === 0) return [];
  try {
    const issues = await backendRequest<LinearIssueResult[]>('linear.searchIssues', { query });
    return Array.isArray(issues) ? issues : [];
  } catch {
    return [];
  }
});

// ── Sentry (PROTOCOL §5.29 — bare results, no envelope) ──

/** Daemon `sentry.authStatus` result — derived identity only, never the token. */
interface SentryAuthStatusWire {
  authenticated?: boolean;
  organization?: string;
  error?: string;
}

/** `sentry.authStatus` probe; null = probe failed ("not connected"). */
async function sentryAuthStatus(): Promise<SentryAuthStatusWire | null> {
  try {
    return await backendRequest<SentryAuthStatusWire>('sentry.authStatus');
  } catch {
    return null;
  }
}

registerMockIpcHandler(SENTRY_AUTH_CHANNELS.IS_AUTHENTICATED, async () => {
  const status = await sentryAuthStatus();
  return status?.authenticated === true;
});

registerMockIpcHandler(SENTRY_AUTH_CHANNELS.GET_AUTH_STATE, async (): Promise<SentryAuthState> => {
  const status = await sentryAuthStatus();
  return {
    isAuthenticated: status?.authenticated === true,
    organization: status?.organization,
    error: status?.error,
  };
});

registerMockIpcHandler(SENTRY_AUTH_CHANNELS.FETCH_PROJECTS, async () => {
  try {
    const projects = await backendRequest<SentryProject[]>('sentry.listProjects');
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
});

// `fetchIssues(request?)` forwards the FE `FetchIssuesRequest` fields, which
// map 1:1 onto the daemon's `{ project?, status?, query?, limit? }` params.
registerMockIpcHandler(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, async (request) => {
  const { project, status, query, limit } = asRecord(request);
  try {
    const issues = await backendRequest<SentryIssueResult[]>('sentry.listIssues', {
      ...(typeof project === 'string' && project ? { project } : {}),
      ...(typeof status === 'string' && status ? { status } : {}),
      ...(typeof query === 'string' && query ? { query } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    });
    return Array.isArray(issues) ? issues : [];
  } catch {
    return [];
  }
});

registerMockIpcHandler(SENTRY_AUTH_CHANNELS.SEARCH_ISSUES, async (arg) => {
  const { query, project } = asRecord(arg);
  if (typeof query !== 'string' || query.length === 0) return [];
  try {
    const issues = await backendRequest<SentryIssueResult[]>('sentry.searchIssues', {
      query,
      ...(typeof project === 'string' && project ? { project } : {}),
    });
    return Array.isArray(issues) ? issues : [];
  } catch {
    return [];
  }
});
