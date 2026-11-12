import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import {
  emptyWorkspaceState,
  openTabBehindActive,
  panelLayoutReducer as rawPanelLayoutReducer,
  restoreHiddenTab,
} from './panel-layout-slice';
import { getPanelOrder } from './panel-layout-tabless';
import type { PanelLayoutSliceState, PanelTab } from './panel-layout-types';
import { withPanelLayoutInvariants } from './panel-layout-invariants.test-helpers';

const WS = 'workspace-1';
const panelLayoutReducer = withPanelLayoutInvariants(rawPanelLayoutReducer);

function note(id: string): PanelTab {
  return { id, type: 'note', title: id, noteId: id, workspaceId: WS, closable: true };
}

function agentChat(agentId: string): PanelTab {
  return { id: `chat-${agentId}`, type: 'agent', title: agentId, agentId, closable: true };
}

const browser = {
  type: 'browser' as const,
  title: 'Browser',
  browserUrl: 'https://example.test',
  ownerAgentId: 'agent-1',
  closable: true,
};

/** Fixed columns, each holding the given tabs with the first one active. */
function layout(columns: Record<string, PanelTab[]>, focusedPanelId?: string) {
  const panelIds = Object.keys(columns);
  const panels = Object.fromEntries(
    panelIds.map((panelId) => [
      panelId,
      { id: panelId, tabs: columns[panelId], activeTabId: columns[panelId][0]?.id ?? null },
    ]),
  );
  return {
    byWorkspaceId: {
      [WS]: {
        ...emptyWorkspaceState,
        root:
          panelIds.length === 1
            ? ({ type: 'panel', panelId: panelIds[0] } as const)
            : ({
                type: 'split',
                direction: 'horizontal',
                children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
                sizes: panelIds.map(() => 100 / panelIds.length),
              } as const),
        panels,
        focusedPanelId: focusedPanelId ?? panelIds[0],
        columnCount: panelIds.length as 1 | 2 | 3 | 4,
        columnCountInitialized: true,
      },
    },
  } as unknown as PanelLayoutSliceState;
}

function withHidden(state: PanelLayoutSliceState, tab: PanelTab): PanelLayoutSliceState {
  state.byWorkspaceId[WS].hiddenTabs = createCollection('id', [tab]);
  return state;
}

