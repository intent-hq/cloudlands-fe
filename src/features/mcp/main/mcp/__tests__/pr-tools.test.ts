/**
 * Tests for WaitForPRChangesTool
 * Verifies polling behavior, change detection, and timeout handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WaitForPRChangesTool, SAFETY_PADDING_SECONDS } from '../pr-tools';
import type { ToolCall } from '../protocol';

// Mock external dependencies
vi.mock('$features/git-tracking/main/github.service', () => ({
  githubService: {
    getPullRequest: vi.fn(),
  },
}));

vi.mock('$shared/augment-api/augment-api.client', () => ({
  augmentApiClient: {
    callEndpoint: vi.fn(),
  },
}));

vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

import { githubService } from '$features/git-tracking/main/github.service';
import { augmentApiClient } from '$shared/augment-api/augment-api.client';

// Type assertions for mocked functions
const mockGetPullRequest = githubService.getPullRequest as ReturnType<typeof vi.fn>;
const mockCallEndpoint = augmentApiClient.callEndpoint as ReturnType<typeof vi.fn>;

describe('WaitForPRChangesTool', () => {
  const prContext = { owner: 'testOwner', repo: 'testRepo', prNumber: 123 };

  const createBasePR = (overrides: Record<string, unknown> = {}) => ({
    number: 123,
    title: 'Test PR',
    state: 'open',
    mergeable: true,
    mergeableState: 'clean',
    headSha: 'abc123',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: no check runs
    mockCallEndpoint.mockResolvedValue({
      status: 1,
      tool_output: 'check_runs: []',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Input validation', () => {
    it('should clamp timeout_seconds below minimum to 10', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR();
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 5, poll_interval_seconds: 10 },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
    });

    it('should clamp timeout_seconds above maximum to 600', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 1000, poll_interval_seconds: 60 },
      };

      const executePromise = tool.execute(call);
      // Advance past 600 seconds to trigger timeout
      await vi.advanceTimersByTimeAsync(610000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have polled ~10 times (600s / 60s interval)
      expect((result as any).metadata.iterations).toBeLessThanOrEqual(10);
    });

    it('should use default values when parameters not provided', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: {},
      };

      const executePromise = tool.execute(call);
      // Let it run briefly then check - defaults are 300s timeout, 15s interval
      await vi.advanceTimersByTimeAsync(305000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
    });

    it('should clamp poll_interval_seconds below minimum to 10', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR();
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 3 },
      };

      const executePromise = tool.execute(call);
      // Even with poll_interval=3 requested, it should be clamped to 10
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
    });

    it('should clamp poll_interval_seconds above maximum to 60', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 120, poll_interval_seconds: 100 },
      };

      const executePromise = tool.execute(call);
      // With poll_interval clamped to 60, should poll once after 60s then timeout
      await vi.advanceTimersByTimeAsync(125000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have ~2 iterations (120s / 60s interval)
      expect((result as any).metadata.iterations).toBe(2);
    });

    it('should fall back to default timeout when non-numeric value is passed', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        // Pass non-numeric string that cannot be coerced
        arguments: { timeout_seconds: 'abc', poll_interval_seconds: 15 },
      };

      const executePromise = tool.execute(call);
      // Default timeout is 300s, effective timeout with safety padding is 290s
      await vi.advanceTimersByTimeAsync(295000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have used default 300s timeout (effective: 290s due to safety padding), not 0ms (NaN) which would cause tight loop
      const defaultTimeoutSeconds = 300;
      const expectedEffectiveTimeout = defaultTimeoutSeconds - SAFETY_PADDING_SECONDS;
      expect((result as any).metadata.elapsedSeconds).toBeGreaterThanOrEqual(expectedEffectiveTimeout - 1);
    });

    it('should fall back to default poll_interval when non-numeric value is passed', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        // Pass non-numeric string that cannot be coerced
        arguments: { timeout_seconds: 30, poll_interval_seconds: 'abc' },
      };

      const executePromise = tool.execute(call);
      // With default 15s poll interval (clamped to 15), advance past timeout
      await vi.advanceTimersByTimeAsync(35000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have polled ~2 times (30s / 15s interval) instead of infinite times with 0ms interval
      expect((result as any).metadata.iterations).toBeLessThanOrEqual(3);
    });

    it('should correctly coerce string-numeric values to numbers', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR();
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        // Pass string numbers that should be coerced correctly
        arguments: { timeout_seconds: '30', poll_interval_seconds: '10' },
      };

      const executePromise = tool.execute(call);
      // String "10" should be coerced to number 10
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
    });
  });

  describe('PR not found', () => {
    it('should return error when initial PR fetch fails', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      mockGetPullRequest.mockResolvedValue(null);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 10, poll_interval_seconds: 10 },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Could not fetch PR #123');
    });

    it('should continue polling when mid-poll fetch fails', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR();
      const pr3 = createBasePR({ state: 'closed' });

      // First call succeeds (initial), second fails (mid-poll), third succeeds with change
      mockGetPullRequest
        .mockResolvedValueOnce(pr1)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(pr3);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 60, poll_interval_seconds: 10 },
      };

      const executePromise = tool.execute(call);
      // Advance through two poll intervals
      await vi.advanceTimersByTimeAsync(10000);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
    });
  });

  describe('Change detection - "any" mode', () => {
    it('should detect head SHA change (new commits)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ headSha: 'abc123' });
      const pr2 = createBasePR({ headSha: 'def456' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('New commit');
    });

    it('should detect state change (open → closed)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed: open → closed');
    });

    it('should detect mergeability change', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ mergeable: true });
      const pr2 = createBasePR({ mergeable: false });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Mergeable changed');
    });

    it('should detect mergeable state change', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ mergeableState: 'clean' });
      const pr2 = createBasePR({ mergeableState: 'dirty' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Mergeable state changed: clean → dirty');
    });

    it('should detect check run status changes', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // First poll: check in_progress, second poll: check success
      mockCallEndpoint
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: in_progress\n    conclusion: null',
        })
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: completed\n    conclusion: success',
        });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Check "CI"');
    });

    it('should detect new check runs appearing', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // First poll: no checks, second poll: new check
      mockCallEndpoint
        .mockResolvedValueOnce({ status: 1, tool_output: 'check_runs: []' })
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: Lint\n    status: completed\n    conclusion: success',
        });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('New check: Lint');
    });

    it('should detect updatedAt change when no other changes detected (comments/reviews)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ updatedAt: '2024-01-01T00:00:00Z' });
      const pr2 = createBasePR({ updatedAt: '2024-01-01T00:05:00Z' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('PR updated');
    });

    it('should not report updatedAt change when other changes are detected', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open', updatedAt: '2024-01-01T00:00:00Z' });
      const pr2 = createBasePR({ state: 'closed', updatedAt: '2024-01-01T00:05:00Z' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
      // Should NOT contain PR updated since state change was already detected
      expect((result.content[0] as any).text).not.toContain('PR updated');
    });
  });

  describe('Change detection - "commits" mode', () => {
    it('should detect head SHA change', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ headSha: 'abc123' });
      const pr2 = createBasePR({ headSha: 'def456' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'commits' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('New commit');
    });

    it('should ignore state changes in commits mode', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValue(pr1).mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 15, poll_interval_seconds: 10, watch: 'commits' },
      };

      const executePromise = tool.execute(call);
      // Advance past timeout
      await vi.advanceTimersByTimeAsync(20000);
      const result = await executePromise;

      // Should timeout since state changes are ignored in commits mode
      expect((result as any).metadata.changed).toBe(false);
    });
  });

  describe('Change detection - "state" mode', () => {
    it('should detect state changes', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'merged' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'state' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
    });

    it('should ignore commit changes in state mode', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ headSha: 'abc123' });
      const pr2 = createBasePR({ headSha: 'def456' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 15, poll_interval_seconds: 10, watch: 'state' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(20000);
      const result = await executePromise;

      // Should timeout since commit changes are ignored in state mode
      expect((result as any).metadata.changed).toBe(false);
    });
  });

  describe('Change detection - "checks" mode', () => {
    it('should detect check run changes', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      mockCallEndpoint
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: Build\n    status: queued\n    conclusion: null',
        })
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: Build\n    status: completed\n    conclusion: success',
        });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Check "Build"');
    });

    it('should ignore state changes in checks mode', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 15, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(20000);
      const result = await executePromise;

      // Should timeout since state changes are ignored in checks mode
      expect((result as any).metadata.changed).toBe(false);
    });
  });

  describe('Check runs parsing', () => {
    it('should handle empty check run response gracefully', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);
      mockCallEndpoint.mockResolvedValue({ status: 1, tool_output: '' });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 15, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(20000);
      const result = await executePromise;

      // Should timeout without error
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
    });

    it('should continue without checks when API fails', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);
      // API returns error status
      mockCallEndpoint.mockResolvedValue({ status: 2, tool_output: 'Error fetching check runs' });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'any' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      // Should still detect state change despite check run fetch failure
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
    });

    it('should skip check runs comparison when initial fetch failed (avoid spurious changes)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Initial fetch fails, subsequent fetch succeeds with checks
      // This should NOT report spurious "new check" changes
      mockCallEndpoint
        .mockRejectedValueOnce(new Error('API temporarily unavailable'))
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: completed\n    conclusion: success',
        });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 20, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(25000);
      const result = await executePromise;

      // Should timeout without detecting spurious changes since initial fetch failed
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should NOT contain "New check" since initial fetch failed
      expect((result.content[0] as any).text).not.toContain('New check');
    });

    it('should skip check runs comparison when current fetch failed (avoid spurious changes)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Initial fetch succeeds with checks, subsequent fetch fails
      // This should NOT report spurious changes
      mockCallEndpoint
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: in_progress\n    conclusion: null',
        })
        .mockRejectedValueOnce(new Error('API temporarily unavailable'));

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 20, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(25000);
      const result = await executePromise;

      // Should timeout without detecting spurious changes since current fetch failed
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
    });

    it('should parse valid YAML check run response', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const yamlResponse = `check_runs:
  - name: CI
    status: completed
    conclusion: success
  - name: Lint
    status: in_progress
    conclusion: null`;

      mockCallEndpoint
        .mockResolvedValueOnce({ status: 1, tool_output: yamlResponse })
        .mockResolvedValueOnce({
          status: 1,
          tool_output: `check_runs:
  - name: CI
    status: completed
    conclusion: success
  - name: Lint
    status: completed
    conclusion: success`,
        });

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 30, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(10000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Check "Lint"');
    });

    it('should update check-runs baseline when initial fetch fails but subsequent poll succeeds', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Initial fetch fails, poll 1 succeeds with in_progress, poll 2 succeeds with completed
      // After baseline recovery on poll 1, poll 2 should detect the change
      mockCallEndpoint
        .mockRejectedValueOnce(new Error('API temporarily unavailable')) // Initial fetch fails
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: in_progress\n    conclusion: null',
        }) // Poll 1: succeeds, becomes new baseline
        .mockResolvedValueOnce({
          status: 1,
          tool_output: 'check_runs:\n  - name: CI\n    status: completed\n    conclusion: success',
        }); // Poll 2: change from in_progress to completed

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 40, poll_interval_seconds: 10, watch: 'checks' },
      };

      const executePromise = tool.execute(call);
      // Advance through 2 poll intervals
      await vi.advanceTimersByTimeAsync(10000); // Poll 1: baseline recovery
      await vi.advanceTimersByTimeAsync(10000); // Poll 2: should detect change
      const result = await executePromise;

      // Should detect check run change after baseline recovery
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('Check "CI"');
    });
  });

  describe('Timeout behavior', () => {
    it('should return changed: false on timeout (not error)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 10, poll_interval_seconds: 10 },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      expect((result.content[0] as any).text).toContain('Timeout reached');
    });

    it('should include current state in timeout message', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR({ state: 'open', headSha: 'abc123', mergeable: true });

      mockGetPullRequest.mockResolvedValue(pr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 10, poll_interval_seconds: 10 },
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await executePromise;

      const text = (result.content[0] as any).text;
      expect(text).toContain('State: open');
      expect(text).toContain('Head SHA: abc123');
      expect(text).toContain('Mergeable: true');
    });

    it('should use last polled snapshot (not initial) in timeout message and metadata', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      // Initial snapshot has different values than last polled
      // Use same headSha and state to avoid triggering change detection
      // but vary mergeable/mergeableState which are not watched in 'commits' mode
      const initialPr = createBasePR({ state: 'open', headSha: 'same123', mergeable: true, mergeableState: 'clean' });
      const lastPolledPr = createBasePR({ state: 'open', headSha: 'same123', mergeable: false, mergeableState: 'dirty' });

      // First call returns initial, subsequent calls return lastPolled (same headSha, so no change detected in commits mode)
      mockGetPullRequest
        .mockResolvedValueOnce(initialPr)
        .mockResolvedValue(lastPolledPr);

      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 25, poll_interval_seconds: 10, watch: 'commits' }, // Only watch commits, not state/mergeable
      };

      const executePromise = tool.execute(call);
      await vi.advanceTimersByTimeAsync(30000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      const text = (result.content[0] as any).text;
      // Should contain lastSnapshot values, not initial
      expect(text).toContain('Mergeable: false');
      expect(text).toContain('Mergeable State: dirty');
      // Metadata snapshot should also be lastSnapshot
      expect((result as any).metadata.snapshot.mergeable).toBe(false);
    });

    it('should clamp sleep duration to remaining time when remaining < poll interval', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Use 15s timeout with 10s poll interval
      // After first poll at ~10s, remaining is ~5s, so sleep should be clamped to ~5s
      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: 15, poll_interval_seconds: 10, watch: 'any' },
      };

      const startTime = Date.now();
      const executePromise = tool.execute(call);

      // Advance 10s for first poll
      await vi.advanceTimersByTimeAsync(10000);
      // Advance another 5s (clamped sleep) - should be enough to hit timeout
      await vi.advanceTimersByTimeAsync(5000);
      // Small buffer
      await vi.advanceTimersByTimeAsync(1000);

      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Total elapsed should be ~15s (not 20s which would happen without clamping)
      expect((result as any).metadata.elapsedSeconds).toBeLessThanOrEqual(16);
    });

    it('should exit polling loop ~10 seconds before stated timeout (safety padding)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Use 60s timeout with 10s poll interval
      // With 10s safety padding, effective timeout should be 50s
      const timeout = 60;
      const pollInterval = 10;
      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: timeout, poll_interval_seconds: pollInterval },
      };

      const executePromise = tool.execute(call);
      // Advance to just before effective timeout (50s)
      await vi.advanceTimersByTimeAsync(55000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have timed out at ~50s (effective timeout), not 60s (stated timeout)
      const elapsedSeconds = (result as any).metadata.elapsedSeconds;
      expect(elapsedSeconds).toBeLessThanOrEqual(timeout - SAFETY_PADDING_SECONDS + 1);
      expect(elapsedSeconds).toBeGreaterThanOrEqual(timeout - SAFETY_PADDING_SECONDS - 1);
    });

    it('should ensure at least one poll interval even with short timeout (safety padding floor)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr1 = createBasePR({ state: 'open' });
      const pr2 = createBasePR({ state: 'closed' });

      mockGetPullRequest.mockResolvedValueOnce(pr1).mockResolvedValueOnce(pr2);

      // Use 20s timeout with 15s poll interval
      // Without the floor, effective timeout would be 20s - 10s = 10s (less than poll interval)
      // With the floor, effective timeout = Math.max(15s, 10s) = 15s
      const timeout = 20;
      const pollInterval = 15;
      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: timeout, poll_interval_seconds: pollInterval },
      };

      const executePromise = tool.execute(call);
      // Advance past one poll interval - change should be detected
      await vi.advanceTimersByTimeAsync(pollInterval * 1000);
      const result = await executePromise;

      // Should have detected the change after one poll, proving at least one poll happened
      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(true);
      expect((result.content[0] as any).text).toContain('State changed');
    });

    it('should still timeout with short timeout if no change detected (safety padding floor timeout)', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Use 20s timeout with 15s poll interval - effective timeout is 15s (one poll interval)
      const timeout = 20;
      const pollInterval = 15;
      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: timeout, poll_interval_seconds: pollInterval },
      };

      const executePromise = tool.execute(call);
      // Advance past effective timeout
      await vi.advanceTimersByTimeAsync(20000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have timed out at ~15s (effective timeout = poll interval), not 10s (timeout - padding)
      const elapsedSeconds = (result as any).metadata.elapsedSeconds;
      expect(elapsedSeconds).toBeGreaterThanOrEqual(pollInterval - 1);
      expect(elapsedSeconds).toBeLessThanOrEqual(pollInterval + 2);
    });

    it('should cap effective timeout at user-provided timeout when poll interval exceeds timeout', async () => {
      const tool = new WaitForPRChangesTool(prContext);
      const pr = createBasePR();

      mockGetPullRequest.mockResolvedValue(pr);

      // Use 10s timeout with 60s poll interval (poll > timeout)
      // Without the cap, effective timeout would be max(60s, 10s - 10s) = 60s (exceeds user timeout!)
      // With the cap, effective timeout = min(10s, 60s) = 10s
      const timeout = 10;
      const pollInterval = 60;
      const call: ToolCall = {
        name: 'wait_for_pr_changes',
        arguments: { timeout_seconds: timeout, poll_interval_seconds: pollInterval },
      };

      const executePromise = tool.execute(call);
      // Advance past the user timeout
      await vi.advanceTimersByTimeAsync(timeout * 1000 + 1000);
      const result = await executePromise;

      expect(result.isError).toBe(false);
      expect((result as any).metadata.changed).toBe(false);
      // Should have timed out at ~10s (user timeout), not 60s (poll interval)
      const elapsedSeconds = (result as any).metadata.elapsedSeconds;
      expect(elapsedSeconds).toBeLessThanOrEqual(timeout + 1);
    });
  });
});
