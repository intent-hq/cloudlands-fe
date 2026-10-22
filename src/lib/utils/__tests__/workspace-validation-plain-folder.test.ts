/**
 * validateRepoPath's allowPlainFolder option: a no-worktree workspace works in
 * the folder itself, so an existing non-git folder (e.g. `~` from the `intent`
 * CLI) is valid as-is and is never flagged for git initialization.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const directoryStatus = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('$shared/generated/ipc-client', () => ({
  invoke: vi.fn(async (channel: string) =>
    channel === 'file:getDirectoryStatus'
      ? { success: true, data: directoryStatus.current }
      : { success: false },
  ),
}));

import { validateRepoPath } from '../workspace-validation';

const plainFolder = { exists: true, isDirectory: true, isGitRepo: false, isEmpty: false };

describe('validateRepoPath with allowPlainFolder', () => {
  const originalElectronAPI = (window as any).electronAPI;
  beforeEach(() => {
    (window as any).electronAPI = { invoke: vi.fn() };
    directoryStatus.current = plainFolder;
  });
  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
  });

  it('accepts an existing non-git folder as-is, without git initialization', async () => {
    const result = await validateRepoPath('/Users/me', false, true);
    expect(result.valid).toBe(true);
    expect(result.isNewRepo).toBe(false);
  });

  it('still rejects a non-git folder when the option is off', async () => {
    const result = await validateRepoPath('/Users/me', false, false);
    expect(result.valid).toBe(false);
  });

  it('still rejects a folder that does not exist', async () => {
    directoryStatus.current = { exists: false };
    const result = await validateRepoPath('/Users/missing', false, true);
    expect(result.valid).toBe(false);
  });
});
