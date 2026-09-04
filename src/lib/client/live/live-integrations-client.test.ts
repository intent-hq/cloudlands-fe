/**
 * Wire-contract tests for the live integrations domain
 * (PROTOCOL §5.27 github.*, §5.28 linear.*, §5.29 sentry.*).
 *
 * Regression: the Add-context pane (Linear / Sentry / GH tabs) rendered mock
 * fixtures because live-app-client delegated `integrations` to the mock.
 * Asserts (a) the exact JSON-RPC requests the client emits, (b) PROTOCOL-shaped
 * responses surface through the seam, (c) unauthenticated integrations degrade
 * to null/empty (auth-hint state — never fixtures).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { LiveIntegrationsClient } from './live-integrations-client';

const mockedRequest = vi.mocked(backendRequest);

/** A promise the test resolves manually (to assert in-flight concurrency). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** PROTOCOL §5.27 `github.getUser` result — derived identity only. */
const GITHUB_USER_WIRE = {
  user: {
    login: 'octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    htmlUrl: 'https://github.com/octocat',
  },
};

/** PROTOCOL §5.28 flattened LinearIssueResult. */
const LINEAR_ISSUE = {
  id: 'uuid-1',
  identifier: 'ENG-123',
  title: 'Fix the flux capacitor',
  state: 'In Progress',
  teamKey: 'ENG',
};

/** PROTOCOL §5.29 flattened SentryIssueResult. */
const SENTRY_ISSUE = {
  id: '1',
  shortId: 'WEB-1',
  title: 'TypeError: foo is not a function',
  status: 'unresolved',
  level: 'error',
  count: '12',
  userCount: 3,
  firstSeen: '2026-01-01T00:00:00Z',
  lastSeen: '2026-01-02T00:00:00Z',
  projectName: 'Web',
  projectSlug: 'web',
};

describe('LiveIntegrationsClient (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('githubUser forwards github.getUser and maps the wire identity to the FE snake_case shape', async () => {
    mockedRequest.mockResolvedValueOnce(GITHUB_USER_WIRE);
    const client = new LiveIntegrationsClient();

    const user = await client.githubUser();

    expect(mockedRequest).toHaveBeenCalledWith('github.getUser');
    expect(user).toEqual({
      login: 'octocat',
      name: null,
      email: null,
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
    });
  });

  it('githubUser folds a null wire user and a transport failure to null (auth hint state)', async () => {
    const client = new LiveIntegrationsClient();
    mockedRequest.mockResolvedValueOnce({ user: null });
    expect(await client.githubUser()).toBeNull();

    mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    expect(await client.githubUser()).toBeNull();
  });

  it('linearIssues gates on linear.authStatus and unwraps the linear.listIssues { issues, nextToken } envelope (§5.28)', async () => {
    mockedRequest
      .mockResolvedValueOnce({ authenticated: true, login: 'Ada Lovelace', scopes: [] })
      .mockResolvedValueOnce({ issues: [LINEAR_ISSUE], nextToken: null });
    const client = new LiveIntegrationsClient();

    const issues = await client.linearIssues();

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'linear.authStatus');
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'linear.listIssues');
    expect(issues).toEqual([LINEAR_ISSUE]);
  });

  it('linearIssues returns [] without calling listIssues when the auth probe reports unauthenticated', async () => {
    mockedRequest.mockResolvedValueOnce({ authenticated: false, scopes: [] });
    const client = new LiveIntegrationsClient();

    expect(await client.linearIssues()).toEqual([]);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('linear.authStatus');
  });

  it('sentryIssues gates on sentry.authStatus and unwraps the sentry.listIssues { issues, nextToken } envelope (§5.29)', async () => {
    mockedRequest
      .mockResolvedValueOnce({ authenticated: true, organization: 'acme' })
      .mockResolvedValueOnce({ issues: [SENTRY_ISSUE], nextToken: null });
    const client = new LiveIntegrationsClient();

    const issues = await client.sentryIssues();

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'sentry.authStatus');
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'sentry.listIssues');
    expect(issues).toEqual([SENTRY_ISSUE]);
  });

  it('sentryIssues folds a transport failure to an empty list', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('Sentry is not configured.'));
    const client = new LiveIntegrationsClient();

    expect(await client.sentryIssues()).toEqual([]);
  });

  it('subscribe emits one snapshot of the current GitHub identity', async () => {
    mockedRequest.mockResolvedValueOnce(GITHUB_USER_WIRE);
    const client = new LiveIntegrationsClient();

    const handler = vi.fn();
    client.subscribe(handler);
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledWith({
        githubUser: {
          login: 'octocat',
          name: null,
          email: null,
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
        },
      }),
    );
  });
});

