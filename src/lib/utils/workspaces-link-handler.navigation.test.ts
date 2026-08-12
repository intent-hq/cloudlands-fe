import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  dispatch: vi.fn(),
  navigateToRoute: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectCurrentWorkspace: { select: () => ({ id: 'globally-active-workspace' }) },
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));
vi.mock('./navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));

import { handleIntentLink } from './workspaces-link-handler';

describe('handleIntentLink panel navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backendRequest.mockResolvedValue({ note: { id: 'spec', title: 'Spec' } });
  });

  it('checks and opens a short note link in the owning chat workspace', async () => {
    await handleIntentLink('intent://local/note/spec', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-chat',
    });

    expect(mocks.backendRequest).toHaveBeenCalledWith('note.get', {
      workspaceId: 'owning-workspace',
      noteId: 'spec',
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('owning-workspace', 'spec', {
        openInAdjacentPanel: false,
        openInNewAdjacentPanel: false,
        sourcePanelId: 'panel-chat',
      }),
    );
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });

  it('preserves the request for a fresh adjacent panel', async () => {
    await handleIntentLink('intent://local/note/spec', {
      workspaceId: 'owning-workspace',
      sourcePanelId: 'panel-note',
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
    });

    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('owning-workspace', 'spec', {
        openInAdjacentPanel: true,
        openInNewAdjacentPanel: true,
        sourcePanelId: 'panel-note',
      }),
    );
  });
});
