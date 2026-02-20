/**
 * Tests for change difference utility functions
 *
 * These tests cover the hasChangesDifference function which is critical for
 * ensuring the UI updates correctly when file tracking data changes.
 */

import { describe, it, expect } from 'vitest';
import {
  hasChangesDifference,
  hasTransitionsDifference,
  hasCommitsDifference,
} from '../change-difference-utils';
import { ChangeStage, type TrackedChange, type StageTransition, type CommitInfo } from '../types';

// Helper to create a TrackedChange for testing
function createChange(overrides: Partial<TrackedChange> & { relativePath: string }): TrackedChange {
  return {
    id: `change-${overrides.relativePath}`,
    file: `/path/to/${overrides.relativePath}`,
    stage: ChangeStage.Unstaged,
    stats: { additions: 10, deletions: 5 },
    attribution: { timestamp: Date.now() },
    ...overrides,
  };
}

describe('hasChangesDifference', () => {
  describe('array length differences', () => {
    it('should return true when incoming has more items', () => {
      const existing: TrackedChange[] = [];
      const incoming = [createChange({ relativePath: 'file.ts' })];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });

    it('should return true when incoming has fewer items', () => {
      const existing = [createChange({ relativePath: 'file.ts' })];
      const incoming: TrackedChange[] = [];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });

  describe('path and stage differences', () => {
    it('should return true when a new file path is added', () => {
      const existing = [createChange({ relativePath: 'file1.ts' })];
      const incoming = [createChange({ relativePath: 'file2.ts' })];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });

    it('should return true when file stage changes', () => {
      const existing = [createChange({ relativePath: 'file.ts', stage: ChangeStage.Unstaged })];
      const incoming = [createChange({ relativePath: 'file.ts', stage: ChangeStage.Staged })];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });

  describe('stats differences', () => {
    it('should return true when additions change', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 20, deletions: 5 },
          attribution: { timestamp },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });

    it('should return true when deletions change', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 15 },
          attribution: { timestamp },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });

  describe('ID differences (FIX for reactivity issue)', () => {
    it('should return true when change ID differs', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'old-id',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'new-id', // Different ID indicates new change object from backend
          stats: { additions: 10, deletions: 5 }, // Same stats
          attribution: { timestamp }, // Same timestamp
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });

  describe('attribution timestamp differences (FIX for reactivity issue)', () => {
    it('should return true when attribution timestamp differs', () => {
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'same-id',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp: 1000 },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'same-id', // Same ID
          stats: { additions: 10, deletions: 5 }, // Same stats
          attribution: { timestamp: 2000 }, // Different timestamp - file was modified
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });

  describe('no differences', () => {
    it('should return false when all fields match', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'same-id',
          stage: ChangeStage.Unstaged,
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'same-id',
          stage: ChangeStage.Unstaged,
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(false);
    });

    it('should return false for two empty arrays', () => {
      expect(hasChangesDifference([], [])).toBe(false);
    });

    it('should return false with multiple matching changes', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file1.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
        createChange({
          relativePath: 'file2.ts',
          id: 'id-2',
          stage: ChangeStage.Staged,
          stats: { additions: 20, deletions: 10 },
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file1.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
        createChange({
          relativePath: 'file2.ts',
          id: 'id-2',
          stage: ChangeStage.Staged,
          stats: { additions: 20, deletions: 10 },
          attribution: { timestamp },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined stats', () => {
      const timestamp = Date.now();
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: undefined as any,
          attribution: { timestamp },
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });

    it('should handle undefined attribution timestamp', () => {
      const existing = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: undefined as any,
        }),
      ];
      const incoming = [
        createChange({
          relativePath: 'file.ts',
          id: 'id-1',
          stats: { additions: 10, deletions: 5 },
          attribution: { timestamp: 1000 },
        }),
      ];

      expect(hasChangesDifference(existing, incoming)).toBe(true);
    });
  });
});

describe('hasTransitionsDifference', () => {
  // Helper to create a StageTransition for testing
  function createTransition(overrides: Partial<StageTransition> = {}): StageTransition {
    return {
      id: 'trans-1',
      changeId: 'change-1',
      fromStage: ChangeStage.Unstaged,
      toStage: ChangeStage.Staged,
      timestamp: Date.now(),
      actor: { type: 'user', id: 'user-1' },
      ...overrides,
    };
  }

  it('should return true when lengths differ', () => {
    const existing: StageTransition[] = [];
    const incoming = [createTransition()];

    expect(hasTransitionsDifference(existing, incoming)).toBe(true);
  });

  it('should return false for two empty arrays', () => {
    expect(hasTransitionsDifference([], [])).toBe(false);
  });

  it('should return true when last transition differs', () => {
    const existing = [createTransition({ changeId: 'change-1' })];
    const incoming = [createTransition({ changeId: 'change-2' })];

    expect(hasTransitionsDifference(existing, incoming)).toBe(true);
  });

  it('should return false when last transition matches', () => {
    const existing = [
      createTransition({
        changeId: 'change-1',
        fromStage: ChangeStage.Unstaged,
        toStage: ChangeStage.Staged,
      }),
    ];
    const incoming = [
      createTransition({
        changeId: 'change-1',
        fromStage: ChangeStage.Unstaged,
        toStage: ChangeStage.Staged,
      }),
    ];

    expect(hasTransitionsDifference(existing, incoming)).toBe(false);
  });
});

describe('hasCommitsDifference', () => {
  // Helper to create a CommitInfo for testing
  function createCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
    return {
      hash: 'abc123',
      message: 'Test commit',
      author: 'Test Author',
      timestamp: Date.now(),
      files: [],
      stage: 'local',
      ...overrides,
    };
  }

  it('should return true when lengths differ', () => {
    const existing: CommitInfo[] = [];
    const incoming = [createCommit()];

    expect(hasCommitsDifference(existing, incoming)).toBe(true);
  });

  it('should return true when hash is not found', () => {
    const existing = [createCommit({ hash: 'abc123' })];
    const incoming = [createCommit({ hash: 'def456' })];

    expect(hasCommitsDifference(existing, incoming)).toBe(true);
  });

  it('should return true when isPushed status changes', () => {
    const timestamp = Date.now();
    const existing = [createCommit({ hash: 'abc123', timestamp, isPushed: false })];
    const incoming = [createCommit({ hash: 'abc123', timestamp, isPushed: true })];

    expect(hasCommitsDifference(existing, incoming)).toBe(true);
  });

  it('should return false when all fields match', () => {
    const timestamp = Date.now();
    const existing = [createCommit({ hash: 'abc123', message: 'Test', timestamp })];
    const incoming = [createCommit({ hash: 'abc123', message: 'Test', timestamp })];

    expect(hasCommitsDifference(existing, incoming)).toBe(false);
  });
});