describe('LiveIntegrationsClient.githubBranches (github.branches.list + github.repos.get, §5.27)', () => {
  afterEach(() => vi.clearAllMocks());

  it("lists remote branch names and the repo's default branch", async () => {
    // PROTOCOL §5.27: { branches: string[], nextToken? } and { repo: GithubRepo | null }.
    mockedRequest
      .mockResolvedValueOnce({ branches: ['main', 'feat/x'], nextToken: null })
      .mockResolvedValueOnce({ repo: { name: 'intent', defaultBranch: 'main' } });
    const client = new LiveIntegrationsClient();

    const listing = await client.githubBranches('octo', 'intent');

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'github.branches.list', {
      owner: 'octo',
      repo: 'intent',
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'github.repos.get', {
      owner: 'octo',
      repo: 'intent',
    });
    expect(listing).toEqual({ branches: ['main', 'feat/x'], defaultBranch: 'main' });
  });

  it('issues the branch-list and default-branch requests concurrently (both REST-backed)', async () => {
    // Neither response has settled yet — both requests must already be on the
    // wire (sequential awaits would hold repos.get behind branches.list).
    const list = deferred<unknown>();
    const repoGet = deferred<unknown>();
    mockedRequest.mockReturnValueOnce(list.promise).mockReturnValueOnce(repoGet.promise);
    const client = new LiveIntegrationsClient();

    const pending = client.githubBranches('octo', 'intent');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'github.branches.list', {
      owner: 'octo',
      repo: 'intent',
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'github.repos.get', {
      owner: 'octo',
      repo: 'intent',
    });

    list.resolve({ branches: ['main'], nextToken: null });
    repoGet.resolve({ repo: { name: 'intent', defaultBranch: 'main' } });
    expect(await pending).toEqual({ branches: ['main'], defaultBranch: 'main' });
  });

  it('degrades the default branch to undefined when github.repos.get fails', async () => {
    mockedRequest
      .mockResolvedValueOnce({ branches: ['main'] })
      .mockRejectedValueOnce(new Error('boom'));
    const client = new LiveIntegrationsClient();

    expect(await client.githubBranches('octo', 'intent')).toEqual({
      branches: ['main'],
      defaultBranch: undefined,
    });
  });

  it('propagates a branch-list failure so the caller renders an error/auth state', async () => {
    mockedRequest
      .mockRejectedValueOnce(new Error('GitHub is not configured.'))
      .mockResolvedValueOnce({ repo: null });
    const client = new LiveIntegrationsClient();

    await expect(client.githubBranches('octo', 'intent')).rejects.toThrow(
      'GitHub is not configured.',
    );
  });

  it('forwards a non-empty prefix for server-side filtering (matching-refs)', async () => {
    mockedRequest.mockResolvedValueOnce({ branches: ['feat/x', 'feat/y'], nextToken: null });
    const client = new LiveIntegrationsClient();

    const listing = await client.githubBranches('octo', 'intent', 'feat');

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'github.branches.list', {
      owner: 'octo',
      repo: 'intent',
      prefix: 'feat',
    });
    // Prefix searches skip the github.repos.get leg — the caller discards the
    // default branch, so a per-keystroke search costs one REST call, not two.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(listing).toEqual({ branches: ['feat/x', 'feat/y'], defaultBranch: undefined });
  });

  it('omits prefix from the wire when empty/undefined (unfiltered shape for older daemons)', async () => {
    mockedRequest
      .mockResolvedValueOnce({ branches: ['main'], nextToken: null })
      .mockResolvedValueOnce({ repo: { name: 'intent', defaultBranch: 'main' } });
    const client = new LiveIntegrationsClient();

    await client.githubBranches('octo', 'intent', '');

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'github.branches.list', {
      owner: 'octo',
      repo: 'intent',
    });
  });
});

