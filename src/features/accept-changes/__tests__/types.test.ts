/**
 * Tests for accept-changes types
 *
 * These tests verify the type definitions are correctly structured
 * and can be used as expected.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import type {
  AcceptAction,
  MergeStrategy,
  StepStatus,
  WorkspaceGitStatus,
  LocalCommitInfo,
  AcceptChangesStep,
  AcceptChangesResult,
} from '../types';

describe('accept-changes types', () => {
  describe('AcceptAction', () => {
    it('should accept valid action values', () => {
      const actions: AcceptAction[] = ['commit', 'push', 'create-pr', 'merge', 'export'];
      expect(actions).toHaveLength(5);
    });
  });

  describe('MergeStrategy', () => {
    it('should accept valid merge strategy values', () => {
      const strategies: MergeStrategy[] = ['merge', 'squash', 'rebase'];
      expect(strategies).toHaveLength(3);
    });
  });

  describe('StepStatus', () => {
    it('should accept valid step status values', () => {
      const statuses: StepStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('WorkspaceGitStatus', () => {
    it('should create valid git status object', () => {
      const status: WorkspaceGitStatus = {
        branch: 'feature/test',
        trunkBranch: 'main',
        aheadOfTrunk: 3,
        behindTrunk: 0,
        hasRemote: true,
        isPushed: false,
        uncommittedCount: 2,
        stagedCount: 1,
        localCommits: [],
        canMergeDirectly: true,
        hasConflicts: false,
      };

      expect(status.branch).toBe('feature/test');
      expect(status.aheadOfTrunk).toBe(3);
      expect(status.hasRemote).toBe(true);
    });

    it('should support optional PR info', () => {
      const status: WorkspaceGitStatus = {
        branch: 'feature/test',
        trunkBranch: 'main',
        aheadOfTrunk: 1,
        behindTrunk: 0,
        hasRemote: true,
        isPushed: true,
        uncommittedCount: 0,
        stagedCount: 0,
        localCommits: [],
        canMergeDirectly: true,
        hasConflicts: false,
        existingPR: {
          number: 123,
          url: 'https://api.github.com/repos/owner/repo/pulls/123',
          htmlUrl: 'https://github.com/owner/repo/pull/123',
          title: 'Test PR',
          state: 'open',
        },
      };

      expect(status.existingPR?.number).toBe(123);
      expect(status.existingPR?.state).toBe('open');
    });
  });

  describe('LocalCommitInfo', () => {
    it('should create valid commit info', () => {
      const commit: LocalCommitInfo = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test User',
        date: '2025-12-13T10:00:00Z',
        filesChanged: 3,
        isPushed: false,
      };

      expect(commit.hash).toBe('abc123');
      expect(commit.filesChanged).toBe(3);
    });
  });

  describe('AcceptChangesStep', () => {
    it('should create valid step object', () => {
      const step: AcceptChangesStep = {
        id: 'commit',
        name: 'Commit changes',
        status: 'completed',
        message: 'Successfully committed',
      };

      expect(step.id).toBe('commit');
      expect(step.status).toBe('completed');
    });

    it('should support error message', () => {
      const step: AcceptChangesStep = {
        id: 'push',
        name: 'Push to remote',
        status: 'failed',
        error: 'Authentication failed',
      };

      expect(step.status).toBe('failed');
      expect(step.error).toBe('Authentication failed');
    });
  });

  describe('AcceptChangesResult', () => {
    it('should create successful result', () => {
      const result: AcceptChangesResult = {
        success: true,
        steps: [
          { id: 'commit', name: 'Commit', status: 'completed' },
          { id: 'push', name: 'Push', status: 'completed' },
        ],
        result: {
          commitHash: 'abc123',
          prNumber: 456,
          prUrl: 'https://api.github.com/repos/owner/repo/pulls/456',
          prHtmlUrl: 'https://github.com/owner/repo/pull/456',
        },
      };

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.result?.prNumber).toBe(456);
    });

    it('should create failed result', () => {
      const result: AcceptChangesResult = {
        success: false,
        steps: [{ id: 'commit', name: 'Commit', status: 'failed', error: 'No changes' }],
        error: 'Workflow failed',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Workflow failed');
    });
  });
});
