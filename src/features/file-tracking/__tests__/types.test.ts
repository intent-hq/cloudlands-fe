/**
 * Tests for file tracking types
 */

import { describe, it, expect } from 'vitest';
import {
  ChangeStage,
  type TrackedChange,
  type FileStats,
  type DiffHunk,
  type StageTransition,
  type WorkingChanges,
  type CommitInfo,
  type ChangeFilter,
} from '../types';

describe('file-tracking types', () => {
  describe('ChangeStage enum', () => {
    it('should have all expected stages', () => {
      expect(ChangeStage.Unstaged).toBe('unstaged');
      expect(ChangeStage.Staged).toBe('staged');
      expect(ChangeStage.Committed).toBe('committed');
      expect(ChangeStage.Pushed).toBe('pushed');
      expect(ChangeStage.PullRequest).toBe('pull_request');
      expect(ChangeStage.Merged).toBe('merged');
      expect(ChangeStage.Trunk).toBe('trunk');
    });
  });

  describe('TrackedChange', () => {
    it('should accept valid tracked change', () => {
      const change: TrackedChange = {
        id: 'change-1',
        file: '/path/to/file.ts',
        relativePath: 'file.ts',
        stage: ChangeStage.Unstaged,
        stats: { additions: 10, deletions: 5 },
        attribution: { timestamp: Date.now() },
      };
      expect(change.id).toBe('change-1');
      expect(change.stage).toBe(ChangeStage.Unstaged);
    });

    it('should accept change with agent attribution', () => {
      const change: TrackedChange = {
        id: 'change-2',
        file: '/path/to/file.ts',
        relativePath: 'file.ts',
        stage: ChangeStage.Staged,
        stats: { additions: 5, deletions: 0 },
        attribution: {
          agent: {
            agentId: 'agent-1',
            agentName: 'Test Agent',
            sessionId: 'session-1',
            turnNumber: 1,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        },
      };
      expect(change.attribution.agent?.agentId).toBe('agent-1');
    });
  });

  describe('FileStats', () => {
    it('should accept valid file stats', () => {
      const stats: FileStats = {
        additions: 100,
        deletions: 50,
        binary: false,
      };
      expect(stats.additions).toBe(100);
      expect(stats.deletions).toBe(50);
    });
  });

  describe('DiffHunk', () => {
    it('should accept valid diff hunk', () => {
      const hunk: DiffHunk = {
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 7,
        lines: [
          { type: 'context', content: 'unchanged line' },
          { type: 'remove', content: 'removed line', oldLineNumber: 2 },
          { type: 'add', content: 'added line', newLineNumber: 2 },
        ],
      };
      expect(hunk.lines).toHaveLength(3);
    });
  });

  describe('StageTransition', () => {
    it('should accept valid stage transition', () => {
      const transition: StageTransition = {
        id: 'trans-1',
        changeId: 'change-1',
        fromStage: ChangeStage.Unstaged,
        toStage: ChangeStage.Staged,
        timestamp: Date.now(),
        actor: { type: 'user', id: 'user-1' },
      };
      expect(transition.fromStage).toBe(ChangeStage.Unstaged);
      expect(transition.toStage).toBe(ChangeStage.Staged);
    });
  });

  describe('WorkingChanges', () => {
    it('should accept valid working changes', () => {
      const changes: WorkingChanges = {
        unstaged: [],
        staged: [],
      };
      expect(changes.unstaged).toEqual([]);
      expect(changes.staged).toEqual([]);
    });
  });

  describe('CommitInfo', () => {
    it('should accept valid commit info', () => {
      const commit: CommitInfo = {
        hash: 'abc123',
        message: 'Test commit',
        author: 'Test User',
        timestamp: Date.now(),
        files: [{ path: 'file.ts', additions: 10, deletions: 5 }],
        stage: 'local',
      };
      expect(commit.hash).toBe('abc123');
      expect(commit.stage).toBe('local');
    });
  });

  describe('ChangeFilter', () => {
    it('should accept valid change filter', () => {
      const filter: ChangeFilter = {
        stage: [ChangeStage.Unstaged, ChangeStage.Staged],
        agentId: 'agent-1',
        filePattern: '*.ts',
      };
      expect(filter.stage).toHaveLength(2);
      expect(filter.agentId).toBe('agent-1');
    });
  });
});
