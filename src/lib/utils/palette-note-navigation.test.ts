import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

const mocks = vi.hoisted(() => ({
  show: vi.fn<(workspaceId: string) => Promise<boolean>>(),
  dispatch: vi.fn(),
}));
vi.mock('./show-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./show-workspace')>()),
  openAndShowWorkspace: mocks.show,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

import { openPaletteNote } from './palette-note-navigation';

describe('openPaletteNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.show.mockResolvedValue(true);
    window.history.replaceState({}, '', '/workspace/current');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows another workspace (and its tab) before opening the note there', async () => {
    let shown = false;
    mocks.show.mockImplementationOnce(async (workspaceId: string) => {
      shown = true;
      window.history.replaceState({}, '', `/workspace/${workspaceId}`);
      return true;
    });
    mocks.dispatch.mockImplementation(() => expect(shown).toBe(true));

    await expect(openPaletteNote('other', 'note-1', false)).resolves.toBe(true);

    expect(mocks.show).toHaveBeenCalledWith('other');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('other', 'note-1', { openInAdjacentPanel: false }),
    );
  });

  it('opens the note in place when its workspace is already showing', async () => {
    await expect(openPaletteNote('current', 'note-1', true)).resolves.toBe(true);

    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      openWorkspaceNote('current', 'note-1', { openInAdjacentPanel: true }),
    );
  });

  it.each([
    ['is cancelled or skipped (route unchanged)', () => mocks.show.mockResolvedValueOnce(false)],
    ['fails', () => mocks.show.mockRejectedValueOnce(new Error('navigation failed'))],
  ])('opens nothing when the workspace navigation %s', async (_label, arrange) => {
    arrange();

    await expect(openPaletteNote('other', 'note-1', false)).resolves.toBe(false);

    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
