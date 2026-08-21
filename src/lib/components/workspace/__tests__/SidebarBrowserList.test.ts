/**
 * @vitest-environment jsdom
 *
 * SidebarBrowserList hidden-tab restore (monorepo#3113): the sidebar reveal
 * must dispatch revealHiddenTabAvoidingPanel with the panel hosting the
 * currently-viewed conversation avoided — never the focused-panel-targeting
 * restoreHiddenTab, which mounted the tab over the chat.
 */
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';

const { dispatchMock, layoutState, prefsState } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  layoutState: {
    panels: {} as Record<string, unknown>,
    hiddenTabs: [] as unknown[],
    focusedPanelId: null as string | null,
  },
  prefsState: { panelOpenMode: 'normal' as string },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' }, userPreferences: prefsState }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => {
  const readable = (getter: () => unknown) => ({
    subscribe: (run: (value: unknown) => void) => {
      run(getter());
      return () => {};
    },
  });
  const selectPanels = () => readable(() => layoutState.panels);
  selectPanels.select = () => layoutState.panels;
  const selectHiddenTabs = () => readable(() => layoutState.hiddenTabs);
  selectHiddenTabs.select = () => layoutState.hiddenTabs;
  const selectFocusedPanelId = () => readable(() => layoutState.focusedPanelId);
  selectFocusedPanelId.select = () => layoutState.focusedPanelId;
  return { selectPanels, selectHiddenTabs, selectFocusedPanelId };
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => {
  const readable = { subscribe: (run: (value: unknown) => void) => (run([]), () => {}) };
  const selectAllWorkspaceAgents = () => readable;
  return { selectAllWorkspaceAgents };
});

vi.mock('$store/renderer/slices/scripts/scripts-selectors', () => {
  const readable = { subscribe: (run: (value: unknown) => void) => (run([]), () => {}) };
  const selectWorkspaceScriptEntries = () => readable;
  return { selectWorkspaceScriptEntries };
});

import SidebarBrowserList from '../SidebarBrowserList.svelte';
import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';

const agentTab = (id: string, agentId: string) => ({ id, type: 'agent', title: 'Chat', agentId });
const ownedTab = (id: string, title: string) => ({
  id,
  type: 'browser',
  title,
  browserUrl: `http://example.test/${id}`, // i18n-ignore (test fixture URL)
  ownerAgentId: 'agent-1',
});

function seedLayout() {
  layoutState.panels = {
    chat: { id: 'chat', activeTabId: 'agent-tab', tabs: [agentTab('agent-tab', 'agent-1')] },
    p1: { id: 'p1', activeTabId: 'visible-1', tabs: [ownedTab('visible-1', 'Docs')] },
  };
  layoutState.hiddenTabs = [ownedTab('hidden-1', 'Preview')];
  layoutState.focusedPanelId = 'chat';
}

afterEach(() => {
  cleanup();
  dispatchMock.mockClear();
  layoutState.panels = {};
  layoutState.hiddenTabs = [];
  layoutState.focusedPanelId = null;
  prefsState.panelOpenMode = 'normal';
});

function renderList() {
  return render(SidebarBrowserList, { workspaceId: 'ws-1', panelLayoutId: 'ws-1' });
}

async function clickRestore() {
  const hiddenRow = document.querySelector('[data-sidebar-browser-hidden-tab="hidden-1"]');
  expect(hiddenRow).not.toBeNull();
  await fireEvent.click(within(hiddenRow as HTMLElement).getByRole('button'));
}

function findRevealAction() {
  const dispatched = dispatchMock.mock.calls.map(([action]) => action);
  return dispatched.find((a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type);
}

describe('SidebarBrowserList hidden-tab restore', () => {
  it('reveals avoiding the focused panel hosting the current conversation', async () => {
    seedLayout();
    renderList();
    await clickRestore();

    // Regression (monorepo#3113): the reveal must not be the focused-panel
    // targeting restoreHiddenTab — it mounted the tab over the chat.
    expect(dispatchMock.mock.calls.every(([a]) => a.type !== 'panelLayout/restoreHiddenTab')).toBe(
      true,
    );
    expect(findRevealAction()?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
      panelOpenMode: 'normal',
    });
  });

  // Regression (monorepo#3121): the panelOpenMode wiring is what lets the
  // reducer avoid the split that the pin-mode reusable-panel invariant would
  // collapse — the dispatched action must carry the current mode.
  it('passes the pin panel-open mode through to the reveal action', async () => {
    seedLayout();
    prefsState.panelOpenMode = 'pin';
    renderList();
    await clickRestore();

    expect(findRevealAction()?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
      panelOpenMode: 'pin',
    });
  });

  it('falls back to any panel actively showing a conversation when the focused panel is not one', async () => {
    seedLayout();
    layoutState.focusedPanelId = 'p1';
    renderList();
    await clickRestore();

    expect(findRevealAction()?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
    });
  });

  it('passes a null avoided panel when no panel is actively showing a conversation', async () => {
    seedLayout();
    delete (layoutState.panels as Record<string, unknown>).chat;
    layoutState.focusedPanelId = 'p1';
    renderList();
    await clickRestore();

    expect(findRevealAction()?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: null,
    });
  });
});
