import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceValidation } from '../workspace-validation-factory';
import { validateRepoPath } from '../workspace-validation';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';

function fixture() {
  const getDirectoryStatus = vi.fn().mockResolvedValue({
    success: true,
    data: {
      exists: true,
      isDirectory: true,
      isEmpty: false,
      isGitRepo: true,
      path: '/repo',
      isSubdirectoryOfGitRepo: false,
    },
  });
  const fileExists = vi.fn().mockResolvedValue({ exists: true });
  const isRepository = vi.fn().mockResolvedValue({ isRepository: true });
  const canCheckLocalPaths = vi.fn(() => true);
  return {
    getDirectoryStatus,
    fileExists,
    isRepository,
    canCheckLocalPaths,
    ...createWorkspaceValidation({
      canCheckLocalPaths,
      getDirectoryStatus,
      fileExists,
      isRepository,
    }),
  };
}

describe('workspace validation runtime binding', () => {
  it('uses the injected directory API and preserves repository/subdirectory status', async () => {
    const runtime = fixture();
    runtime.getDirectoryStatus.mockResolvedValue({
      success: true,
      data: {
        exists: true,
        isDirectory: true,
        isEmpty: false,
        isGitRepo: false,
        path: '/repo/subdir',
        isSubdirectoryOfGitRepo: true,
        parentGitRoot: '/repo',
        relativePathFromGitRoot: 'subdir',
      },
    });
    expect(await runtime.validateRepoPath(' /repo/subdir ')).toMatchObject({
      valid: true,
      isNewRepo: false,
      directoryStatus: { parentGitRoot: '/repo', relativePathFromGitRoot: 'subdir' },
    });
    expect(runtime.getDirectoryStatus.mock.calls).toEqual([[{ path: '/repo/subdir' }]]);
    expect(runtime.fileExists).not.toHaveBeenCalled();
    expect(runtime.isRepository).not.toHaveBeenCalled();
  });

  it('requires explicit permission to initialize a missing repository', async () => {
    const runtime = fixture();
    runtime.getDirectoryStatus.mockResolvedValue({
      success: true,
      data: {
        exists: false,
        isDirectory: false,
        isEmpty: false,
        isGitRepo: false,
        path: '/missing',
        isSubdirectoryOfGitRepo: false,
      },
    });
    expect(await runtime.validateRepoPath('/missing')).toMatchObject({ valid: false });
    expect(await runtime.validateRepoPath('/missing', true)).toMatchObject({
      valid: true,
      isNewRepo: true,
    });
  });

  it('falls back in order and rejects unverified Git status for an existing-only request', async () => {
    const runtime = fixture();
    runtime.getDirectoryStatus.mockResolvedValue({ success: false });
    runtime.isRepository.mockResolvedValue({ isRepository: false });
    expect(await runtime.validateRepoPath('/repo')).toMatchObject({ valid: false });
    expect(runtime.fileExists.mock.calls).toEqual([[{ path: '/repo' }]]);
    expect(runtime.isRepository.mock.calls).toEqual([[{ path: '/repo' }]]);
    runtime.isRepository.mockRejectedValue(new Error('disconnected'));
    expect(await runtime.validateRepoPath('/repo')).toMatchObject({ valid: false });
  });

  it('keeps syntax validation independent of local API availability', async () => {
    const runtime = fixture();
    runtime.canCheckLocalPaths.mockReturnValue(false);
    expect(await runtime.validateRepoPath('/repo')).toEqual({ valid: true, isNewRepo: false });
    expect(await runtime.validateRepoPath('')).toMatchObject({ valid: false });
    expect(await runtime.validateRepoPath('bad\0path')).toMatchObject({ valid: false });
    expect(await runtime.validateRepoPath('https://github.com/owner/repo')).toMatchObject({
      valid: true,
    });
    expect(runtime.getDirectoryStatus).not.toHaveBeenCalled();
  });

  it('retains the source IPC request shape and handles its directory response', async () => {
    const request = vi.fn(() => ({
      success: true,
      data: {
        exists: false,
        isDirectory: false,
        isEmpty: false,
        isGitRepo: false,
        path: '/missing',
        isSubdirectoryOfGitRepo: false,
      },
    }));
    const restore = overrideMockIpcHandler('file:getDirectoryStatus', request);
    try {
      expect(await validateRepoPath('/missing')).toMatchObject({ valid: false });
      expect(request.mock.calls).toEqual([[{ path: '/missing' }]]);
    } finally {
      restore();
    }
  });
});
