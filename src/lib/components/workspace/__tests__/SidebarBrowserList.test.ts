/**
 * @vitest-environment jsdom
 *
 * SidebarBrowserList hidden-tab restore (monorepo#3113): the sidebar reveal
 * must dispatch revealHiddenTabAvoidingPanel with the panel hosting the
 * currently-viewed conversation avoided — never the focused-panel-targeting
 * restoreHiddenTab, which mounted the tab over the chat.
 */
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ScriptWithState } from '$features/scripts/types';

const { dispatchMock, layoutState, managerMock, scripts } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  layoutState: {
    panels: {} as Record<string, unknown>,
    hiddenTabs: [] as unknown[],
    focusedPanelId: null as string | null,
  },
  managerMock: {
    setActiveTab: vi.fn(),
    focusPanel: vi.fn(),
    openBrowserPanel: vi.fn(),
  },
  scripts: [] as ScriptWithState[],
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
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
  const readable = { subscribe: (run: (value: unknown) => void) => (run(scripts), () => {}) };
  const selectWorkspaceScriptEntries = () => readable;
  return { selectWorkspaceScriptEntries };
});

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => managerMock,
}));

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
  scripts.length = 0;
  vi.clearAllMocks();
});

function renderList() {
  return render(SidebarBrowserList, { workspaceId: 'ws-1', panelLayoutId: 'ws-1' });
}

async function clickRestore() {
  const hiddenRow = document.querySelector('[data-sidebar-browser-hidden-tab="hidden-1"]');
  expect(hiddenRow).not.toBeNull();
  // Whole-row clickable (monorepo#3169): the hidden row itself is the button.
  expect((hiddenRow as HTMLElement).tagName).toBe('BUTTON');
  await fireEvent.click(hiddenRow as HTMLElement);
}

function findRevealAction() {
  const dispatched = dispatchMock.mock.calls.map(([action]) => action);
  return dispatched.find((a) => a.type === revealHiddenTabAvoidingPanel('ws-1', 'x', null).type);
}

describe('SidebarBrowserList hidden-tab restore', () => {
  it('opens a running target as new and restores an existing hidden browser tab', async () => {
    scripts.push({
      id: 'dev-server',
      workspaceId: 'ws-1',
      name: 'Dev server',
      command: 'pnpm dev',
      mode: 'service',
      source: 'user',
      createdAt: '2026-09-01T00:00:00.000Z',
      runtime: {
        status: 'running',
        restartCount: 0,
        detectedUrl: 'http://localhost:5173',
      },
    });
    renderList();
    await fireEvent.click(document.querySelector<HTMLElement>('[data-browser-running-url]')!);
    expect(managerMock.openBrowserPanel).toHaveBeenCalledWith('http://localhost:5173');

    cleanup();
    scripts.length = 0;
    seedLayout();
    renderList();
    await clickRestore();
    expect(findRevealAction()?.payload).toMatchObject({
      wsId: 'ws-1',
      tabId: 'hidden-1',
      avoidPanelId: 'chat',
    });
  });

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
