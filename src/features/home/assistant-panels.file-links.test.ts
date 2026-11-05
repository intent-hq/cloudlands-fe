import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';

// intent-hq/intent#8644: file links in Assistant chat open in the Assistant's
// content panel against the right workspace — short links against the
// Assistant's own `__chief__` workspace, scoped links against their own.

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});
vi.mock('$lib/client', () => ({ appClient: { workspaces: { get: mocks.getWorkspace } } }));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectPanelLayoutWorkspace: {
    select: () => ({
      restoreStatus: 'ready',
      focusedPanelId: null,
      panels: { 'assistant-content': { id: 'assistant-content', tabs: [], activeTabId: null } },
    }),
  },
  selectHiddenTabs: { select: () => [] },
  selectPanelLayoutWorkspaces: { select: () => ({}) },
}));
vi.mock('$store/renderer/slices/sidebar-nav/sidebar-nav-selectors', () => ({
  selectChiefThreads: { select: () => [] },
  selectChiefActiveAgentId: { select: () => null },
}));

import { showAssistantContent } from './assistant-panels';

function openedTabs() {
  return mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === openTab.type)
    .map((action) => (action.payload as { tab: unknown }).tab);
}

describe('Assistant file links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockImplementation(async (id: string) => ({ id, title: id }));
  });

  it('opens a short file link clicked in Assistant chat in the __chief__ workspace', async () => {
    expect(
      await showAssistantContent('intent://local/file/notes/plan.md', {
        layoutId: 'assistant-thread-1',
      }),
    ).toBe(true);

    expect(mocks.getWorkspace).toHaveBeenCalledWith(CHIEF_WORKSPACE_ID);
    expect(openedTabs()).toEqual([
      expect.objectContaining({
        type: 'file',
        filePath: 'notes/plan.md',
        workspaceId: CHIEF_WORKSPACE_ID,
      }),
    ]);
  });

  it('opens a short file link sent through ws.app.ui.navigate in the __chief__ workspace', async () => {
    // navigateToRoute's options for an `app:ui-navigate` event from an Assistant agent.
    expect(
      await showAssistantContent('intent://local/file/notes/plan.md', {
        preserveFocus: true,
        background: true,
        agentId: 'agent-1',
      }),
    ).toBe(true);

    expect(openedTabs()).toEqual([
      expect.objectContaining({ filePath: 'notes/plan.md', workspaceId: CHIEF_WORKSPACE_ID }),
    ]);
  });

  it('opens a workspace-scoped file link in its own workspace', async () => {
    await showAssistantContent('intent://local/ws-2/file/docs/README.md', {
      layoutId: 'assistant-thread-1',
    });

    expect(mocks.getWorkspace).toHaveBeenCalledWith('ws-2');
    expect(openedTabs()).toEqual([
      expect.objectContaining({ filePath: 'docs/README.md', workspaceId: 'ws-2' }),
    ]);
  });
});
