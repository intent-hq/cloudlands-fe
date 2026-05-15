/**
 * Change Processor Tests
 *
 * Tests for the change processor module that handles file change processing,
 * deduplication, and event creation.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ChangeProcessor } from '../change-processor';
import type { FileChange } from '../change-processor';
import type { GitDiffResult } from '../git-types';

// Create shared mock functions that persist across instances
const mockShouldIgnore = vi.fn().mockReturnValue(false);
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockCleanup = vi.fn();

// Mock dependencies - path matches the actual import in change-processor.ts
vi.mock('../../../../lib/utils/main/gitignore-manager', () => {
  class MockGitignoreManager {
    initialize = mockInitialize;
    shouldIgnore = mockShouldIgnore;
    cleanup = mockCleanup;
  }
  return {
    GitignoreManager: MockGitignoreManager,
  };
});
vi.mock('../../provenance/attribution-engine', () => ({
  getAttributionEngine: vi.fn(() => ({
    getCurrentActor: vi.fn(() => ({
      type: 'user',
      id: 'test-user',
      name: 'Test User',
    })),
    attributeChange: vi.fn(() =>
      Promise.resolve({
        source: 'user',
      }),
    ),
  })),
}));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    default: actual.default || {},
    ...actual,
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
  };
});
vi.mock('../../diffs/main/extract-change-hunks', () => ({
  extractChangesFromDiff: vi.fn().mockReturnValue([]),
  extractChangesFromContents: vi.fn().mockReturnValue([]),
}));

describe('ChangeProcessor', () => {
  let processor: ChangeProcessor;
  const workspacePath = '/test/workspace';
  const workspaceId = 'test-workspace-id';

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    // Reset shouldIgnore to default behavior
    mockShouldIgnore.mockReset().mockReturnValue(false);

    // Create processor
    processor = new ChangeProcessor(workspacePath, workspaceId);
    await processor.initialize();
  });

  afterEach(() => {
    processor.cleanup();
  });

  describe('processFileChange', () => {
    it('should process a file creation', async () => {
      const result = await processor.processFileChange('test.txt', 'Create', {
        additions: 10,
        deletions: 0,
        diff: '+ new content',
      } as GitDiffResult);

      expect(result).toBeDefined();
      expect(result?.change.action).toBe('Create');
      expect(result?.change.path).toBe('test.txt');
      expect(result?.change.additions).toBe(10);
      expect(result?.change.deletions).toBe(0);
      expect(result?.event.type).toBe('file:created');
    });

    it('should process a file modification', async () => {
      const result = await processor.processFileChange('test.txt', 'Modify', {
        additions: 5,
        deletions: 3,
        diff: '- old\n+ new',
      } as GitDiffResult);

      expect(result).toBeDefined();
      expect(result?.change.action).toBe('Modify');
      expect(result?.change.additions).toBe(5);
      expect(result?.change.deletions).toBe(3);
      expect(result?.event.type).toBe('file:changed');
    });

    it('should process a file deletion', async () => {
      const result = await processor.processFileChange('test.txt', 'Delete', {
        additions: 0,
        deletions: 10,
        diff: '- deleted content',
      } as GitDiffResult);

      expect(result).toBeDefined();
      expect(result?.change.action).toBe('Delete');
      expect(result?.change.deletions).toBe(10);
      expect(result?.event.type).toBe('file:deleted');
    });

    // Note: Line counting for Create action without diff is tested in git-status-parsing.test.ts
    // The mock for fs/promises doesn't intercept correctly in this test file due to module caching.
    // The logic in change-processor.ts at lines 156-164 counts lines from file content for Create
    // actions without a diff, which is consistent with detectGitChanges() and getCurrentChanges().

    it('should ignore files that match gitignore patterns', async () => {
      // Use the shared mock function
      mockShouldIgnore.mockReturnValue(true);

      const result = await processor.processFileChange('node_modules/test.js', 'Create');

      expect(result).toBeNull();

      // Reset for other tests
      mockShouldIgnore.mockReturnValue(false);
    });

    it('should ignore default-excluded untracked generated dependency files', async () => {
      const result = await processor.processFileChange(
        'venv/lib/python3.11/site-packages/pkg.py',
        'Create',
      );

      expect(result).toBeNull();
    });

    it('should not ignore source paths with excluded-segment substrings', async () => {
      const paths = [
        'src/venv_utils.ts',
        'tests/fixtures/venv-example.txt',
        'environment/config.py',
      ];

      for (const path of paths) {
        const result = await processor.processFileChange(path, 'Create');

        expect(result).toBeDefined();
        expect(result?.change.path).toBe(path);
      }
    });

    it('should preserve staged and deleted files under default-excluded segments', async () => {
      const stagedCreate = await processor.processFileChange(
        'node_modules/local-package/index.ts',
        'Create',
        undefined,
        'staged',
      );
      const deleted = await processor.processFileChange('venv/tracked.py', 'Delete');

      expect(stagedCreate).toBeDefined();
      expect(deleted).toBeDefined();
    });

    it('should deduplicate identical changes', async () => {
      const diff = {
        additions: 5,
        deletions: 3,
        diff: 'test diff',
      } as GitDiffResult;

      // Process the same change twice
      const result1 = await processor.processFileChange('test.txt', 'Modify', diff);
      const result2 = await processor.processFileChange('test.txt', 'Modify', diff);

      expect(result1).toBeDefined();
      expect(result2).toBeNull(); // Should be deduplicated
    });

    it('should process updated changes', async () => {
      const diff1 = {
        additions: 5,
        deletions: 3,
        diff: 'test diff 1',
      } as GitDiffResult;

      const diff2 = {
        additions: 10,
        deletions: 5,
        diff: 'test diff 2',
      } as GitDiffResult;

      // Process different versions of the same file
      const result1 = await processor.processFileChange('test.txt', 'Modify', diff1);
      const result2 = await processor.processFileChange('test.txt', 'Modify', diff2);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined(); // Should process the updated change
      expect(result2?.change.additions).toBe(10);
      expect(result2?.change.deletions).toBe(5);
    });
  });

  describe('processBatch', () => {
    it('should process multiple changes in batch', async () => {
      const changes: Array<{ path: string; action: FileChange['action']; diff?: GitDiffResult }> = [
        {
          path: 'file1.txt',
          action: 'Create',
          diff: { additions: 10, deletions: 0 } as GitDiffResult,
        },
        {
          path: 'file2.txt',
          action: 'Modify',
          diff: { additions: 5, deletions: 3 } as GitDiffResult,
        },
        {
          path: 'file3.txt',
          action: 'Delete',
          diff: { additions: 0, deletions: 8 } as GitDiffResult,
        },
      ];

      const results = await processor.processBatch(changes);

      expect(results).toHaveLength(3);
      expect(results[0].change.path).toBe('file1.txt');
      expect(results[1].change.path).toBe('file2.txt');
      expect(results[2].change.path).toBe('file3.txt');
    });

    it('should filter out ignored files from batch', async () => {
      // Use the shared mock function - node_modules should be ignored
      mockShouldIgnore.mockImplementation((path: string) => path.includes('node_modules'));

      const changes = [
        { path: 'batch-src/file.txt', action: 'Create' as const },
        { path: 'node_modules/lib.js', action: 'Create' as const },
        { path: 'batch-dist/output.js', action: 'Create' as const },
      ];

      const results = await processor.processBatch(changes);

      // Should have 2 results (node_modules should be filtered out)
      expect(results).toHaveLength(2);
      expect(results.find((r) => r.change.path.includes('node_modules'))).toBeUndefined();
      expect(results.map((r) => r.change.path)).toContain('batch-src/file.txt');
      expect(results.map((r) => r.change.path)).toContain('batch-dist/output.js');

      // Reset for other tests
      mockShouldIgnore.mockReturnValue(false);
    });

    it('should filter virtualenv-heavy batches before per-file processing', async () => {
      const ignoredChanges = Array.from({ length: 1200 }, (_, index) => ({
        path: `${index % 2 === 0 ? 'venv' : '.venv'}/lib/python3.11/site-packages/pkg_${index}.py`,
        action: 'Create' as const,
      }));
      const processFileChangeSpy = vi.spyOn(processor, 'processFileChange');

      const results = await processor.processBatch([
        ...ignoredChanges,
        { path: 'environment/config.py', action: 'Create' as const },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].change.path).toBe('environment/config.py');
      expect(processFileChangeSpy).toHaveBeenCalledTimes(1);
      expect(processFileChangeSpy).toHaveBeenCalledWith(
        'environment/config.py',
        'Create',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('getStats', () => {
    it('should return processing statistics', async () => {
      // Process some changes
      await processor.processFileChange('file1.txt', 'Create');
      await processor.processFileChange('file2.txt', 'Modify');
      await processor.processFileChange('file2.txt', 'Modify'); // Duplicate

      const stats = processor.getStats();

      expect(stats.totalProcessed).toBe(2); // Only 2 were actually processed
      expect(stats.totalEmitted).toBe(2); // Both were emitted
      expect(stats.duplicatesFiltered).toBe(1); // One was deduplicated
    });
  });

  describe('cleanup', () => {
    it('should clean up resources and timers', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      processor.cleanup();

      // Should clear the cleanup interval timer
      expect(clearIntervalSpy).toHaveBeenCalled();

      // Verify batch queue and tracked changes are cleared
      expect(processor.getPendingCount()).toBe(0);
      expect(processor.getStats().totalProcessed).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully during processing', async () => {
      // Mock an error in file reading
      const { readFile } = await import('fs/promises');
      vi.mocked(readFile).mockRejectedValueOnce(new Error('File read error'));

      const result = await processor.processFileChange('error.txt', 'Modify', {
        additions: 1,
        deletions: 1,
      } as GitDiffResult);

      // Should still create an event even if content reading fails
      expect(result).toBeDefined();
      expect(result?.event).toBeDefined();
      // Content should not be set due to error
      expect(result?.change.content).toBeUndefined();
    });
  });

  describe('stage handling', () => {
    it('should track staged changes separately from unstaged', async () => {
      const diff = { additions: 5, deletions: 3 } as GitDiffResult;

      const staged = await processor.processFileChange('test.txt', 'Modify', diff, 'staged');
      const unstaged = await processor.processFileChange('test.txt', 'Modify', diff, 'unstaged');

      expect(staged).toBeDefined();
      expect(unstaged).toBeDefined();
      expect(staged?.change.stage).toBe('staged');
      expect(unstaged?.change.stage).toBe('unstaged');
    });
  });
});
