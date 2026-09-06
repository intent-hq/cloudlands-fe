import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';

import { migratePanelLayoutForWorkspace } from './panel-layout-migration';
import { selectPanelColumnStack, selectPanelColumnStacks } from './panel-layout-selectors';
import {
  closeActiveTab,
  emptyWorkspaceState,
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumn,
  panelLayoutReducer,
  restoreHiddenTab,
} from './panel-layout-slice';
import { PANEL_LAYOUT_PERSISTENCE_VERSION, type PanelTab } from './panel-layout-types';

const WS = 'workspace-1';

function note(id: string): PanelTab {
  return { id, type: 'note', title: id, noteId: id, workspaceId: WS, closable: true };
}

function state(panelIds: string[] = ['p1']) {
  const panels = Object.fromEntries(
    panelIds.map((panelId) => [
      panelId,
      { id: panelId, tabs: [note(`tab-${panelId}`)], activeTabId: `tab-${panelId}` },
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
        focusedPanelId: panelIds[0],
        columnCount: panelIds.length as 1 | 2 | 3 | 4,
        columnCountInitialized: true,
      },
    },
  };
}

describe('column stack algorithm', () => {
  it('pushes normal opens into the intended stack and activates existing resources', () => {
    const opened = panelLayoutReducer(
      state(),
      openTab(WS, { ...note('new'), title: 'New' }, 'p1', 'new', true, 10),
    );
    const deduped = panelLayoutReducer(
      opened,
      openTab(WS, { ...note('tab-p1'), title: 'Existing' }, 'p1', 'ignored', true, 20),
    ).byWorkspaceId[WS];

    expect(deduped.panels.p1.tabs.map((tab) => tab.id)).toEqual(['tab-p1', 'new']);
    expect(deduped.panels.p1.activeTabId).toBe('tab-p1');
  });

  it('creates a right-hand stack when needed and wraps at the four-column limit', () => {
    const created = panelLayoutReducer(
      state(['p1', 'p2']),
      openTabInAdjacentOrSplit(
        WS,
        { ...note('side'), title: 'Side' },
        'p2',
        { newPanelId: 'p3', newTabId: 'side' },
        10,
      ),
    ).byWorkspaceId[WS];
    expect(created.columnCount).toBe(3);
    expect(created.root).toMatchObject({
      children: [{ panelId: 'p1' }, { panelId: 'p2' }, { panelId: 'p3' }],
    });

    const capped = panelLayoutReducer(
      state(['p1', 'p2', 'p3', 'p4']),
      openTabInNewRootColumn(
        WS,
        { ...note('capped'), title: 'Capped' },
        { sourcePanelId: 'p4', newPanelId: 'p5', newTabId: 'capped' },
        20,
      ),
    ).byWorkspaceId[WS];
    expect(Object.keys(capped.panels)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(capped.panels.p1.tabs.at(-1)?.id).toBe('capped');
  });

  it('activates agent-driven panes in the rightmost stack without moving focus', () => {
    const activated = panelLayoutReducer(
      state(['p1', 'p2']),
      openTabInRightmostColumn(
        WS,
        { type: 'browser', title: 'Browser', browserUrl: 'https://example.test', closable: true },
        { newTabId: 'browser', preserveFocus: true },
        10,
      ),
    ).byWorkspaceId[WS];
    expect(activated.focusedPanelId).toBe('p1');
    expect(activated.panels.p2.activeTabId).toBe('browser');
    expect(activated.panels.p2.tabs.map((tab) => tab.id)).toEqual(['tab-p2', 'browser']);
    expect(activated.panels.p2.attentionTabIds ?? []).toEqual([]);
  });

  it('restores an agent pane into a background stack and activates it without moving focus', () => {
    const initial = state(['p1', 'p2']);
    initial.byWorkspaceId[WS].hiddenTabs = createCollection('id', [
      { id: 'browser', type: 'browser', title: 'Browser', closable: true },
    ]);
    const restored = panelLayoutReducer(initial, restoreHiddenTab(WS, 'browser', 10, false))
      .byWorkspaceId[WS];

    expect(restored.focusedPanelId).toBe('p1');
    expect(restored.panels.p1.activeTabId).toBe('tab-p1');
    expect(restored.panels.p2.activeTabId).toBe('browser');
    expect(restored.panels.p2.attentionTabIds ?? []).toEqual([]);
    expect(restored.pendingPanelReveal).toEqual({
      panelId: 'p2',
      tabId: 'browser',
      requestId: 'browser',
      preserveFocus: true,
    });
  });

  it('closes only the active pane while other stack panes remain', () => {
    const initial = panelLayoutReducer(
      state(),
      openTab(WS, { ...note('second'), title: 'Second' }, 'p1', 'second', true, 10),
    );
    const closed = panelLayoutReducer(initial, closeActiveTab(WS, 'p1', 20)).byWorkspaceId[WS];
    expect(closed.panels.p1.tabs.map((tab) => tab.id)).toEqual(['tab-p1']);
    expect(closed.panels.p1.activeTabId).toBe('tab-p1');
  });

  it('selects ordered stack state and migrates attention metadata compatibly', () => {
    const initial = state(['p1', 'p2']);
    initial.byWorkspaceId[WS].panels.p2.attentionTabIds = ['tab-p2'];
    const rootState = { panelLayout: initial };
    expect(
      selectPanelColumnStacks.select(rootState as never, WS).map((stack) => stack.panelId),
    ).toEqual(['p1', 'p2']);
    expect(selectPanelColumnStack.select(rootState as never, WS, 'p2')?.attentionPaneIds).toEqual([
      'tab-p2',
    ]);

    const migrated = migratePanelLayoutForWorkspace(WS, {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: { type: 'panel', panelId: 'p1' },
      panels: {
        p1: {
          id: 'p1',
          tabs: [note('active'), note('waiting')],
          activeTabId: 'active',
          attentionTabIds: ['active', 'waiting', 'missing', 'waiting'],
        },
      },
      focusedPanelId: 'p1',
      columnCount: 1,
    });
    expect(migrated.panels.p1.attentionTabIds).toEqual(['waiting']);
  });
});