describe('LiveIntegrationsClient.githubBranchesCached (github.branches.listCached, §5.27)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends owner/repo and surfaces a warm-cache listing', async () => {
    // PROTOCOL §5.27: { cached: boolean, branches: string[], defaultBranch?, source? }.
    mockedRequest.mockResolvedValueOnce({
      cached: true,
      branches: ['main', 'feat/x'],
      defaultBranch: 'main',
      source: 'cache',
    });
    const client = new LiveIntegrationsClient();

    const listing = await client.githubBranchesCached('octo', 'intent');

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('github.branches.listCached', {
      owner: 'octo',
      repo: 'intent',
    });
    expect(listing).toEqual({
      cached: true,
      branches: ['main', 'feat/x'],
      defaultBranch: 'main',
      source: 'cache',
    });
  });

  it('surfaces the ls-remote fallback listing (cache miss with populated branches)', async () => {
    // PROTOCOL §5.27: on a cache miss the daemon falls back to one
    // `git ls-remote` round trip — { cached: false, branches, defaultBranch?, source: "ls-remote" }.
    mockedRequest.mockResolvedValueOnce({
      cached: false,
      branches: ['dev', 'main'],
      defaultBranch: 'main',
      source: 'ls-remote',
    });
    const client = new LiveIntegrationsClient();

    expect(await client.githubBranchesCached('octo', 'intent')).toEqual({
      cached: false,
      branches: ['dev', 'main'],
      defaultBranch: 'main',
      source: 'ls-remote',
    });
  });

  it('surfaces a cold-cache miss ({ cached: false, branches: [] }) unchanged', async () => {
    // Pre-fallback daemons (and failed fallbacks) omit source entirely.
    mockedRequest.mockResolvedValueOnce({ cached: false, branches: [] });
    const client = new LiveIntegrationsClient();

    expect(await client.githubBranchesCached('octo', 'intent')).toEqual({
      cached: false,
      branches: [],
      defaultBranch: undefined,
      source: undefined,
    });
  });

  it('folds a transport/daemon failure to a cold-cache miss (never throws)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    const client = new LiveIntegrationsClient();

    expect(await client.githubBranchesCached('octo', 'intent')).toEqual({
      cached: false,
      branches: [],
    });
  });
});

describe('LiveIntegrationsClient.githubRepoConfig (github.repoConfig.get, §5.27 v2.4)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends owner/repo (no ref) and surfaces the committed config', async () => {
    // PROTOCOL §5.27 v2.4: { config: RepoConfig | null, exists: boolean }.
    mockedRequest.mockResolvedValueOnce({
      config: { setupScript: 'pnpm install', branchPrefix: 'feat' },
      exists: true,
    });
    const client = new LiveIntegrationsClient();

    const result = await client.githubRepoConfig('octo', 'intent');

    expect(mockedRequest).toHaveBeenCalledWith('github.repoConfig.get', {
      owner: 'octo',
      repo: 'intent',
    });
    expect(result).toEqual({
      config: { setupScript: 'pnpm install', branchPrefix: 'feat' },
      exists: true,
    });
  });

  it('forwards ref on the wire when provided', async () => {
    mockedRequest.mockResolvedValueOnce({ config: {}, exists: true });
    const client = new LiveIntegrationsClient();

    await client.githubRepoConfig('octo', 'intent', 'release-1.x');

    expect(mockedRequest).toHaveBeenCalledWith('github.repoConfig.get', {
      owner: 'octo',
      repo: 'intent',
      ref: 'release-1.x',
    });
  });

  it('maps a missing file to { config: null, exists: false }', async () => {
    mockedRequest.mockResolvedValueOnce({ config: null, exists: false });
    const client = new LiveIntegrationsClient();

    expect(await client.githubRepoConfig('octo', 'intent')).toEqual({
      config: null,
      exists: false,
    });
  });

  it('propagates transport/daemon failures (e.g. unauthenticated private repo)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    const client = new LiveIntegrationsClient();

    await expect(client.githubRepoConfig('octo', 'intent')).rejects.toThrow(
      'GitHub is not configured.',
    );
  });
});

/** PROTOCOL §5.27 `GithubPullRequest` DTO (open, non-draft). */
const PULL_WIRE = {
  number: 42,
  title: 'Add dark mode toggle',
  body: '',
  state: 'open',
  htmlUrl: 'https://github.com/octo/intent/pull/42',
  createdAt: '2026-01-02T09:00:00Z',
  updatedAt: '2026-01-02T14:00:00Z',
  user: { login: 'octocat', avatarUrl: '', htmlUrl: 'https://github.com/octocat' },
  headRef: 'feat/dark-mode',
  baseRef: 'main',
  headSha: 'abc',
  baseSha: 'def',
  merged: false,
  draft: false,
  labels: [],
  comments: 0,
  reviewComments: 0,
  commits: 1,
  additions: 10,
  deletions: 2,
  changedFiles: 1,
};

/** PROTOCOL §5.27 `GithubIssue` DTO. */
const ISSUE_WIRE = {
  number: 17,
  title: 'Theme flashes on first paint',
  state: 'open',
  htmlUrl: 'https://github.com/octo/intent/issues/17',
  createdAt: '2026-01-01T08:00:00Z',
  updatedAt: '2026-01-02T10:00:00Z',
  user: { login: 'hubot', avatarUrl: '', htmlUrl: 'https://github.com/hubot' },
  labels: ['bug'],
  comments: 3,
  owner: 'octo',
  repo: 'intent',
};

