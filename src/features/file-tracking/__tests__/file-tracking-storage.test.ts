import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChangeStage,
  type AgentAttribution,
  type StageTransition,
  type TrackedChange,
} from '../types';

vi.mock('$lib/utils/logger', () => ({
  Logger: vi.fn(function Logger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }),
}));

vi.mock('../../../shared/git/git-blob-storage', () => ({
  getBlob: vi.fn(),
  isGitRepository: vi.fn().mockResolvedValue(false),
}));

import { FileTrackingStorage } from '../main/file-tracking-storage';

function createChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: 'change-1',
    file: 'src/app.ts',
    relativePath: 'src/app.ts',
    stage: ChangeStage.Unstaged,
    status: 'modified',
    stats: { additions: 1, deletions: 1, binary: false },
    attribution: { manual: true, timestamp: Date.now() },
    ...overrides,
  };
}

describe('FileTrackingStorage (in-memory)', () => {
  afterEach(() => {
    FileTrackingStorage.clearAllInstances();
  });

  it('returns an empty list for a fresh instance', async () => {
    const storage = FileTrackingStorage.getInstance('ws-fresh');
    await expect(storage.loadTrackedChanges()).resolves.toEqual([]);
    await expect(storage.loadTransitions()).resolves.toEqual([]);
    await expect(storage.loadAttributions()).resolves.toEqual(new Map());
  });

  it('round-trips tracked changes in memory', async () => {
    const storage = FileTrackingStorage.getInstance('ws-roundtrip');
    const change = createChange();

    await storage.saveTrackedChanges([change]);

    await expect(storage.loadTrackedChanges()).resolves.toEqual([change]);
  });

  it('keeps instances isolated per workspace', async () => {
    const storageA = FileTrackingStorage.getInstance('ws-a');
    const storageB = FileTrackingStorage.getInstance('ws-b');

    await storageA.saveTrackedChanges([createChange()]);

    await expect(storageB.loadTrackedChanges()).resolves.toEqual([]);
    expect(FileTrackingStorage.getInstance('ws-a')).toBe(storageA);
  });

  it('deduplicates changes keeping the latest per file and stage', async () => {
    const storage = FileTrackingStorage.getInstance('ws-dedupe');
    const older = createChange({
      id: 'older',
      attribution: { manual: true, timestamp: 1000 },
    });
    const newer = createChange({
      id: 'newer',
      attribution: { manual: true, timestamp: 2000 },
    });

    await storage.saveTrackedChanges([older, newer]);

    await expect(storage.loadTrackedChanges()).resolves.toEqual([newer]);
  });

  it('preserves committed changes with distinct commit hashes', async () => {
    const storage = FileTrackingStorage.getInstance('ws-commits');
    const commitA = createChange({
      id: 'commit-a',
      stage: ChangeStage.Committed,
      commitHash: 'aaa',
    });
    const commitB = createChange({
      id: 'commit-b',
      stage: ChangeStage.Committed,
      commitHash: 'bbb',
    });

    await storage.saveTrackedChanges([commitA, commitB]);

    const loaded = await storage.loadTrackedChanges();
    expect(loaded.map((change) => change.id).sort()).toEqual(['commit-a', 'commit-b']);
  });

  it('round-trips stage transitions in memory', async () => {
    const storage = FileTrackingStorage.getInstance('ws-transitions');
    const transition: StageTransition = {
      id: 'transition-1',
      changeId: 'change-1',
      fromStage: ChangeStage.Unstaged,
      toStage: ChangeStage.Staged,
      timestamp: Date.now(),
      actor: { type: 'user', id: 'user-1' },
    };

    await storage.saveTransitions([transition]);

    await expect(storage.loadTransitions()).resolves.toEqual([transition]);
  });

  it('round-trips agent attributions in memory', async () => {
    const storage = FileTrackingStorage.getInstance('ws-attributions');
    const attribution: AgentAttribution = {
      agentId: 'agent-1',
      agentName: 'Agent One',
      sessionId: 'session-1',
      turnNumber: 1,
      timestamp: Date.now(),
    };

    await storage.saveAttributions(new Map([['src/app.ts', attribution]]));

    const loaded = await storage.loadAttributions();
    expect(loaded.get('src/app.ts')).toEqual(attribution);
  });

  it('cleanupWorkspace resets instance state', async () => {
    const workspaceId = 'ws-cleanup';
    const storage = FileTrackingStorage.getInstance(workspaceId);
    await storage.saveTrackedChanges([createChange()]);
    await storage.saveTransitions([]);

    FileTrackingStorage.cleanupWorkspace(workspaceId);

    const fresh = FileTrackingStorage.getInstance(workspaceId);
    expect(fresh).not.toBe(storage);
    await expect(fresh.loadTrackedChanges()).resolves.toEqual([]);
  });
});
