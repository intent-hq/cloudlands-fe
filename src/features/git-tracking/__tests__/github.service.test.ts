/**
 * Tests for GitHubService.
 *
 * Covers the post-rewire surface that routes every call through the intentd
 * `github.*` JSON-RPC namespace (PROTOCOL §5.27) instead of the deleted
 * `augment-api.client` proxy. `getCheckRuns` and `getReviews` have no
 * explicit-addressed §5.27 equivalent and degrade to empty results — the
 * specs below pin that contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../main/github.service';

// Mock the github-auth service used for the authenticated gate.
vi.mock('../../github-auth/main/github-auth.service', () => ({
  githubAuthService: {
    isAuthenticated: vi.fn(),
  },
}));

// Mock the backend JSON-RPC client used by the new implementation.
const requestMock = vi.fn();
vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

import { githubAuthService } from '../../github-auth/main/github-auth.service';

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    service = new GitHubService();
  });

  describe('getCheckRuns (degraded — no explicit-addressed §5.27 equivalent)', () => {
    it('returns zeros when not authenticated and never hits the daemon', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(false);

      const result = await service.getCheckRuns('owner', 'repo', 'sha123');

      expect(result).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('returns zeros when authenticated without calling the daemon', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);

      const result = await service.getCheckRuns('owner', 'repo', 'sha456');

      expect(result).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe('getReviews (degraded — no explicit-addressed §5.27 equivalent)', () => {
    it('returns empty decision when not authenticated and never hits the daemon', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(false);

      const result = await service.getReviews('owner', 'repo', 1);

      expect(result).toEqual({
        reviewDecision: null,
        approvalCount: 0,
        changesRequestedCount: 0,
        approvedBy: [],
      });
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('returns empty decision when authenticated without calling the daemon', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);

      const result = await service.getReviews('owner', 'repo', 2);

      expect(result).toEqual({
        reviewDecision: null,
        approvalCount: 0,
        changesRequestedCount: 0,
        approvedBy: [],
      });
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe('getPullRequests (routes through github.pulls.list)', () => {
    it('returns [] when not authenticated', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(false);

      const result = await service.getPullRequests('owner', 'repo');

      expect(result).toEqual([]);
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('maps the wire `pulls[]` into the FE PullRequest shape', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      requestMock.mockResolvedValue({
        pulls: [
          {
            number: 7,
            title: 'feat: thing',
            body: 'body',
            state: 'open',
            htmlUrl: 'https://github.com/owner/repo/pull/7',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-02T00:00:00Z',
            user: { login: 'octocat', avatarUrl: 'https://x/y.png' },
            headRef: 'feat-branch',
            baseRef: 'main',
            headSha: 'abc',
            baseSha: 'def',
            merged: false,
            draft: false,
            labels: ['bug'],
            assignees: [{ login: 'alice' }],
            comments: 0,
            reviewComments: 0,
            commits: 1,
            additions: 10,
            deletions: 2,
            changedFiles: 3,
          },
        ],
      });

      const [pr] = await service.getPullRequests('owner', 'repo', { state: 'open' });

      expect(requestMock).toHaveBeenCalledWith('github.pulls.list', {
        owner: 'owner',
        repo: 'repo',
        state: 'open',
      });
      expect(pr.number).toBe(7);
      expect(pr.sourceBranch).toBe('feat-branch');
      expect(pr.targetBranch).toBe('main');
      expect(pr.author.login).toBe('octocat');
      expect(pr.author.avatarUrl).toBe('https://x/y.png');
      expect(pr.labels).toEqual(['bug']);
      expect(pr.assignees).toEqual(['alice']);
    });

    it('returns [] on RPC failure (caller falls back to no-PR)', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      requestMock.mockRejectedValue(new Error('boom'));

      const result = await service.getPullRequests('owner', 'repo');

      expect(result).toEqual([]);
    });
  });
});
