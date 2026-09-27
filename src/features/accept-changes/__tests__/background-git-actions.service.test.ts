import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  dispatch: vi.fn((action: unknown) => action),
  execute: vi.fn(),
  context: 'owner-admission' as string | null,
}));

vi.mock('$features/git/git-write-service', () => ({ commit: mocks.commit }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceHostOperationContext: { select: () => mocks.context },
}));
vi.mock('../accept-changes.client', () => ({
  AcceptChangesClient: { execute: mocks.execute },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}));

import { backgroundGitActionsService } from '../background-git-actions.service';

describe('backgroundGitActionsService refresh ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context = 'owner-admission';
  });

  it('keeps guest git commits while refusing accept-changes PR creation', async () => {
    mocks.context = null;
    mocks.execute.mockResolvedValue({ success: true });
    mocks.commit.mockResolvedValue({ success: true });
    await expect(
      backgroundGitActionsService.commit({ workspaceId: 'ws-1', commitMessage: 'Commit' }),
    ).resolves.toEqual({ success: true });
    expect(mocks.commit).toHaveBeenCalledWith('ws-1', { message: 'Commit', userRequested: true });
    const result = await backgroundGitActionsService.createPR({
      workspaceId: 'ws-1',
      prTitle: 'Title',
      prDescription: '',
    });
    expect(result.success).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'replacement'] as const)(
    'does not create a PR after held staging crosses %s authority',
    async (change) => {
      let resolve!: (value: { success: boolean }) => void;
      mocks.execute.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const pending = backgroundGitActionsService.createPR({
        workspaceId: 'ws-1',
        prTitle: 'Title',
        prDescription: '',
        hasStaged: true,
      });
      expect(mocks.execute).toHaveBeenCalledWith('ws-1', 'commit', { commitMessage: 'Title' });
      mocks.context = change === 'revoked' ? null : 'other-admission';
      resolve({ success: true });
      expect((await pending).success).toBe(false);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it('dispatches one broad refresh after a successful commit', async () => {
    mocks.commit.mockResolvedValue({ success: true });

    await expect(
      backgroundGitActionsService.commit({ workspaceId: 'ws-1', commitMessage: 'Commit' }),
    ).resolves.toEqual({ success: true });

    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'changes/refreshRequested', payload: ['ws-1', true] },
    ]);
  });

  it('dispatches one broad refresh after creating a pull request', async () => {
    mocks.execute.mockResolvedValue({ success: true });

    await expect(
      backgroundGitActionsService.createPR({
        workspaceId: 'ws-1',
        prTitle: 'Pull request',
        prDescription: 'Description',
      }),
    ).resolves.toEqual({ success: true, prNumber: undefined, prHtmlUrl: undefined });

    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'changes/refreshRequested', payload: ['ws-1', true] },
    ]);
  });
});
