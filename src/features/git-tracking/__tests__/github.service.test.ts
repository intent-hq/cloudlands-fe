/**
 * Tests for GitHubService
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import { GitHubService } from '../main/github.service';

// Mock the github-auth service
vi.mock('../../github-auth/main/github-auth.service', () => ({
  githubAuthService: {
    isAuthenticated: vi.fn(),
  },
}));

// Mock the augment API client
vi.mock('../../../shared/augment-api/augment-api.client', () => ({
  augmentApiClient: {
    callEndpoint: vi.fn(),
    isAuthenticated: vi.fn(),
  },
}));

import { githubAuthService } from '../../github-auth/main/github-auth.service';
import { augmentApiClient } from '../../../shared/augment-api/augment-api.client';

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create fresh instance to clear cache
    service = new GitHubService();
  });

  describe('getCheckRuns', () => {
    it('should return zeros when not authenticated', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(false);

      const result = await service.getCheckRuns('owner', 'repo', 'sha123');

      expect(result).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
    });

    it('should return all checks passing', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: test1
    status: completed
    conclusion: success
  - name: test2
    status: completed
    conclusion: success
  - name: test3
    status: completed
    conclusion: success
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'sha123');

      expect(result).toEqual({ total: 3, passed: 3, failed: 0, pending: 0 });
    });

    it('should handle mixed results', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: build
    status: completed
    conclusion: success
  - name: lint
    status: completed
    conclusion: success
  - name: e2e
    status: completed
    conclusion: failure
  - name: deploy
    status: in_progress
    conclusion: null
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'sha456');

      expect(result).toEqual({ total: 4, passed: 2, failed: 1, pending: 1 });
    });

    it('should count neutral and skipped as passed', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: optional-check
    status: completed
    conclusion: neutral
  - name: skipped-check
    status: completed
    conclusion: skipped
  - name: main-check
    status: completed
    conclusion: success
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'sha789');

      expect(result).toEqual({ total: 3, passed: 3, failed: 0, pending: 0 });
    });

    it('should count non-completed status as pending', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: queued-check
    status: queued
    conclusion: null
  - name: running-check
    status: in_progress
    conclusion: null
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'shaPending');

      expect(result).toEqual({ total: 2, passed: 0, failed: 0, pending: 2 });
    });

    it('should count failure conclusions as failed', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: failed-test
    status: completed
    conclusion: failure
  - name: cancelled-job
    status: completed
    conclusion: cancelled
  - name: timeout-job
    status: completed
    conclusion: timed_out
  - name: action-needed
    status: completed
    conclusion: action_required
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'shaFailed');

      expect(result).toEqual({ total: 4, passed: 0, failed: 4, pending: 0 });
    });

    it('should return zeros for empty response', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs: []
`,
        tool_result_message: 'OK',
      });

      const result = await service.getCheckRuns('owner', 'repo', 'shaEmpty');

      expect(result).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
    });

    it('should use cached result on second call', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
check_runs:
  - name: test
    status: completed
    conclusion: success
`,
        tool_result_message: 'OK',
      });

      // First call
      await service.getCheckRuns('owner', 'repo', 'shaCached');
      // Second call
      await service.getCheckRuns('owner', 'repo', 'shaCached');

      // API should only be called once
      expect(augmentApiClient.callEndpoint).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReviews', () => {
    it('should return empty when not authenticated', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(false);

      const result = await service.getReviews('owner', 'repo', 123);

      expect(result).toEqual({
        reviewDecision: null,
        approvalCount: 0,
        changesRequestedCount: 0,
        approvedBy: [],
      });
    });

    it('should return APPROVED for single approval', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
- state: APPROVED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T10:00:00Z"
`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 1);

      expect(result).toEqual({
        reviewDecision: 'APPROVED',
        approvalCount: 1,
        changesRequestedCount: 0,
        approvedBy: ['reviewer1'],
      });
    });

    it('should return CHANGES_REQUESTED when changes requested', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
- state: CHANGES_REQUESTED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T10:00:00Z"
`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 2);

      expect(result).toEqual({
        reviewDecision: 'CHANGES_REQUESTED',
        approvalCount: 0,
        changesRequestedCount: 1,
        approvedBy: [],
      });
    });

    it('should use latest review per user', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
- state: APPROVED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T10:00:00Z"
- state: CHANGES_REQUESTED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T11:00:00Z"
`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 3);

      expect(result).toEqual({
        reviewDecision: 'CHANGES_REQUESTED',
        approvalCount: 0,
        changesRequestedCount: 1,
        approvedBy: [],
      });
    });

    it('should return CHANGES_REQUESTED if any user has changes requested', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
- state: APPROVED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T10:00:00Z"
- state: CHANGES_REQUESTED
  user:
    login: reviewer2
  submitted_at: "2025-01-01T10:00:00Z"
`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 4);

      expect(result).toEqual({
        reviewDecision: 'CHANGES_REQUESTED',
        approvalCount: 1,
        changesRequestedCount: 1,
        approvedBy: ['reviewer1'],
      });
    });

    it('should ignore COMMENTED state', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `
- state: APPROVED
  user:
    login: reviewer1
  submitted_at: "2025-01-01T10:00:00Z"
- state: COMMENTED
  user:
    login: reviewer2
  submitted_at: "2025-01-01T11:00:00Z"
`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 5);

      expect(result).toEqual({
        reviewDecision: 'APPROVED',
        approvalCount: 1,
        changesRequestedCount: 0,
        approvedBy: ['reviewer1'],
      });
    });

    it('should return null decision for empty reviews', async () => {
      vi.mocked(githubAuthService.isAuthenticated).mockResolvedValue(true);
      vi.mocked(augmentApiClient.callEndpoint).mockResolvedValue({
        status: 1,
        tool_output: `[]`,
        tool_result_message: 'OK',
      });

      const result = await service.getReviews('owner', 'repo', 6);

      expect(result).toEqual({
        reviewDecision: null,
        approvalCount: 0,
        changesRequestedCount: 0,
        approvedBy: [],
      });
    });
  });
});

