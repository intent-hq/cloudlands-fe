import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  dispatch: vi.fn((action: unknown) => action),
  execute: vi.fn(),
}));

vi.mock('$features/git/git-write-service', () => ({ commit: mocks.commit }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
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
  });

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
