import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the daemon JSON-RPC client so the service's `github.*` calls are
// observable and controllable without a real socket.
const request = vi.fn();
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));
vi.mock('../../github-auth/main/github-auth.service', () => ({
  githubAuthService: { isAuthenticated: vi.fn().mockResolvedValue(true) },
}));

import { GitHubService } from './github.service';

const WIRE_ISSUE = {
  number: 7,
  title: 'Bug in flux',
  body: 'It breaks',
  state: 'open' as const,
  htmlUrl: 'https://github.com/octocat/hello/issues/7',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  user: { login: 'octocat' },
  labels: ['bug'],
  comments: 0,
};

// The search reads are cursor-paginated per PROTOCOL §5.27: `query`/`nextToken`
// forward onto `github.issues.search` / `github.pulls.search` and participate
// in the cache key so distinct searches/pages never collide.
describe('GitHubService search caching (§5.27)', () => {
  let service: GitHubService;

  beforeEach(() => {
    request.mockReset();
    service = new GitHubService();
  });

  it('searchIssues caches per query — same query hits the cache, different query refetches', async () => {
    request.mockResolvedValue({ issues: [WIRE_ISSUE], nextToken: null });

    await service.searchIssues('octocat', 'hello', { query: 'flux' });
    const cached = await service.searchIssues('octocat', 'hello', { query: 'flux' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(cached.issues[0]).toMatchObject({ number: 7, title: 'Bug in flux' });

    await service.searchIssues('octocat', 'hello', { query: 'other' });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('github.issues.search', {
      owner: 'octocat',
      repo: 'hello',
      query: 'other',
    });
  });

  it('searchIssues caches per page — a different nextToken refetches and returns the page cursor', async () => {
    request
      .mockResolvedValueOnce({ issues: [WIRE_ISSUE], nextToken: 'cursor-2' })
      .mockResolvedValueOnce({ issues: [WIRE_ISSUE], nextToken: null });

    const page1 = await service.searchIssues('octocat', 'hello', { query: 'flux' });
    expect(page1.nextToken).toBe('cursor-2');

    const page2 = await service.searchIssues('octocat', 'hello', {
      query: 'flux',
      nextToken: 'cursor-2',
    });
    expect(page2.nextToken).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('github.issues.search', {
      owner: 'octocat',
      repo: 'hello',
      query: 'flux',
      nextToken: 'cursor-2',
    });
  });

  it('searchPullRequests keys the cache on query/nextToken and maps per_page → limit', async () => {
    const wirePull = {
      number: 42,
      title: 'Add feature',
      body: '…',
      state: 'open',
      htmlUrl: 'https://github.com/octocat/hello/pull/42',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      user: { login: 'octocat' },
      headRef: 'feature/x',
      baseRef: 'main',
      headSha: 'a',
      baseSha: 'b',
      merged: false,
      draft: false,
      labels: [],
      comments: 0,
      reviewComments: 0,
      commits: 1,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    };
    request.mockResolvedValue({ pulls: [wirePull], nextToken: 'cursor-2' });

    await service.searchPullRequests('octocat', 'hello', { query: 'feature', per_page: 20 });
    expect(request).toHaveBeenCalledWith('github.pulls.search', {
      owner: 'octocat',
      repo: 'hello',
      query: 'feature',
      limit: 20,
    });

    // Same options → cache hit; nextToken continuation → new wire call.
    await service.searchPullRequests('octocat', 'hello', { query: 'feature', per_page: 20 });
    expect(request).toHaveBeenCalledTimes(1);

    const page2 = await service.searchPullRequests('octocat', 'hello', {
      query: 'feature',
      nextToken: 'cursor-2',
      per_page: 20,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(page2.nextToken).toBe('cursor-2');
  });
});