describe('agent browser tabs open beside the owner agent chat', () => {
  describe('visible open', () => {
    it('splits a single column and shows the tab to the right of the agent', () => {
      const before = layout({ p1: [agentChat('agent-1')] });
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p-new']);
      expect(ws.columnCount).toBe(2);
      expect(ws.panels.p1.activeTabId).toBe('chat-agent-1');
      expect(ws.panels['p-new'].tabs.map((tab) => tab.id)).toEqual(['browser-1']);
      expect(ws.panels['p-new'].activeTabId).toBe('browser-1');
      expect(ws.focusedPanelId).toBe('p1');
      expect(ws.pendingPanelReveal).toEqual({
        panelId: 'p-new',
        tabId: 'browser-1',
        requestId: 'browser-1',
        preserveFocus: true,
      });
    });

    it('shows the tab in the column to the right of the agent', () => {
      const before = layout({ p1: [agentChat('agent-1')], p2: [note('n2')] });
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p2']);
      expect(ws.panels.p2.tabs.map((tab) => tab.id)).toEqual(['n2', 'browser-1']);
      expect(ws.panels.p2.activeTabId).toBe('browser-1');
      expect(ws.panels.p1.activeTabId).toBe('chat-agent-1');
      expect(ws.focusedPanelId).toBe('p1');
    });

    it('uses the column to the left when the agent is rightmost', () => {
      const before = layout({ p1: [note('n1')], p2: [agentChat('agent-1')] }, 'p2');
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(ws.panels.p1.activeTabId).toBe('browser-1');
      expect(ws.panels.p2.activeTabId).toBe('chat-agent-1');
      expect(ws.focusedPanelId).toBe('p2');
    });

    it('prefers the right neighbour when the agent is between columns', () => {
      const before = layout({ p1: [note('n1')], p2: [agentChat('agent-1')], p3: [note('n3')] });
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(ws.panels.p3.activeTabId).toBe('browser-1');
      expect(ws.panels.p1.activeTabId).toBe('n1');
      expect(ws.panels.p2.activeTabId).toBe('chat-agent-1');
      expect(ws.focusedPanelId).toBe('p1');
    });

    it('splits beside the agent instead of covering the focused right neighbour', () => {
      const before = layout({ p1: [agentChat('agent-1')], p2: [note('n2')] }, 'p2');
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p-new', 'p2']);
      expect(ws.panels['p-new'].activeTabId).toBe('browser-1');
      expect(ws.panels.p2.activeTabId).toBe('n2');
      expect(ws.panels.p1.activeTabId).toBe('chat-agent-1');
      expect(ws.focusedPanelId).toBe('p2');
    });

    it('splits beside a rightmost agent instead of covering the focused left neighbour', () => {
      const before = layout({ p1: [note('n1')], p2: [agentChat('agent-1')] }, 'p1');
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p2', 'p-new']);
      expect(ws.panels['p-new'].activeTabId).toBe('browser-1');
      expect(ws.panels.p1.activeTabId).toBe('n1');
      expect(ws.focusedPanelId).toBe('p1');
    });

    it('keeps the background open when the owner chat is behind another tab', () => {
      const before = layout({ p1: [note('n1'), agentChat('agent-1')], p2: [note('n2')] });
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(ws.panels.p1.tabs.map((tab) => tab.id)).toEqual(['browser-1', 'n1', 'chat-agent-1']);
      expect(ws.panels.p1.activeTabId).toBe('n1');
      expect(ws.panels.p2.activeTabId).toBe('n2');
    });

    it('keeps the background open when another agent chat is shown', () => {
      const before = layout({ p1: [agentChat('agent-2')] });
      const ws = panelLayoutReducer(before, openTabBehindActive(WS, browser, 'browser-1', 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1']);
      expect(ws.panels.p1.tabs.map((tab) => tab.id)).toEqual(['browser-1', 'chat-agent-2']);
      expect(ws.panels.p1.activeTabId).toBe('chat-agent-2');
    });
  });

  describe('show of a hidden tab', () => {
    const hiddenBrowser: PanelTab = { ...browser, id: 'browser-1' };

    it('splits a single column and shows the tab to the right of the agent', () => {
      const before = withHidden(layout({ p1: [agentChat('agent-1')] }), hiddenBrowser);
      const ws = panelLayoutReducer(before, restoreHiddenTab(WS, 'browser-1', 1000, false, 'p-new'))
        .byWorkspaceId[WS];

      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p-new']);
      expect(ws.panels.p1.activeTabId).toBe('chat-agent-1');
      expect(ws.panels['p-new'].activeTabId).toBe('browser-1');
      expect(ws.focusedPanelId).toBe('p1');
    });

    it('never covers the agent chat when it sits in a non-focused column', () => {
      const before = withHidden(
        layout({ p1: [note('n1')], p2: [agentChat('agent-1')], p3: [note('n3')] }),
        hiddenBrowser,
      );
      const ws = panelLayoutReducer(before, restoreHiddenTab(WS, 'browser-1', 1000, false, 'p-new'))
        .byWorkspaceId[WS];

      expect(ws.panels.p2.activeTabId).toBe('chat-agent-1');
      expect(ws.panels.p3.activeTabId).toBe('browser-1');
      expect(ws.focusedPanelId).toBe('p1');
    });

    it('keeps finding a free column when the owner chat is not shown', () => {
      const before = withHidden(layout({ p1: [note('n1')], p2: [note('n2')] }), hiddenBrowser);
      const ws = panelLayoutReducer(before, restoreHiddenTab(WS, 'browser-1', 1000, false, 'p-new'))
        .byWorkspaceId[WS];

      expect(getPanelOrder(ws.root)).toEqual(['p1', 'p2']);
      expect(ws.panels.p2.activeTabId).toBe('browser-1');
      expect(ws.focusedPanelId).toBe('p1');
    });
  });
});
