import { describe, expect, it } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  closeTab,
  emptyWorkspaceState,
  panelLayoutReducer as rawPanelLayoutReducer,
  restoreHiddenTab,
  revealHiddenTabAvoidingPanel,
  tabMovedToWindow,
  tabReturnedFromWindow,
  tabWindowFocusConsumed,
  updateTabTitle,
} from './panel-layout-slice';
import type { PanelLayoutSliceState, PanelTab } from './panel-layout-types';
import { withPanelLayoutInvariants } from './panel-layout-invariants.test-helpers';
import { classifyOffscreenTab } from './offscreen-webview-eligibility';

const WS = 'ws-1';
const reducer = withPanelLayoutInvariants(rawPanelLayoutReducer);

const browser: PanelTab = {
  id: 'b1',
  type: 'browser',
  title: 'Page',
  closable: true,
  browserUrl: 'https://example.com/',
};
const note: PanelTab = { id: 'n1', type: 'note', title: 'Spec', closable: true, noteId: 'spec' };

function state(): PanelLayoutSliceState {
  return {
    byWorkspaceId: {
      [WS]: {
        ...emptyWorkspaceState,
        root: { type: 'panel', panelId: 'p1' },
        panels: { p1: { id: 'p1', tabs: [note, browser], activeTabId: 'b1' } },
        focusedPanelId: 'p1',
      },
    },
  } as PanelLayoutSliceState;
}

function moveOut(from = state()) {
  return reducer(from, tabMovedToWindow(WS, 'b1', 'tw-1', 1));
}

describe('tab windows in the panel layout', () => {
  it('moving a tab out keeps it as a hidden copy marked with its window', () => {
    const ws = moveOut().byWorkspaceId[WS];
    expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['n1']);
    expect(ws.panels.p1.activeTabId).toBe('n1');
    expect(getItem(ws.hiddenTabs, 'b1')).toEqual({ ...browser, tabWindowId: 'tw-1' });
    // Not a close: nothing to reopen, and undo cannot show it here too.
    expect(ws.recentlyClosed).toEqual([]);
    expect(
      ws.layoutHistory.some((snap) =>
        Object.values(snap.panels).some((p) => p.tabs.some((t) => t.id === 'b1')),
      ),
    ).toBe(false);
  });

  it('a user close, a reveal or an agent focus never pulls the copy out of its window', () => {
    let next = moveOut();
    next = reducer(next, closeTab(WS, 'b1'));
    next = reducer(next, restoreHiddenTab(WS, 'b1', 2));
    next = reducer(next, revealHiddenTabAvoidingPanel(WS, 'b1', null, 3));
    const ws = next.byWorkspaceId[WS];
    expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['n1']);
    expect(getItem(ws.hiddenTabs, 'b1')?.tabWindowId).toBe('tw-1');
    // The reveal asks for the tab window instead (the saga brings it up).
    expect(ws.tabWindowFocusRequest).toEqual({ tabWindowId: 'tw-1', seq: 2 });
    const consumed = reducer(next, tabWindowFocusConsumed(WS, 2)).byWorkspaceId[WS];
    expect(consumed.tabWindowFocusRequest).toBeNull();
  });

  it('the copy follows the window: a title change lands on it', () => {
    const ws = reducer(moveOut(), updateTabTitle(WS, 'b1', 'Next')).byWorkspaceId[WS];
    expect(getItem(ws.hiddenTabs, 'b1')?.title).toBe('Next');
  });

  it('moving back shows the tab again, same id, with what the window last reported', () => {
    const back = reducer(
      moveOut(),
      tabReturnedFromWindow(WS, { ...browser, tabWindowId: 'tw-1', title: 'After' }, 4),
    );
    const ws = back.byWorkspaceId[WS];
    expect(getItems(ws.hiddenTabs)).toEqual([]);
    expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['n1', 'b1']);
    expect(ws.panels.p1.activeTabId).toBe('b1');
    const returned = ws.panels.p1.tabs[1];
    expect(returned.title).toBe('After');
    expect('tabWindowId' in returned).toBe(false);
    expect(ws.pendingPanelReveal?.tabId).toBe('b1');
  });

  it('a tab coming back to a layout without its copy is added; one already shown is not doubled', () => {
    const fresh = {
      byWorkspaceId: {
        [WS]: {
          ...emptyWorkspaceState,
          root: { type: 'panel', panelId: 'p1' },
          panels: { p1: { id: 'p1', tabs: [note], activeTabId: 'n1' } },
          focusedPanelId: 'p1',
        },
      },
    } as PanelLayoutSliceState;
    const added = reducer(fresh, tabReturnedFromWindow(WS, browser, 5));
    expect(added.byWorkspaceId[WS].panels.p1.tabs.map((t) => t.id)).toEqual(['n1', 'b1']);
    const again = reducer(added, tabReturnedFromWindow(WS, { ...browser, title: 'X' }, 6));
    expect(again.byWorkspaceId[WS].panels.p1.tabs.map((t) => t.id)).toEqual(['n1', 'b1']);
    expect(again.byWorkspaceId[WS].panels.p1.tabs[1].title).toBe('X');
  });

  it('every tab type moves out and back the same way', () => {
    const types: PanelTab[] = [
      { id: 't-agent', type: 'agent', title: 'Agent', closable: true, agentId: 'a1' },
      { id: 't-term', type: 'terminal', title: 'Shell', closable: true, terminalId: 't1' },
      { id: 't-file', type: 'file', title: 'a.ts', closable: true, filePath: 'a.ts' },
      { id: 't-diff', type: 'diff', title: 'diff', closable: true, diffPath: 'a.ts' },
      { id: 't-disc', type: 'discussion', title: 'Chat', closable: true },
      { id: 't-settings', type: 'settings', title: 'Settings', closable: true },
      note,
      browser,
    ];
    for (const tab of types) {
      let next = {
        byWorkspaceId: {
          [WS]: {
            ...emptyWorkspaceState,
            root: { type: 'panel', panelId: 'p1' },
            panels: { p1: { id: 'p1', tabs: [tab], activeTabId: tab.id } },
            focusedPanelId: 'p1',
          },
        },
      } as PanelLayoutSliceState;
      next = reducer(next, tabMovedToWindow(WS, tab.id, 'tw', 1));
      expect(next.byWorkspaceId[WS].panels.p1.tabs, tab.type).toEqual([]);
      next = reducer(next, tabReturnedFromWindow(WS, tab, 2));
      expect(next.byWorkspaceId[WS].panels.p1.tabs, tab.type).toEqual([tab]);
    }
  });

  it('the source window never hosts the page of a tab that is in its own window', () => {
    expect(
      classifyOffscreenTab(
        { ...browser, tabWindowId: 'tw-1' },
        { ownClientId: 'me', leased: false, placement: 'hidden', workspaceDisplayed: false },
      ),
    ).toEqual({ eligible: false, reason: 'in-tab-window' });
  });
});
