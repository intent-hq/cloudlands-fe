/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { validateRepoPath } from '../workspace-validation';

const path = '/tmp/existing-project';
const status = {
  path,
  exists: true,
  isDirectory: true,
  isEmpty: false,
  isGitRepo: false,
  isSubdirectoryOfGitRepo: false,
};

describe('existing repository validation (#5771)', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    resetMockIpcRouter();
  });

  it.each([true, false])('rejects a non-Git directory with isEmpty=%s', async (isEmpty) => {
    const directoryStatus = vi.fn(async () => ({ success: true, data: { ...status, isEmpty } }));
    registerMockIpcHandler('file:getDirectoryStatus', directoryStatus);

    const result = await validateRepoPath(path, false);

    expect(directoryStatus).toHaveBeenCalledExactlyOnceWith({ path });
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.isNewRepo).not.toBe(true);
  });

  it.each([true, false])(
    'preserves deliberate new repository creation with isEmpty=%s',
    async (isEmpty) => {
      registerMockIpcHandler('file:getDirectoryStatus', async () => ({
        success: true,
        data: { ...status, isEmpty },
      }));

      expect(await validateRepoPath(path, true)).toMatchObject({ valid: true, isNewRepo: true });
    },
  );

  it('accepts an existing Git repository', async () => {
    registerMockIpcHandler('file:getDirectoryStatus', async () => ({
      success: true,
      data: { ...status, isGitRepo: true },
    }));

    expect(await validateRepoPath(path, false)).toMatchObject({ valid: true, isNewRepo: false });
  });

  it('keeps GitHub picks independent of local directory validation', async () => {
    const directoryStatus = vi.fn();
    registerMockIpcHandler('file:getDirectoryStatus', directoryStatus);

    expect(await validateRepoPath('https://github.com/owner/project', false)).toMatchObject({
      valid: true,
    });
    expect(directoryStatus).not.toHaveBeenCalled();
  });

  it('preserves the browser-only path when the Electron bridge is absent', async () => {
    const bridge = window.electronAPI;
    try {
      Object.defineProperty(window, 'electronAPI', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(await validateRepoPath(path, false)).toMatchObject({ valid: true });
    } finally {
      Object.defineProperty(window, 'electronAPI', {
        value: bridge,
        configurable: true,
        writable: true,
      });
    }
  });

  it('preserves a directory inside a parent Git repository', async () => {
    registerMockIpcHandler('file:getDirectoryStatus', async () => ({
      success: true,
      data: { ...status, isSubdirectoryOfGitRepo: true, parentGitRoot: '/tmp' },
    }));

    expect(await validateRepoPath(path, false)).toMatchObject({ valid: true, isNewRepo: false });
  });

  it.each([false, true])('legacy check honors allowNewRepo=%s', async (allowNewRepo) => {
    registerMockIpcHandler('file:getDirectoryStatus', async () => ({ success: false }));
    const exists = vi.fn(async () => ({ exists: true }));
    const isRepository = vi.fn(async () => ({ isRepository: false }));
    registerMockIpcHandler('file:exists', exists);
    registerMockIpcHandler('git:isRepository', isRepository);

    const result = await validateRepoPath(path, allowNewRepo);

    expect(exists).toHaveBeenCalledExactlyOnceWith({ path });
    expect(isRepository).toHaveBeenCalledExactlyOnceWith({ path });
    expect(result.valid).toBe(allowNewRepo);
    if (allowNewRepo) expect(result.isNewRepo).toBe(true);
    else expect(result.error).toBeTruthy();
  });

  it('rejects an unverified existing repository when the directory probe throws', async () => {
    registerMockIpcHandler('file:getDirectoryStatus', async () => {
      throw new Error('daemon disconnected');
    });

    const result = await validateRepoPath(path, false);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it.each([undefined, { success: false, error: 'daemon disconnected' }])(
    'rejects an unavailable legacy Git probe (%j)',
    async (response) => {
      registerMockIpcHandler('file:getDirectoryStatus', async () => ({ success: false }));
      registerMockIpcHandler('file:exists', async () => ({ exists: true }));
      registerMockIpcHandler('git:isRepository', async () => response);

      const result = await validateRepoPath(path, false);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    },
  );
});