describe('LiveIntegrationsClient.githubPullRequest (github.pulls.get, §5.27)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends owner/repo/number and normalizes an open PR', async () => {
    mockedRequest.mockResolvedValueOnce({ pull: PULL_WIRE });
    const client = new LiveIntegrationsClient();

    const details = await client.githubPullRequest('octo', 'intent', 42);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('github.pulls.get', {
      owner: 'octo',
      repo: 'intent',
      number: 42,
    });
    expect(details).toEqual({
      owner: 'octo',
      repo: 'intent',
      number: 42,
      title: 'Add dark mode toggle',
      state: 'open',
      author: 'octocat',
      createdAt: '2026-01-02T09:00:00Z',
      updatedAt: '2026-01-02T14:00:00Z',
      url: 'https://github.com/octo/intent/pull/42',
      headRef: 'feat/dark-mode',
      baseRef: 'main',
    });
  });

  it("collapses merged → 'merged' (merged PRs are 'closed' on the wire)", async () => {
    mockedRequest.mockResolvedValueOnce({ pull: { ...PULL_WIRE, state: 'closed', merged: true } });
    const client = new LiveIntegrationsClient();

    expect((await client.githubPullRequest('octo', 'intent', 42)).state).toBe('merged');
  });

  it("collapses draft → 'draft'", async () => {
    mockedRequest.mockResolvedValueOnce({ pull: { ...PULL_WIRE, draft: true } });
    const client = new LiveIntegrationsClient();

    expect((await client.githubPullRequest('octo', 'intent', 42)).state).toBe('draft');
  });

  it("keeps a closed, unmerged PR as 'closed'", async () => {
    mockedRequest.mockResolvedValueOnce({ pull: { ...PULL_WIRE, state: 'closed' } });
    const client = new LiveIntegrationsClient();

    expect((await client.githubPullRequest('octo', 'intent', 42)).state).toBe('closed');
  });

  it("collapses a closed, unmerged draft → 'closed' (GitHub keeps draft: true after close)", async () => {
    mockedRequest.mockResolvedValueOnce({
      pull: { ...PULL_WIRE, state: 'closed', draft: true, merged: false },
    });
    const client = new LiveIntegrationsClient();

    expect((await client.githubPullRequest('octo', 'intent', 42)).state).toBe('closed');
  });

  it('throws when the daemon reports no such PR (pull: null)', async () => {
    mockedRequest.mockResolvedValueOnce({ pull: null });
    const client = new LiveIntegrationsClient();

    await expect(client.githubPullRequest('octo', 'intent', 99)).rejects.toThrow(/not found/);
  });

  it('propagates transport/daemon failures (e.g. GitHub not configured)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    const client = new LiveIntegrationsClient();

    await expect(client.githubPullRequest('octo', 'intent', 42)).rejects.toThrow(
      'GitHub is not configured.',
    );
  });
});

describe('LiveIntegrationsClient.githubIssue (github.issues.get, §5.27)', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends owner/repo/number and normalizes an open issue', async () => {
    mockedRequest.mockResolvedValueOnce({ issue: ISSUE_WIRE });
    const client = new LiveIntegrationsClient();

    const details = await client.githubIssue('octo', 'intent', 17);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('github.issues.get', {
      owner: 'octo',
      repo: 'intent',
      number: 17,
    });
    expect(details).toEqual({
      owner: 'octo',
      repo: 'intent',
      number: 17,
      title: 'Theme flashes on first paint',
      state: 'open',
      author: 'hubot',
      createdAt: '2026-01-01T08:00:00Z',
      updatedAt: '2026-01-02T10:00:00Z',
      url: 'https://github.com/octo/intent/issues/17',
    });
  });

  it('surfaces a closed issue', async () => {
    mockedRequest.mockResolvedValueOnce({ issue: { ...ISSUE_WIRE, state: 'closed' } });
    const client = new LiveIntegrationsClient();

    expect((await client.githubIssue('octo', 'intent', 17)).state).toBe('closed');
  });

  it('throws when the daemon reports no such issue (issue: null)', async () => {
    mockedRequest.mockResolvedValueOnce({ issue: null });
    const client = new LiveIntegrationsClient();

    await expect(client.githubIssue('octo', 'intent', 99)).rejects.toThrow(/not found/);
  });

  it('propagates transport/daemon failures (e.g. GitHub not configured)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('GitHub is not configured.'));
    const client = new LiveIntegrationsClient();

    await expect(client.githubIssue('octo', 'intent', 17)).rejects.toThrow(
      'GitHub is not configured.',
    );
  });
});
