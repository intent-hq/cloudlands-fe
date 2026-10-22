import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), panel: vi.fn(), enabled: vi.fn(() => true) }));
vi.mock('$store/renderer/store', () => ({
  store: { state: {}, dispatch: mocks.dispatch, createSelector: () => ({ select: vi.fn() }) },
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectLabsMultiplayerEnabled: { select: mocks.enabled },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: () => 'another-panel' },
  selectPanelIds: { select: () => ['discussion-panel', 'another-panel'] },
  selectPanel: { select: mocks.panel },
}));
import { openWorkspaceDiscussion } from './discussion-navigation';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.panel.mockReturnValue({ tabs: [] });
});
describe('discussion pane navigation', () => {
  it('opens in the owning panel even when a different panel is focused', () => {
    openWorkspaceDiscussion('ws', 'layout', 'group-1', 'Group', 'discussion-panel');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: 'layout',
          panelId: 'discussion-panel',
          tab: expect.objectContaining({ workspaceId: 'ws', data: { conversationId: 'group-1' } }),
        }),
      }),
    );
  });
  it('reuses the saved conversation in that panel', () => {
    mocks.panel.mockReturnValue({
      tabs: [
        {
          id: 'existing',
          type: 'discussion',
          workspaceId: 'ws',
          data: { conversationId: 'group-1' },
        },
      ],
    });
    openWorkspaceDiscussion('ws', 'layout', 'group-1', 'Group', 'discussion-panel');
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/setActiveTab',
        payload: expect.objectContaining({
          wsId: 'layout',
          tabId: 'existing',
          panelId: 'discussion-panel',
        }),
      }),
    );
  });
  it('does not open a discussion when Multiplayer Labs is disabled', () => {
    mocks.enabled.mockReturnValue(false);
    openWorkspaceDiscussion('ws', 'layout', 'default');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
