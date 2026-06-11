import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { ChangeStage, type TrackedChange } from '../types';

const mockMetadata = vi.hoisted(() => ({ root: '' }));

vi.mock('$shared/main/config', () => ({
  WorkspaceConfig: {
    paths: {
      metadata: (workspaceId: string) => `${mockMetadata.root}/${workspaceId}`,
    },
  },
}));

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

describe('FileTrackingStorage payload retention', () => {
  let testDir: string;
  let workspaceId: string;

  beforeEach(async () => {
    workspaceId = `file-tracking-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDir = path.join(tmpdir(), workspaceId);
    mockMetadata.root = testDir;
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    FileTrackingStorage.clearAllInstances();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function trackingFilePath(): string {
    return path.join(testDir, workspaceId, 'file-tracking', 'file-tracking.json');
  }

  it('bounds saved tracked-change content and keeps required metadata', async () => {
    const storage = FileTrackingStorage.getInstance(workspaceId);
    const change = createChange({
      content: {
        oldContent: 'o'.repeat(80_000),
        oldContentSha: 'old-sha',
        newContent: 'n'.repeat(80_000),
        diff: 'd'.repeat(30_000),
        isFullFileContent: true,
      },
    });

    await storage.saveTrackedChanges([change]);

    const saved = JSON.parse(await fs.readFile(trackingFilePath(), 'utf-8'));
    const content = saved.trackedChanges[0].content;
    expect(content.oldContent).toBeUndefined();
    expect(content.oldContentSha).toBe('old-sha');
    expect(content.newContent).toBeUndefined();
    expect(content.diff.length).toBeLessThan(30_000);
    expect(content.diff).toContain('[truncated]');
    expect(content.isFullFileContent).toBe(true);
  });

  it('sanitizes loaded tracked changes before caching them', async () => {
    const storage = FileTrackingStorage.getInstance(workspaceId);
    const filePath = trackingFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: '1.0.0',
        workspaceId,
        trackedChanges: [
          createChange({
            id: 'loaded-large',
            content: {
              oldContent: 'o'.repeat(80_000),
              newContent: 'n'.repeat(80_000),
              diff: 'd'.repeat(30_000),
            },
          }),
        ],
      }),
      'utf-8',
    );

    const [loaded] = await storage.loadTrackedChanges();
    expect(loaded.content?.oldContent).toBeUndefined();
    expect(loaded.content?.newContent).toBeUndefined();
    expect(loaded.content?.diff?.length).toBeLessThan(30_000);
    expect((storage as any).trackedChangesCache[0]).toBe(loaded);
  });

  it('updates the cache after cleanup removes stale tracked changes', async () => {
    const storage = FileTrackingStorage.getInstance(workspaceId);
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await storage.saveTrackedChanges([
      createChange({ id: 'old-change', attribution: { manual: true, timestamp: oldTimestamp } }),
      createChange({
        id: 'new-change',
        file: 'src/new.ts',
        attribution: { manual: true, timestamp: Date.now() },
      }),
    ]);
    await storage.loadTrackedChanges();

    (storage as any).lastAccessTime = 0;
    (storage as any).lastCleanupTime = 0;
    await (storage as any).performCleanup();

    expect((storage as any).trackedChangesCache.map((change: TrackedChange) => change.id)).toEqual([
      'new-change',
    ]);
    await expect(storage.loadTrackedChanges()).resolves.toMatchObject([{ id: 'new-change' }]);
  });
});
