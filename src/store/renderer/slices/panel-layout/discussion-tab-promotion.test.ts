import { describe, expect, it } from 'vitest';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  emptyWorkspaceState,
  panelLayoutReducer,
  promoteDiscussionTab,
} from './panel-layout-slice';
import type { PanelLayoutSliceState, PanelTab } from './panel-layout-types';

describe('discussion tab promotion', () => {
  it('preserves tab identity and promotes hidden, closed and undo-history copies', () => {
    const tab: PanelTab = {
      id: 'composer',
      type: 'discussion',
      title: 'New discussion',
      data: { conversationId: 'new', workspaceId: 'ws' },
    };
    const other: PanelTab = { ...tab, id: 'unrelated' };
    const panel = { id: 'panel', tabs: [tab, other], activeTabId: tab.id };
    const state: PanelLayoutSliceState = {
      byWorkspaceId: {
        layout: {
          ...emptyWorkspaceState,
          panels: { panel },
          root: { type: 'panel', panelId: 'panel' },
          focusedPanelId: 'panel',
          hiddenTabs: createCollection('id', [tab]),
          recentlyClosed: [{ tab, panelId: 'panel', closedAt: 0 }],
          layoutHistory: [
            {
              panels: { panel },
              root: { type: 'panel', panelId: 'panel' },
              focusedPanelId: 'panel',
              timestamp: 0,
            },
          ],
        },
      },
    };
    const result = panelLayoutReducer(
      state,
      promoteDiscussionTab('layout', 'composer', 'private', 'Alex'),
    );
    const ws = result.byWorkspaceId.layout;
    for (const promoted of [
      ws.panels.panel.tabs[0],
      getItems(ws.hiddenTabs)[0],
      ws.recentlyClosed[0].tab,
      ws.layoutHistory[0].panels.panel.tabs[0],
    ]) {
      expect(promoted).toMatchObject({
        id: 'composer',
        title: 'Alex',
        data: { conversationId: 'private', workspaceId: 'ws' },
      });
    }
    expect(ws.panels.panel.tabs[1]).toEqual(other);
    expect(ws.panels.panel.activeTabId).toBe('composer');
  });
});
