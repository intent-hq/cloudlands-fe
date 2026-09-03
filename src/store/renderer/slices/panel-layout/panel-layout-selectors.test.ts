import { describe, expect, it } from 'vitest';
import {
  selectFocusedPanelTargetsByWorkspaceId,
  selectPanelCanvasWidthsByWorkspaceId,
  selectPanelColumnCount,
  selectPanelColumnCountsByWorkspaceId,
  selectPanelIds,
  selectPanelNavigatorItems,
  selectPanelRestoreStatusesByWorkspaceId,
  selectMostRecentAgentTab,
} from './panel-layout-selectors';
import { emptyWorkspaceState } from './panel-layout-slice';

describe('panel layout selectors', () => {
  it('counts horizontal panel columns rather than vertical panels, tabs, or stale records', () => {
    const state = {
      panelLayout: {
        byWorkspaceId: {
          empty: {
            ...emptyWorkspaceState,
            root: { type: 'panel' as const, panelId: 'empty-panel' },
            panels: { 'empty-panel': { id: 'empty-panel', tabs: [], activeTabId: null } },
          },
          populated: {
            ...emptyWorkspaceState,
            columnCount: 2 as const,
            restoreStatus: 'restored' as const,
            focusedPanelId: 'p1',
            canvasWidth: 1000,
            root: {
              type: 'split' as const,
              direction: 'horizontal' as const,
              sizes: [50, 50],
              children: [
                { type: 'panel' as const, panelId: 'p1' },
                { type: 'panel' as const, panelId: 'p2' },
              ],
            },
            panels: {
              p1: {
                id: 'p1',
                tabs: [
                  { id: 't1', type: 'note' as const, title: 'One', closable: true },
                  { id: 't2', type: 'note' as const, title: 'Two', closable: true },
                ],
                activeTabId: 't1',
              },
              p2: { id: 'p2', tabs: [], activeTabId: null },
              stale: {
                id: 'stale',
                tabs: [{ id: 't3', type: 'agent' as const, title: 'Stale', closable: true }],
                activeTabId: 't3',
              },
            },
          },
          vertical: {
            ...emptyWorkspaceState,
            columnCount: 1 as const,
            restoreStatus: 'pending' as const,
            root: {
              type: 'split' as const,
              direction: 'vertical' as const,
              sizes: [50, 50],
              children: [
                { type: 'panel' as const, panelId: 'v1' },
                { type: 'panel' as const, panelId: 'v2' },
              ],
            },
            panels: {
              v1: {
                id: 'v1',
                tabs: [{ id: 'v1-tab', type: 'note' as const, title: 'One', closable: true }],
                activeTabId: 'v1-tab',
              },
              v2: { id: 'v2', tabs: [], activeTabId: null },
            },
          },
        },
      },
    };

    expect(selectPanelColumnCountsByWorkspaceId.select(state as any)).toEqual({
      empty: 0,
      populated: 2,
      vertical: 1,
    });
    expect(selectPanelColumnCount.select(state as any, 'populated')).toBe(2);
    expect(selectPanelColumnCount.select(state as any, 'vertical')).toBe(1);
    expect(selectPanelIds.select(state as any, 'populated')).toEqual(['p1', 'p2']);
    expect(selectPanelNavigatorItems.select(state as any, 'populated')).toEqual([
      { id: 'p1', title: 'One', type: 'note' },
      { id: 'p2', title: '', type: undefined },
    ]);
    expect(selectPanelCanvasWidthsByWorkspaceId.select(state as any)).toEqual({
      empty: 500,
      populated: 1000,
      vertical: 720,
    });
    expect(selectFocusedPanelTargetsByWorkspaceId.select(state as any)).toEqual({
      empty: { panelId: null, activeTabId: null },
      populated: { panelId: 'p1', activeTabId: 't1' },
      vertical: { panelId: null, activeTabId: null },
    });
    expect(selectPanelRestoreStatusesByWorkspaceId.select(state as any)).toEqual({
      empty: 'idle',
      populated: 'restored',
      vertical: 'pending',
    });
  });

  it('selects the most recently focused live agent tab behind later browser focus', () => {
    const state = {
      panelLayout: {
        byWorkspaceId: {
          workspace: {
            ...emptyWorkspaceState,
            panels: {
              chat: {
                id: 'chat',
                activeTabId: 'agent-new',
                tabs: [
                  {
                    id: 'agent-old',
                    type: 'agent' as const,
                    title: 'Old',
                    closable: true,
                    agentId: 'agent-old',
                  },
                  {
                    id: 'agent-new',
                    type: 'agent' as const,
                    title: 'New',
                    closable: true,
                    agentId: 'agent-new',
                  },
                ],
              },
              browser: {
                id: 'browser',
                activeTabId: 'browser-tab',
                tabs: [
                  { id: 'browser-tab', type: 'browser' as const, title: 'Web', closable: true },
                ],
              },
            },
            focusHistory: [
              { panelId: 'chat', tabId: 'agent-old', timestamp: 1 },
              { panelId: 'missing', tabId: 'stale-agent', timestamp: 2 },
              { panelId: 'chat', tabId: 'agent-new', timestamp: 3 },
              { panelId: 'browser', tabId: 'browser-tab', timestamp: 4 },
            ],
          },
        },
      },
    };

    expect(selectMostRecentAgentTab.select(state as any, 'workspace')).toMatchObject({
      id: 'agent-new',
      agentId: 'agent-new',
    });
    expect(selectMostRecentAgentTab.select(state as any, 'missing')).toBeUndefined();
  });
});
