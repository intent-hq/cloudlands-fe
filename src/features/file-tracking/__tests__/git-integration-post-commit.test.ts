import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ChangeStage, type TrackedChange } from '../main/types';
import { GitIntegrationService } from '../main/git-integration.service';

const mockAttributionEngine = vi.hoisted(() => ({
  loadAgentWrites: vi.fn().mockResolvedValue(undefined),
  attributeChange: vi.fn().mockResolvedValue({ source: 'git' }),
}));

const mockUuid = vi.hoisted(() => {
  let idCounter = 0;
  return {
    v4: vi.fn(() => `change-${++idCounter}`),
    reset: () => {
      idCounter = 0;
    },
  };
});

vi.mock('$lib/utils/logger', () => ({
  Logger: vi.fn(function Logger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }),
}));

vi.mock('uuid', () => ({ v4: mockUuid.v4 }));

vi.mock('../../workspace/main/provenance/attribution-engine', () => ({
  getAttributionEngine: vi.fn(() => mockAttributionEngine),
}));

vi.mock('../../../shared/git/git-blob-storage', () => ({
  isGitRepository: vi.fn().mockResolvedValue(true),
  storeBlob: vi.fn().mockResolvedValue(undefined),
}));

function createChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: overrides.id ?? 'change-id',
    file: overrides.file ?? 'src/app.ts',
    relativePath: overrides.relativePath ?? overrides.file ?? 'src/app.ts',
    stage: overrides.stage ?? ChangeStage.Unstaged,
    status: overrides.status ?? 'modified',
    stats: overrides.stats ?? { additions: 1, deletions: 0, binary: false },
    attribution: overrides.attribution ?? { manual: true, timestamp: 1000 },
    commitHash: overrides.commitHash,
    content: overrides.content,
  };
}

function changeKey(change: TrackedChange): string {
  return change.commitHash
    ? `${change.file}:${change.stage}:${change.commitHash}`
    : `${change.file}:${change.stage}`;
}

function createFileTrackingService(initialChanges: TrackedChange[]) {
  let storedChanges = [...initialChanges];
  let pendingChanges: TrackedChange[] | null = null;

  const service = {
    getChanges: vi.fn(async () => ({
      changes: [...storedChanges],
      truncated: false,
      totalCount: storedChanges.length,
    })),
    clearFileStageEntriesBatch: vi.fn(async (entries: Array<{ file: string; stage: ChangeStage }>) => {
      const keysToRemove = new Set(entries.map((entry) => `${entry.file}:${entry.stage}`));
      storedChanges = storedChanges.filter((change) => !keysToRemove.has(`${change.file}:${change.stage}`));
    }),
    saveChanges: vi.fn(async (changes: TrackedChange[]) => {
      pendingChanges = changes;
    }),
    forceSave: vi.fn(async () => {
      if (!pendingChanges) return;
      const byKey = new Map(storedChanges.map((change) => [changeKey(change), change]));
      for (const change of pendingChanges) {
        byKey.set(changeKey(change), change);
      }
      storedChanges = Array.from(byKey.values());
      pendingChanges = null;
    }),
    clearFileChangesBatch: vi.fn(),
    trackChangesBatch: vi.fn(async (changes: TrackedChange[]) => {
      const byKey = new Map(storedChanges.map((change) => [`${change.file}:${change.stage}`, change]));
      for (const change of changes) {
        byKey.set(`${change.file}:${change.stage}`, change);
      }
      storedChanges = Array.from(byKey.values());
      return changes;
    }),
  };

  return {
    service,
    getStoredChanges: () => storedChanges,
  };
}

describe('GitIntegrationService post-commit cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUuid.reset();
  });

  it('clears stale working-tree entries without removing existing committed history', async () => {
    const { service, getStoredChanges } = createFileTrackingService([
      createChange({ id: 'unstaged', stage: ChangeStage.Unstaged }),
      createChange({ id: 'staged', stage: ChangeStage.Staged }),
      createChange({ id: 'old-commit', stage: ChangeStage.Committed, commitHash: 'oldhash' }),
      createChange({ id: 'other', file: 'src/other.ts', stage: ChangeStage.Unstaged }),
    ]);
    const detector = { invalidateGitStatusCache: vi.fn() };
    const integration = new GitIntegrationService('workspace-1', '/repo', service as any);
    (integration as any).changeDetector = detector;

    await integration.handlePostCommit('newhash');

    expect(detector.invalidateGitStatusCache).toHaveBeenCalledTimes(1);
    expect(service.clearFileStageEntriesBatch).toHaveBeenCalledWith([
      { file: 'src/app.ts', stage: ChangeStage.Staged },
      { file: 'src/app.ts', stage: ChangeStage.Unstaged },
    ]);
    expect(service.clearFileChangesBatch).not.toHaveBeenCalled();
    expect(getStoredChanges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'old-commit', stage: ChangeStage.Committed, commitHash: 'oldhash' }),
        expect.objectContaining({ file: 'src/app.ts', stage: ChangeStage.Committed, commitHash: 'newhash' }),
        expect.objectContaining({ file: 'src/other.ts', stage: ChangeStage.Unstaged }),
      ]),
    );
    expect(getStoredChanges().filter((change) => change.file === 'src/app.ts' && change.stage !== ChangeStage.Committed)).toEqual([]);
  });

  it('allows a fresh forced sync to restore legitimate remaining unstaged work', async () => {
    const { service, getStoredChanges } = createFileTrackingService([
      createChange({ id: 'unstaged', stage: ChangeStage.Unstaged }),
      createChange({ id: 'staged', stage: ChangeStage.Staged }),
    ]);
    const detector = {
      invalidateGitStatusCache: vi.fn(),
      getCurrentChanges: vi.fn().mockResolvedValue({
        id: 'diff-1',
        workspaceId: 'workspace-1',
        provenance: { source: 'git' },
        files: [
          {
            path: 'src/app.ts',
            action: 'Modify',
            stage: ChangeStage.Unstaged,
            additions: 2,
            deletions: 0,
            content: 'remaining work',
            diff: 'diff --git a/src/app.ts b/src/app.ts',
          },
        ],
      }),
    };
    const integration = new GitIntegrationService('workspace-1', '/repo', service as any);
    (integration as any).changeDetector = detector;

    await integration.handlePostCommit('newhash');
    await integration.syncCurrentState(true, false);

    expect(detector.invalidateGitStatusCache).toHaveBeenCalledTimes(1);
    expect(detector.getCurrentChanges).toHaveBeenCalledTimes(1);
    expect(getStoredChanges()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'src/app.ts', stage: ChangeStage.Committed, commitHash: 'newhash' }),
        expect.objectContaining({ file: 'src/app.ts', stage: ChangeStage.Unstaged }),
      ]),
    );
  });
});