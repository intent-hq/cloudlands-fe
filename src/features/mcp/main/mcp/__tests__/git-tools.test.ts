/**
 * Tests for CheckMergeConflictsTool.detectMergeConflicts
 *
 * Tests the merge conflict detection logic including:
 * - Modern git merge-tree --write-tree path
 * - Legacy fallback for older Git versions
 * - Error handling
 */

import { describe, it, expect, vi } from 'vitest';
import { CheckMergeConflictsTool } from '../git-tools';

vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

describe('CheckMergeConflictsTool.detectMergeConflicts', () => {
  const worktreePath = '/test/worktree';
  const currentBranch = 'feature-branch';
  const targetBranch = 'origin/main';

  function createTool() {
    return new CheckMergeConflictsTool('test-workspace-id');
  }

  it('should return no conflicts when modern merge-tree --write-tree succeeds', async () => {
    const tool = createTool();
    const mockExecFile = vi.fn().mockResolvedValueOnce({ stdout: 'abc123tree', stderr: '' });

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result).toEqual({ hasConflicts: false, conflictedFiles: [] });
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['merge-tree', '--write-tree', '--name-only', '--', targetBranch, currentBranch],
      { cwd: worktreePath },
    );
  });

  it('should return conflicts with file names when merge-tree exits with code 1', async () => {
    const tool = createTool();
    const error = new Error('merge-tree failed') as any;
    error.code = 1;
    error.stdout = 'tree-oid\n\nConflicts:\nfile1.ts\nfile2.ts\n';
    const mockExecFile = vi.fn().mockRejectedValueOnce(error);

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result.hasConflicts).toBe(true);
    expect(result.conflictedFiles).toContain('file1.ts');
    expect(result.conflictedFiles).toContain('file2.ts');
  });

  it('should fall back to legacy merge-tree when --write-tree is unsupported', async () => {
    const tool = createTool();
    const unsupportedError = new Error('unknown option `write-tree\'');
    const mockExecFile = vi.fn()
      .mockRejectedValueOnce(unsupportedError) // --write-tree fails
      .mockResolvedValueOnce({ stdout: 'base-sha\n', stderr: '' }) // merge-base
      .mockResolvedValueOnce({ stdout: 'clean output\n', stderr: '' }); // legacy merge-tree

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result.hasConflicts).toBe(false);
    // Verify legacy merge-base was called
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['merge-base', '--', targetBranch, currentBranch],
      { cwd: worktreePath },
    );
  });

  it('should detect conflicts via legacy fallback when conflict markers present', async () => {
    const tool = createTool();
    const unsupportedError = new Error('unknown option `write-tree\'');
    const mockExecFile = vi.fn()
      .mockRejectedValueOnce(unsupportedError)
      .mockResolvedValueOnce({ stdout: 'base-sha\n', stderr: '' })
      .mockResolvedValueOnce({
        stdout: '<<<<<<< ours\nsome content\n=======\nother content\n>>>>>>> theirs\n',
        stderr: '',
      });

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result.hasConflicts).toBe(true);
  });

  it('should return no conflicts via legacy fallback when output is clean', async () => {
    const tool = createTool();
    const unsupportedError = new Error('unrecognized argument: --write-tree');
    const mockExecFile = vi.fn()
      .mockRejectedValueOnce(unsupportedError)
      .mockResolvedValueOnce({ stdout: 'base-sha\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'no conflict markers here\n', stderr: '' });

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result.hasConflicts).toBe(false);
  });

  it('should default to hasConflicts=true on other errors (code 128)', async () => {
    const tool = createTool();
    const error = new Error('fatal: not a git repository') as any;
    error.code = 128;
    const mockExecFile = vi.fn().mockRejectedValueOnce(error);

    const result = await (tool as any).detectMergeConflicts(
      worktreePath,
      currentBranch,
      targetBranch,
      mockExecFile,
    );

    expect(result).toEqual({ hasConflicts: true, conflictedFiles: [] });
  });
});

