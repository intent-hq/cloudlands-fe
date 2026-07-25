/**
 * Wire-contract tests for the integrations IPC bridge seeder.
 *
 * Regression: the Add-context pane's direct `invoke()` reads (Linear/Sentry
 * auth + issues, GitHub identity/repos, git-tracking GH issue/PR search)
 * resolved to boot-time mock fixtures, so every tab rendered mock data in the
 * live app. Asserts each legacy channel (a) forwards to the canonical daemon
 * JSON-RPC method with the right params (PROTOCOL §5.27–5.29) and (b) maps
 * the PROTOCOL-shaped response to the exact legacy envelope the call sites
 * (IssueSuggestions, linear/sentry/github auth clients) already consume.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { GITHUB_AUTH_CHANNELS } from '$features/github-auth/constants';
import { LINEAR_AUTH_CHANNELS } from '$features/linear-auth/constants';
import { SENTRY_AUTH_CHANNELS } from '$features/sentry-auth/constants';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.27 wire GithubUser — derived identity only. */
const WIRE_USER = {
  login: 'octocat',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  htmlUrl: 'https://github.com/octocat',
};

describe('integrations-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./integrations-bridge-seeder');
  });

  afterEach(() => vi.clearAllMocks());

  describe('linear-auth:* → daemon linear.* (PROTOCOL §5.28 — { issues, nextToken } envelope)', () => {
    it('get-auth-state reports the linear.authStatus probe (env-key model: no oauth, no daemon auth)', async () => {
      mockedRequest.mockResolvedValueOnce({ authenticated: true, login: 'Ada', scopes: [] });

      const state = await mockInvoke(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE, true);

      expect(mockedRequest).toHaveBeenCalledWith('linear.authStatus');
      expect(state).toEqual({ isAuthenticated: true, requiresDaemonAuth: false });
    });

    it('get-auth-state folds a failed probe (key absent → -32603) to unauthenticated', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('Linear is not configured.'));

      expect(await mockInvoke(LINEAR_AUTH_CHANNELS.GET_AUTH_STATE)).toEqual({
        isAuthenticated: false,
        requiresDaemonAuth: false,
      });
    });

    it('fetch-my-issues forwards the positional filter as { filter } and returns the { issues, nextToken } envelope', async () => {
      const issue = { id: 'u1', identifier: 'ENG-123', title: 'Fix flux', teamKey: 'ENG' };
      mockedRequest.mockResolvedValueOnce({ issues: [issue], nextToken: 'cursor-2' });

      const page = await mockInvoke(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, 'assigned');

      expect(mockedRequest).toHaveBeenCalledWith('linear.listIssues', { filter: 'assigned' });
      expect(page).toEqual({ issues: [issue], nextToken: 'cursor-2' });
    });

    it('fetch-my-issues forwards { limit, nextToken } cursor params (§5.28)', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });

      await mockInvoke(LINEAR_AUTH_CHANNELS.FETCH_MY_ISSUES, 'assigned', {
        limit: 50,
        nextToken: 'cursor-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('linear.listIssues', {
        filter: 'assigned',
        limit: 50,
        nextToken: 'cursor-1',
      });
    });

    it('search-issues forwards { query, limit?, nextToken? } and folds a daemon failure to an empty page', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });
      await mockInvoke(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, 'flux');
      expect(mockedRequest).toHaveBeenCalledWith('linear.searchIssues', { query: 'flux' });

      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });
      await mockInvoke(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, 'flux', {
        limit: 20,
        nextToken: 'cursor-1',
      });
      expect(mockedRequest).toHaveBeenCalledWith('linear.searchIssues', {
        query: 'flux',
        limit: 20,
        nextToken: 'cursor-1',
      });

      mockedRequest.mockRejectedValueOnce(new Error('boom'));
      expect(await mockInvoke(LINEAR_AUTH_CHANNELS.SEARCH_ISSUES, 'flux')).toEqual({
        issues: [],
        nextToken: null,
      });
    });
  });

  describe('sentry-auth:* → daemon sentry.* (PROTOCOL §5.29 — { issues, nextToken } envelope)', () => {
    it('get-auth-state maps the probe to { isAuthenticated, organization } (derived identity only)', async () => {
      mockedRequest.mockResolvedValueOnce({ authenticated: true, organization: 'acme' });

      const state = await mockInvoke(SENTRY_AUTH_CHANNELS.GET_AUTH_STATE);

      expect(mockedRequest).toHaveBeenCalledWith('sentry.authStatus');
      expect(state).toEqual({
        isAuthenticated: true,
        organization: 'acme',
        error: undefined,
      });
    });

    it('fetch-issues forwards the FetchIssuesRequest fields onto sentry.listIssues and returns the envelope', async () => {
      const issue = { id: '1', shortId: 'WEB-1', title: 'TypeError', status: 'unresolved' };
      mockedRequest.mockResolvedValueOnce({ issues: [issue], nextToken: 'cursor-2' });

      const page = await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, {
        status: 'unresolved',
        limit: 50,
      });

      expect(mockedRequest).toHaveBeenCalledWith('sentry.listIssues', {
        status: 'unresolved',
        limit: 50,
      });
      expect(page).toEqual({ issues: [issue], nextToken: 'cursor-2' });
    });

    it('fetch-issues forwards the nextToken cursor (§5.29)', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });

      await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES, {
        status: 'unresolved',
        nextToken: 'cursor-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('sentry.listIssues', {
        status: 'unresolved',
        nextToken: 'cursor-1',
      });
    });

    it('fetch-issues with no request forwards empty params and folds failures to an empty page', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });
      await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES);
      expect(mockedRequest).toHaveBeenCalledWith('sentry.listIssues', {});

      mockedRequest.mockRejectedValueOnce(new Error('Sentry is not configured.'));
      expect(await mockInvoke(SENTRY_AUTH_CHANNELS.FETCH_ISSUES)).toEqual({
        issues: [],
        nextToken: null,
      });
    });

    it('search-issues forwards { query, project?, limit?, nextToken? } onto sentry.searchIssues', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });

      await mockInvoke(SENTRY_AUTH_CHANNELS.SEARCH_ISSUES, {
        query: 'TypeError',
        project: 'web',
        limit: 20,
        nextToken: 'cursor-1',
      });

      expect(mockedRequest).toHaveBeenCalledWith('sentry.searchIssues', {
        query: 'TypeError',
        project: 'web',
        limit: 20,
        nextToken: 'cursor-1',
      });
    });

    it('save-config writes the credential pair via settings.update then confirms with a fresh authStatus probe (§5.12/§5.29)', async () => {
      mockedRequest
        .mockResolvedValueOnce({
          applied: [
            { path: 'accounts.sentry.token', value: 'token-1' },
            { path: 'accounts.sentry.organization', value: 'acme' },
          ],
        })
        .mockResolvedValueOnce({ authenticated: true, organization: 'acme' });

      const result = await mockInvoke(SENTRY_AUTH_CHANNELS.SAVE_CONFIG, {
        organization: 'acme',
        apiToken: 'token-1',
      });

      expect(mockedRequest).toHaveBeenNthCalledWith(1, 'settings.update', {
        changes: [
          { path: 'accounts.sentry.token', value: 'token-1' },
          { path: 'accounts.sentry.organization', value: 'acme' },
        ],
      });
      expect(mockedRequest).toHaveBeenNthCalledWith(2, 'sentry.authStatus');
      expect(mockedRequest).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true, organizationName: 'acme' });
    });

    it('save-config rolls back both settings and surfaces the probe error when the credentials fail validation', async () => {
      mockedRequest
        .mockResolvedValueOnce({ applied: [] })
        .mockResolvedValueOnce({ authenticated: false, error: 'Invalid API token' })
        .mockResolvedValueOnce({ path: 'accounts.sentry.token', value: '' })
        .mockResolvedValueOnce({ path: 'accounts.sentry.organization', value: '' });

      const result = await mockInvoke(SENTRY_AUTH_CHANNELS.SAVE_CONFIG, {
        organization: 'acme',
        apiToken: 'bad-token',
      });

      expect(mockedRequest).toHaveBeenNthCalledWith(2, 'sentry.authStatus');
      expect(mockedRequest).toHaveBeenNthCalledWith(3, 'settings.reset', {
        path: 'accounts.sentry.token',
      });
      expect(mockedRequest).toHaveBeenNthCalledWith(4, 'settings.reset', {
        path: 'accounts.sentry.organization',
      });
      expect(result).toEqual({ success: false, error: 'Invalid API token' });
    });

    it('save-config maps a rejected settings.update to the failure envelope without probing or rolling back', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('Invalid params: value must be a string'));

      const result = await mockInvoke(SENTRY_AUTH_CHANNELS.SAVE_CONFIG, {
        organization: 'acme',
        apiToken: 'token-1',
      });

      expect(mockedRequest).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: false,
        error: 'Invalid params: value must be a string',
      });
    });

    it('save-config rejects missing organization/apiToken client-side without touching the wire', async () => {
      const result = await mockInvoke(SENTRY_AUTH_CHANNELS.SAVE_CONFIG, { organization: 'acme' });

      expect(mockedRequest).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: 'Organization and API token are required',
      });
    });

    it('logout resets both settings paths (§5.12 "forget token")', async () => {
      mockedRequest
        .mockResolvedValueOnce({ path: 'accounts.sentry.token', value: '' })
        .mockResolvedValueOnce({ path: 'accounts.sentry.organization', value: '' });

      await mockInvoke(SENTRY_AUTH_CHANNELS.LOGOUT);

      expect(mockedRequest).toHaveBeenCalledWith('settings.reset', {
        path: 'accounts.sentry.token',
      });
      expect(mockedRequest).toHaveBeenCalledWith('settings.reset', {
        path: 'accounts.sentry.organization',
      });
      expect(mockedRequest).toHaveBeenCalledTimes(2);
    });

    it('logout rejects when a reset fails so local auth state is not cleared', async () => {
      mockedRequest
        .mockRejectedValueOnce(new Error('settings store unavailable'))
        .mockResolvedValueOnce({ path: 'accounts.sentry.organization', value: '' });

      await expect(mockInvoke(SENTRY_AUTH_CHANNELS.LOGOUT)).rejects.toThrow(
        'settings store unavailable',
      );
    });
  });

  describe('github-auth:* → daemon github.* (PROTOCOL §5.27 auth & identity)', () => {
    it('get-auth-state composes github.authStatus + github.getUser into the legacy GitHubAuthState', async () => {
      mockedRequest
        .mockResolvedValueOnce({
          isConfigured: true,
          oauthUrl: '',
          configuredButNeedsUpdate: false,
          updatedScopes: '',
        })
        .mockResolvedValueOnce({ user: WIRE_USER });

      const state = await mockInvoke(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE);

      expect(mockedRequest).toHaveBeenNthCalledWith(1, 'github.authStatus');
      expect(mockedRequest).toHaveBeenNthCalledWith(2, 'github.getUser');
      expect(state).toEqual({
        isAuthenticated: true,
        requiresDaemonAuth: false,
        user: {
          login: 'octocat',
          name: null,
          email: null,
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
        },
        needsScopeUpdate: false,
        oauthUrl: undefined,
        deviceFlow: null,
      });
    });

    it('get-auth-state skips getUser and reports unauthenticated when the PAT probe fails', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));

      const state = await mockInvoke<{ isAuthenticated: boolean; user: unknown }>(
        GITHUB_AUTH_CHANNELS.GET_AUTH_STATE,
      );

      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it('get-auth-state surfaces a still-pending device flow so a reload resumes it (§5.27)', async () => {
      const pendingFlow = {
        status: 'pending',
        userCode: 'WXYZ-9876',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 500,
        interval: 5,
      };
      mockedRequest.mockResolvedValueOnce({
        isConfigured: false,
        oauthUrl: 'https://github.com/login/device',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: pendingFlow,
      });

      const state = await mockInvoke<{ deviceFlow: unknown; oauthUrl: string }>(
        GITHUB_AUTH_CHANNELS.GET_AUTH_STATE,
      );

      expect(state.deviceFlow).toEqual(pendingFlow);
      expect(state.oauthUrl).toBe('https://github.com/login/device');
    });

    it('get-auth-state nulls out a terminal (non-pending) device flow', async () => {
      mockedRequest.mockResolvedValueOnce({
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: {
          status: 'expired',
          userCode: 'OLD1-CODE',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 0,
          interval: 5,
        },
      });

      const state = await mockInvoke<{ deviceFlow: unknown }>(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE);

      expect(state.deviceFlow).toBeNull();
    });

    it('get-status surfaces github.authStatus verbatim (FE shape parity fields included)', async () => {
      const status = {
        isConfigured: true,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
      };
      mockedRequest.mockResolvedValueOnce(status);

      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.GET_STATUS)).toEqual(status);
    });

    it('list-repos and search-repos map the wire camelCase GithubRepo to the legacy snake_case envelope', async () => {
      const wireRepo = {
        owner: 'octocat',
        name: 'hello',
        htmlUrl: 'https://github.com/octocat/hello',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        defaultBranch: 'main',
      };
      mockedRequest.mockResolvedValueOnce({ repos: [wireRepo] });
      const listResponse = await mockInvoke(GITHUB_AUTH_CHANNELS.LIST_REPOS, { page: 1 });
      expect(mockedRequest).toHaveBeenCalledWith('github.repos.list');
      expect(listResponse).toEqual({
        success: true,
        data: [
          {
            owner: 'octocat',
            name: 'hello',
            html_url: 'https://github.com/octocat/hello',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            default_branch: 'main',
          },
        ],
      });

      mockedRequest.mockResolvedValueOnce({ repos: [] });
      await mockInvoke(GITHUB_AUTH_CHANNELS.SEARCH_REPOS, { query: 'hello' });
      expect(mockedRequest).toHaveBeenCalledWith('github.repos.search', { query: 'hello' });
    });
  });

  describe('github-auth OAuth triggers → daemon device flow (§5.27 connect/cancelAuth/revoke)', () => {
    it('start reports alreadyAuthenticated when a token is already configured', async () => {
      mockedRequest.mockResolvedValueOnce({
        isConfigured: true,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
        deviceFlow: null,
      });

      const result = await mockInvoke(GITHUB_AUTH_CHANNELS.START_AUTH);

      expect(mockedRequest).toHaveBeenCalledWith('github.authStatus');
      expect(result).toEqual({
        success: true,
        alreadyAuthenticated: true,
        needsScopeUpdate: false,
      });
    });

    it('start forwards to github.connect and carries the device-flow codes (§5.27)', async () => {
      mockedRequest
        .mockResolvedValueOnce({
          isConfigured: false,
          oauthUrl: '',
          configuredButNeedsUpdate: false,
          updatedScopes: '',
          deviceFlow: null,
        })
        .mockResolvedValueOnce({
          ok: true,
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresIn: 899,
          interval: 5,
        });

      const result = await mockInvoke(GITHUB_AUTH_CHANNELS.START_AUTH);

      expect(mockedRequest).toHaveBeenCalledWith('github.connect');
      expect(result).toEqual({
        success: true,
        oauthUrl: 'https://github.com/login/device',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 899,
        interval: 5,
      });
    });

    it('start folds a github.connect failure to the error envelope', async () => {
      mockedRequest
        .mockRejectedValueOnce(new Error('GitHub is not configured.'))
        .mockRejectedValueOnce(new Error('device flow start failed'));

      const result = await mockInvoke(GITHUB_AUTH_CHANNELS.START_AUTH);

      expect(mockedRequest).toHaveBeenCalledWith('github.connect');
      expect(result).toEqual({
        success: false,
        error: 'device flow start failed',
      });
    });

    it('start rejects a partial github.connect payload (missing expiresIn/interval) as a wire divergence', async () => {
      mockedRequest
        .mockRejectedValueOnce(new Error('GitHub is not configured.'))
        .mockResolvedValueOnce({
          ok: true,
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
        });

      const result = await mockInvoke<{ success: boolean; error: string }>(
        GITHUB_AUTH_CHANNELS.START_AUTH,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('GitHub device flow could not be started.');
    });

    it('poll completes as soon as authStatus validates, carrying the derived identity', async () => {
      mockedRequest
        .mockResolvedValueOnce({
          isConfigured: true,
          oauthUrl: '',
          configuredButNeedsUpdate: false,
          updatedScopes: '',
        })
        .mockResolvedValueOnce({ user: WIRE_USER });

      const result = await mockInvoke(GITHUB_AUTH_CHANNELS.POLL_FOR_TOKEN);

      expect(mockedRequest).toHaveBeenCalledWith('github.getUser');
      expect(result).toEqual({
        success: true,
        data: {
          isComplete: true,
          user: {
            login: 'octocat',
            name: null,
            email: null,
            avatar_url: WIRE_USER.avatarUrl,
          },
        },
      });
    });

    it('poll stays incomplete (user null) while the PAT does not validate', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.POLL_FOR_TOKEN)).toEqual({
        success: true,
        data: { isComplete: false, user: null },
      });
    });

    it('cancel forwards to github.cancelAuth (§5.27)', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true, cancelled: true });
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH)).toEqual({ success: true });
      expect(mockedRequest).toHaveBeenCalledWith('github.cancelAuth');
    });

    it('cancel maps a non-ok github.cancelAuth result to a failed envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: false });
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH)).toEqual({
        success: false,
        error: 'The daemon did not confirm the cancel.',
      });
    });

    it('logout forwards to github.revoke and maps to the success envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.LOGOUT)).toEqual({ success: true });
      expect(mockedRequest).toHaveBeenCalledWith('github.revoke');
    });

    it('logout maps a non-ok github.revoke result to a failed envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ ok: false, guidance: 'revoke refused' });
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.LOGOUT)).toEqual({
        success: false,
        error: 'The daemon did not confirm the revoke.',
      });
    });

    it('logout maps a github.revoke failure to a failed envelope', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('revoke failed'));
      expect(await mockInvoke(GITHUB_AUTH_CHANNELS.LOGOUT)).toEqual({
        success: false,
        error: 'revoke failed',
      });
    });
  });

  describe('git-tracking:get-pull-request → daemon github.pulls.get (§5.27 pulls)', () => {
    it('forwards owner/repo/number and maps headRef/baseRef to source/targetBranch', async () => {
      mockedRequest.mockResolvedValueOnce({
        pull: {
          number: 7,
          title: 'Add flux capacitor',
          state: 'open',
          htmlUrl: 'https://github.com/acme/widgets/pull/7',
          headRef: 'feat/flux',
          baseRef: 'main',
        },
      });

      const result = await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_PULL_REQUEST, {
        owner: 'acme',
        repo: 'widgets',
        number: 7,
      });

      expect(mockedRequest).toHaveBeenCalledWith('github.pulls.get', {
        owner: 'acme',
        repo: 'widgets',
        number: 7,
      });
      expect(result).toEqual({
        success: true,
        data: {
          number: 7,
          title: 'Add flux capacitor',
          state: 'open',
          url: 'https://github.com/acme/widgets/pull/7',
          sourceBranch: 'feat/flux',
          targetBranch: 'main',
        },
      });
    });

    it('folds a null pull / missing params / daemon failure to the error envelope', async () => {
      mockedRequest.mockResolvedValueOnce({ pull: null });
      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_PULL_REQUEST, {
          owner: 'acme',
          repo: 'widgets',
          number: 404,
        }),
      ).toEqual({ success: false, error: 'Pull request #404 not found' });

      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_PULL_REQUEST, { owner: 'acme' }),
      ).toEqual({ success: false, error: 'owner and repo are required' });

      mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.GET_PULL_REQUEST, {
          owner: 'acme',
          repo: 'widgets',
          number: 7,
        }),
      ).toEqual({ success: false, error: 'GitHub is not configured.' });
    });
  });

  describe('git-tracking search → daemon github.issues/pulls.search (Add-context GH tabs)', () => {
    it('search-github-issues forwards owner/repo + options and maps GithubIssue to the pane shape', async () => {
      mockedRequest.mockResolvedValueOnce({
        issues: [
          {
            number: 7,
            title: 'Bug in flux',
            body: 'It breaks',
            state: 'open',
            htmlUrl: 'https://github.com/octocat/hello/issues/7',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            user: WIRE_USER,
            labels: ['bug'],
          },
        ],
        nextToken: 'cursor-2',
      });

      const response = await mockInvoke(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, {
        owner: 'octocat',
        repo: 'hello',
        options: { state: 'open', per_page: 20, filter: 'all' },
      });

      expect(mockedRequest).toHaveBeenCalledWith('github.issues.search', {
        owner: 'octocat',
        repo: 'hello',
        filter: 'all',
        state: 'open',
        limit: 20,
      });
      expect(response).toEqual({
        success: true,
        data: [
          {
            id: '7',
            number: 7,
            title: 'Bug in flux',
            body: 'It breaks',
            htmlUrl: 'https://github.com/octocat/hello/issues/7',
            state: 'open',
            owner: 'octocat',
            repo: 'hello',
            author: { login: 'octocat' },
            labels: ['bug'],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
        nextToken: 'cursor-2',
      });
    });

    it('search-github-issues forwards query + nextToken onto github.issues.search (§5.27)', async () => {
      mockedRequest.mockResolvedValueOnce({ issues: [], nextToken: null });

      const response = await mockInvoke(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, {
        owner: 'octocat',
        repo: 'hello',
        options: { state: 'open', filter: 'all', query: 'flux', nextToken: 'cursor-1' },
      });

      expect(mockedRequest).toHaveBeenCalledWith('github.issues.search', {
        owner: 'octocat',
        repo: 'hello',
        filter: 'all',
        state: 'open',
        query: 'flux',
        nextToken: 'cursor-1',
      });
      expect(response).toEqual({ success: true, data: [], nextToken: null });
    });

    it("search-pull-requests maps merged/draft booleans into the pane's single state field", async () => {
      mockedRequest.mockResolvedValueOnce({
        pulls: [
          {
            number: 42,
            title: 'Add feature',
            body: '…',
            state: 'open',
            htmlUrl: 'https://github.com/octocat/hello/pull/42',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            user: WIRE_USER,
            headRef: 'feature/x',
            baseRef: 'main',
            merged: false,
            draft: true,
            assignees: [WIRE_USER],
          },
        ],
      });

      const response = await mockInvoke<{ success: boolean; data: { state: string }[] }>(
        IPC_CHANNELS.GIT_TRACKING.SEARCH_PULL_REQUESTS,
        {
          owner: 'octocat',
          repo: 'hello',
          options: { state: 'open', per_page: 50, filter: 'all' },
        },
      );

      expect(mockedRequest).toHaveBeenCalledWith('github.pulls.search', {
        owner: 'octocat',
        repo: 'hello',
        filter: 'all',
        state: 'open',
        limit: 50,
      });
      expect(response.success).toBe(true);
      expect(response.data[0]).toMatchObject({
        id: '42',
        state: 'draft',
        author: { login: 'octocat' },
        assignees: ['octocat'],
        sourceBranch: 'feature/x',
        targetBranch: 'main',
        description: '…',
      });
    });

    it('search-pull-requests forwards query + nextToken and returns the response nextToken (§5.27)', async () => {
      mockedRequest.mockResolvedValueOnce({ pulls: [], nextToken: 'cursor-2' });

      const response = await mockInvoke<{ success: boolean; nextToken: string | null }>(
        IPC_CHANNELS.GIT_TRACKING.SEARCH_PULL_REQUESTS,
        {
          owner: 'octocat',
          repo: 'hello',
          options: { filter: 'all', query: 'feature', nextToken: 'cursor-1' },
        },
      );

      expect(mockedRequest).toHaveBeenCalledWith('github.pulls.search', {
        owner: 'octocat',
        repo: 'hello',
        filter: 'all',
        query: 'feature',
        nextToken: 'cursor-1',
      });
      expect(response.nextToken).toBe('cursor-2');
    });

    it('folds a daemon failure to the { success:false, error } envelope the pane tolerates', async () => {
      mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));

      expect(
        await mockInvoke(IPC_CHANNELS.GIT_TRACKING.SEARCH_GITHUB_ISSUES, {
          owner: 'octocat',
          repo: 'hello',
          options: {},
        }),
      ).toEqual({ success: false, error: 'GitHub is not configured.' });
    });
  });

  describe('sentry-auth:get-issue → daemon sentry.getIssue (§5.29)', () => {
    it('maps a numeric/UUID id to { id } and returns the bare issue', async () => {
      // PROTOCOL §5.29: sentry.getIssue → one flattened SentryIssueResult.
      mockedRequest.mockResolvedValueOnce({ id: '12345', shortId: 'WEB-7', title: 'TypeError' });

      const issue = await mockInvoke(SENTRY_AUTH_CHANNELS.GET_ISSUE, '12345');

      expect(mockedRequest).toHaveBeenCalledWith('sentry.getIssue', { id: '12345' });
      expect(issue).toEqual({ id: '12345', shortId: 'WEB-7', title: 'TypeError' });
    });

    it('maps a WEB-1-style short id to { shortId }', async () => {
      mockedRequest.mockResolvedValueOnce({ id: '9', shortId: 'WEB-1', title: 'Crash' });

      await mockInvoke(SENTRY_AUTH_CHANNELS.GET_ISSUE, 'WEB-1');

      expect(mockedRequest).toHaveBeenCalledWith('sentry.getIssue', { shortId: 'WEB-1' });
    });

    it('folds an empty id (no wire call) and a daemon failure to null', async () => {
      expect(await mockInvoke(SENTRY_AUTH_CHANNELS.GET_ISSUE, '')).toBeNull();
      expect(mockedRequest).not.toHaveBeenCalled();

      mockedRequest.mockRejectedValueOnce(new Error('issue not found'));
      expect(await mockInvoke(SENTRY_AUTH_CHANNELS.GET_ISSUE, 'WEB-404')).toBeNull();
    });
  });
});
