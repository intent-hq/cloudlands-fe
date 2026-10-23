import { describe, expect, it } from 'vitest';
import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  emptyWorkspaceState,
  panelLayoutReducer,
  promoteDiscussionTab,
  syncDiscussionTabs,
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

describe('discussion tab lifecycle', () => {
  it('renames every restorable copy, then deletes them without affecting another workspace', () => {
    const tab: PanelTab = {
      id: 'discussion',
      type: 'discussion',
      title: 'Planning',
      workspaceId: 'ws',
      data: { conversationId: 'shared' },
    };
    const other: PanelTab = { ...tab, id: 'other', workspaceId: 'other' };
    const panel = {
      id: 'panel',
      tabs: [tab, other],
      activeTabId: tab.id,
      attentionTabIds: [tab.id],
    };
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
    const renamed = panelLayoutReducer(state, syncDiscussionTabs('ws', 'shared', 'Design'));
    const ws = renamed.byWorkspaceId.layout;
    for (const copy of [
      ws.panels.panel.tabs[0],
      getItems(ws.hiddenTabs)[0],
      ws.recentlyClosed[0].tab,
      ws.layoutHistory[0].panels.panel.tabs[0],
    ]) {
      expect(copy.title).toBe('Design');
      expect(copy.id).toBe('discussion');
    }
    expect(ws.panels.panel.tabs[1]).toBe(other);
    const deleted = panelLayoutReducer(renamed, syncDiscussionTabs('ws', 'shared', null));
    const result = deleted.byWorkspaceId.layout;
    expect(result.panels.panel.tabs.map((t) => t.id)).toEqual(['other']);
    expect(result.panels.panel.activeTabId).toBe('other');
    expect(result.panels.panel.attentionTabIds).toEqual([]);
    expect(getItems(result.hiddenTabs)).toEqual([]);
    expect(result.recentlyClosed).toEqual([]);
    expect(result.layoutHistory[0].panels.panel.tabs.map((t) => t.id)).toEqual(['other']);
    expect(panelLayoutReducer(deleted, syncDiscussionTabs('ws', 'shared', null))).toBe(deleted);
  });
});
