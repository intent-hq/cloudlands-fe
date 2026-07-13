/**
 * Tests for WorkspaceProgressCard git status refresh logic.
 *
 * These tests verify that the loadGitStatus() function's null-guarding behavior
 * prevents workflowStage flickering during same-workspace refreshes.
 *
 * The logic is extracted into git-status-refresh-utils.ts for testability,
 * mirroring the exact behavior in WorkspaceProgressCard.svelte lines 76-106.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import {
  shouldClearGitStatusBeforeLoad,
  shouldApplyGitStatusResult,
  shouldClearGitStatusOnError,
  isFetchCurrent,
  simulateLoadGitStatus,
  simulateOverlappingFetches,
  type GitStatusRefreshState,
} from '../git-status-refresh-utils';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeGitStatus(overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus {
  return {
    branch: 'feature/test',
    trunkBranch: 'main',
    aheadOfTrunk: 1,
    behindTrunk: 0,
    hasRemote: true,
    isPushed: false,
    uncommittedCount: 0,
    stagedCount: 0,
    localCommits: [],
    canMergeDirectly: true,
    hasConflicts: false,
    hasDivergedFromRemote: false,
    ...overrides,
  };
}

function makeGitStatusWithPR(): WorkspaceGitStatus {
  return makeGitStatus({
    existingPR: {
      number: 42,
      url: 'https://api.github.com/repos/owner/repo/pulls/42',
      htmlUrl: 'https://github.com/owner/repo/pull/42',
      title: 'Test PR',
      state: 'open',
    },
  });
}

function makeState(overrides: Partial<GitStatusRefreshState> = {}): GitStatusRefreshState {
  return {
    gitStatus: null,
    gitStatusLoading: false,
    lastLoadedWorkspaceId: undefined,
    fetchGeneration: 0,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WorkspaceProgressCard git status refresh logic', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // UNIT TESTS FOR INDIVIDUAL DECISION FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('shouldClearGitStatusBeforeLoad', () => {
    it('returns true when switching to a different workspace', () => {
      expect(shouldClearGitStatusBeforeLoad('ws-2', 'ws-1')).toBe(true);
    });

    it('returns false when refreshing the same workspace', () => {
      expect(shouldClearGitStatusBeforeLoad('ws-1', 'ws-1')).toBe(false);
    });

    it('returns true on first load (lastLoadedWorkspaceId is undefined)', () => {
      expect(shouldClearGitStatusBeforeLoad('ws-1', undefined)).toBe(true);
    });
  });

  describe('shouldApplyGitStatusResult', () => {
    it('returns true when workspace has not changed during fetch', () => {
      expect(shouldApplyGitStatusResult('ws-1', 'ws-1')).toBe(true);
    });

    it('returns false when workspace changed during fetch', () => {
      expect(shouldApplyGitStatusResult('ws-2', 'ws-1')).toBe(false);
    });
  });

  describe('shouldClearGitStatusOnError', () => {
    it('returns true for workspace switch error (stale data should be cleared)', () => {
      // currentWorkspaceId matches captured, but differs from lastLoaded
      expect(shouldClearGitStatusOnError('ws-2', 'ws-2', 'ws-1')).toBe(true);
    });

    it('returns false for same-workspace refresh error (preserve existing data)', () => {
      // currentWorkspaceId matches captured AND matches lastLoaded
      expect(shouldClearGitStatusOnError('ws-1', 'ws-1', 'ws-1')).toBe(false);
    });

    it('returns false when workspace changed during fetch (discard error)', () => {
      // currentWorkspaceId does NOT match captured
      expect(shouldClearGitStatusOnError('ws-2', 'ws-1', 'ws-1')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION TESTS FOR FULL FLOW (simulateLoadGitStatus)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('simulateLoadGitStatus - full flow', () => {
    it('Scenario 1: PR stays visible during same-workspace refresh', () => {
      // Setup: workspace ws-1 has been loaded with a PR
      const prStatus = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: prStatus,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Refresh for the same workspace with updated data
      const updatedStatus = makeGitStatusWithPR();
      const result = simulateLoadGitStatus(
        state,
        'ws-1',
        { ok: true, data: updatedStatus },
      );

      // gitStatus should NEVER have been null during the process
      // (the function preserves existing data for same-workspace refresh)
      expect(result.gitStatus).toBe(updatedStatus);
      expect(result.gitStatus?.existingPR?.state).toBe('open');
      expect(result.lastLoadedWorkspaceId).toBe('ws-1');
      expect(result.gitStatusLoading).toBe(false);
    });

    it('Scenario 2: Workspace switch clears stale data', () => {
      // Setup: workspace ws-1 has been loaded with a PR
      const prStatus = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: prStatus,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Switch to ws-2 which has no PR
      const ws2Status = makeGitStatus({ existingPR: undefined });
      const result = simulateLoadGitStatus(
        state,
        'ws-2',
        { ok: true, data: ws2Status },
      );

      // Should have new data, no PR
      expect(result.gitStatus).toBe(ws2Status);
      expect(result.gitStatus?.existingPR).toBeUndefined();
      expect(result.lastLoadedWorkspaceId).toBe('ws-2');
    });

    it('Scenario 3: Error during same-workspace refresh preserves existing data', () => {
      // Setup: workspace ws-1 has been loaded with a PR
      const prStatus = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: prStatus,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Same-workspace refresh fails
      const result = simulateLoadGitStatus(
        state,
        'ws-1',
        { ok: false, error: new Error('Network error') },
      );

      // Existing data should be PRESERVED (not nulled out)
      expect(result.gitStatus).toBe(prStatus);
      expect(result.gitStatus?.existingPR?.state).toBe('open');
      expect(result.gitStatusLoading).toBe(false);
      // lastLoadedWorkspaceId should remain ws-1 (not updated on error)
      expect(result.lastLoadedWorkspaceId).toBe('ws-1');
    });

    it('Scenario 4: Error during workspace switch clears stale data', () => {
      // Setup: workspace ws-1 has been loaded with a PR
      const prStatus = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: prStatus,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Switch to ws-2 but the fetch fails
      const result = simulateLoadGitStatus(
        state,
        'ws-2',
        { ok: false, error: new Error('Network error') },
      );

      // Stale data from ws-1 should be cleared (null)
      expect(result.gitStatus).toBeNull();
      expect(result.gitStatusLoading).toBe(false);
    });

    it('Scenario 5: Async guard prevents stale updates when workspace changes during fetch', () => {
      // Setup: workspace ws-1 has been loaded
      const ws1Status = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: ws1Status,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Start loading for ws-1, but workspace changes to ws-2 during the fetch
      const staleResult = makeGitStatus({ branch: 'stale-branch' });
      const result = simulateLoadGitStatus(
        state,
        'ws-1', // capturedWorkspaceId at start of load
        { ok: true, data: staleResult },
        'ws-2', // workspaceId changed to ws-2 during the async call
      );

      // The stale result should be DISCARDED
      // gitStatus should remain as it was (ws-1 data preserved since no clear happened)
      expect(result.gitStatus).toBe(ws1Status);
      expect(result.gitStatus?.branch).toBe('feature/test');
      // Loading should NOT be cleared (different workspace is now active)
      expect(result.gitStatusLoading).toBe(true);
    });

    it('Scenario 5b: Async guard on error when workspace changes during fetch', () => {
      // Setup: workspace ws-1 has been loaded
      const ws1Status = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: ws1Status,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // Start loading for ws-1, but workspace changes to ws-2 during the fetch
      const result = simulateLoadGitStatus(
        state,
        'ws-1', // capturedWorkspaceId at start of load
        { ok: false, error: new Error('Timeout') },
        'ws-2', // workspaceId changed to ws-2 during the async call
      );

      // Error for stale workspace should be IGNORED
      // gitStatus should remain as it was
      expect(result.gitStatus).toBe(ws1Status);
      expect(result.gitStatusLoading).toBe(true);
    });

    it('First load for a workspace sets data correctly', () => {
      // Setup: no previous workspace loaded
      const state = makeState();

      const newStatus = makeGitStatusWithPR();
      const result = simulateLoadGitStatus(
        state,
        'ws-1',
        { ok: true, data: newStatus },
      );

      expect(result.gitStatus).toBe(newStatus);
      expect(result.lastLoadedWorkspaceId).toBe('ws-1');
      expect(result.gitStatusLoading).toBe(false);
    });

    it('fetchGeneration is incremented on each load', () => {
      const state = makeState();
      const status1 = makeGitStatus();
      const result = simulateLoadGitStatus(state, 'ws-1', { ok: true, data: status1 });
      expect(result.fetchGeneration).toBe(1);

      const result2 = simulateLoadGitStatus(result, 'ws-1', { ok: true, data: status1 });
      expect(result2.fetchGeneration).toBe(2);
    });

    it('Sequential refreshes for same workspace always preserve data', () => {
      // Setup: workspace ws-1 loaded
      const status1 = makeGitStatusWithPR();
      let state = makeState({
        gitStatus: status1,
        lastLoadedWorkspaceId: 'ws-1',
      });

      // First refresh succeeds
      const status2 = makeGitStatus({
        existingPR: { ...status1.existingPR!, title: 'Updated PR' },
      });
      state = simulateLoadGitStatus(state, 'ws-1', { ok: true, data: status2 });
      expect(state.gitStatus?.existingPR?.title).toBe('Updated PR');

      // Second refresh fails - should keep status2
      state = simulateLoadGitStatus(
        state,
        'ws-1',
        { ok: false, error: new Error('Transient error') },
      );
      expect(state.gitStatus?.existingPR?.title).toBe('Updated PR');

      // Third refresh succeeds with new data
      const status3 = makeGitStatus({
        existingPR: { ...status1.existingPR!, title: 'Final PR' },
      });
      state = simulateLoadGitStatus(state, 'ws-1', { ok: true, data: status3 });
      expect(state.gitStatus?.existingPR?.title).toBe('Final PR');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH GENERATION GUARD (RACE CONDITION TESTS)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('isFetchCurrent', () => {
    it('returns true when generations match', () => {
      expect(isFetchCurrent(3, 3)).toBe(true);
    });

    it('returns false when captured generation is older', () => {
      expect(isFetchCurrent(1, 3)).toBe(false);
    });
  });

  describe('simulateOverlappingFetches - race condition guard', () => {
    it('older fetch result is discarded when newer fetch resolves first', () => {
      const state = makeState({
        gitStatus: makeGitStatusWithPR(),
        lastLoadedWorkspaceId: 'ws-1',
        fetchGeneration: 0,
      });

      const olderResult = makeGitStatus({ branch: 'stale-branch' });
      const newerResult = makeGitStatus({ branch: 'fresh-branch' });

      // Second fetch resolves first, then first fetch resolves (stale)
      const finalState = simulateOverlappingFetches(
        state,
        'ws-1',
        { ok: true, data: olderResult },
        { ok: true, data: newerResult },
      );

      // Only the newer result should be applied
      expect(finalState.gitStatus?.branch).toBe('fresh-branch');
      expect(finalState.gitStatusLoading).toBe(false);
    });

    it('older fetch error is discarded when newer fetch resolves first', () => {
      const state = makeState({
        gitStatus: makeGitStatusWithPR(),
        lastLoadedWorkspaceId: 'ws-1',
        fetchGeneration: 0,
      });

      const newerResult = makeGitStatus({ branch: 'fresh-branch' });

      // Second fetch resolves successfully, then first fetch errors (stale)
      const finalState = simulateOverlappingFetches(
        state,
        'ws-1',
        { ok: false, error: new Error('Stale error') },
        { ok: true, data: newerResult },
      );

      // Newer result should be applied; stale error should be ignored
      expect(finalState.gitStatus?.branch).toBe('fresh-branch');
      expect(finalState.gitStatusLoading).toBe(false);
    });

    it('newer fetch error preserves data when older fetch also errored', () => {
      const existingStatus = makeGitStatusWithPR();
      const state = makeState({
        gitStatus: existingStatus,
        lastLoadedWorkspaceId: 'ws-1',
        fetchGeneration: 0,
      });

      // Both fetches fail - newer resolves first, older resolves second
      const finalState = simulateOverlappingFetches(
        state,
        'ws-1',
        { ok: false, error: new Error('Old error') },
        { ok: false, error: new Error('New error') },
      );

      // For same-workspace refresh errors, existing data should be preserved
      expect(finalState.gitStatus).toBe(existingStatus);
      expect(finalState.gitStatus?.existingPR?.state).toBe('open');
    });

    it('newer fetch result wins even when older fetch has "better" data', () => {
      const state = makeState({
        gitStatus: null,
        lastLoadedWorkspaceId: undefined,
        fetchGeneration: 0,
      });

      const olderResultWithPR = makeGitStatusWithPR();
      const newerResultNoPR = makeGitStatus({ existingPR: undefined });

      const finalState = simulateOverlappingFetches(
        state,
        'ws-1',
        { ok: true, data: olderResultWithPR },
        { ok: true, data: newerResultNoPR },
      );

      // Newer result should win, even though older had a PR
      expect(finalState.gitStatus?.existingPR).toBeUndefined();
      expect(finalState.gitStatusLoading).toBe(false);
    });
  });
});
