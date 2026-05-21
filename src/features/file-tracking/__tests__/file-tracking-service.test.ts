import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeStage, type TrackedChange } from '../types';

const mockStorage = vi.hoisted(() => ({
  setWorkspacePath: vi.fn().mockResolvedValue(undefined),
  loadTrackedChanges: vi.fn(),
  saveTrackedChanges: vi.fn().mockResolvedValue(undefined),
  loadTransitions: vi.fn().mockResolvedValue([]),
  saveTransitions: vi.fn().mockResolvedValue(undefined),
  getIsGitRepo: vi.fn().mockReturnValue(true),
  resolveContent: vi.fn(),
}));

const mockUuid = vi.hoisted(() => vi.fn(() => 'new-change-id'));

vi.mock('$lib/utils/logger', () => ({
  Logger: vi.fn(function Logger() {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  }),
}));

vi.mock('uuid', () => ({ v4: mockUuid }));

vi.mock('../main/file-tracking-storage', () => ({
  FileTrackingStorage: { getInstance: vi.fn(() => mockStorage) },
}));

vi.mock('../../../shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: { getClient: vi.fn() },
}));

vi.mock('../../../shared/git/git-env', () => ({ gitEnv: {} }));

import { FileTrackingService } from '../main/file-tracking.service';

function createChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: 'existing-change-id',
    file: 'src/app.ts',
    relativePath: 'src/app.ts',
    stage: ChangeStage.Unstaged,
    status: 'modified',
    stats: { additions: 1, deletions: 2, binary: false },
    attribution: { manual: true, timestamp: 1000 },
    ...overrides,
  };
}

function asInput(change: TrackedChange): Omit<TrackedChange, 'id'> {
  const { id: _id, ...input } = change;
  return input;
}

describe('FileTrackingService timestamp stability', () => {
  let service: FileTrackingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.loadTrackedChanges.mockResolvedValue([]);
    service = new FileTrackingService('workspace-1', '/workspace');
  });

  afterEach(() => {
    service.destroy();
  });

  it('preserves existing attribution timestamp when trackChange refresh is semantic no-op', async () => {
    const existing = createChange();
    mockStorage.loadTrackedChanges.mockResolvedValue([existing]);

    const tracked = await service.trackChange(
      asInput(createChange({ id: 'incoming-id', attribution: { manual: true, timestamp: 2000 } })),
    );

    expect(tracked.id).toBe('existing-change-id');
    expect(tracked.attribution.timestamp).toBe(1000);
    expect(mockStorage.saveTrackedChanges).toHaveBeenCalledWith([tracked]);
  });

  it('preserves existing attribution timestamp in batch semantic no-op refreshes', async () => {
    const existing = createChange();
    mockStorage.loadTrackedChanges.mockResolvedValue([existing]);

    const [tracked] = await service.trackChangesBatch([
      asInput(createChange({ id: 'incoming-id', attribution: { manual: true, timestamp: 2000 } })),
    ]);

    expect(tracked.id).toBe('existing-change-id');
    expect(tracked.attribution.timestamp).toBe(1000);
    expect(mockStorage.saveTrackedChanges).toHaveBeenCalledWith([tracked]);
  });

  it('uses incoming attribution timestamp when batch refresh changes real metadata', async () => {
    const existing = createChange();
    mockStorage.loadTrackedChanges.mockResolvedValue([existing]);

    const [tracked] = await service.trackChangesBatch([
      asInput(
        createChange({
          id: 'incoming-id',
          stats: { additions: 3, deletions: 2, binary: false },
          attribution: { manual: true, timestamp: 2000 },
        }),
      ),
    ]);

    expect(tracked.id).toBe('existing-change-id');
    expect(tracked.stats.additions).toBe(3);
    expect(tracked.attribution.timestamp).toBe(2000);
    expect(mockStorage.saveTrackedChanges).toHaveBeenCalledWith([tracked]);
  });
});
