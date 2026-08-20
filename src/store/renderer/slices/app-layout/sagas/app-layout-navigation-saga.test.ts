import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import {
  emptyWorkspaceState,
  openTabInRightmostColumn,
  panelLayoutReducer,
} from '../../panel-layout/panel-layout-slice';
import type { OpenAgentTabDetail } from '../app-layout-types';
import { focusBrowserTabRequested, openAgentTabRequested } from '../app-layout-slice';
import { appLayoutNavigationSaga } from './app-layout-navigation-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('appLayoutNavigationSaga', () => {
  const agentOpenCases: Array<{
    name: string;
    detail: OpenAgentTabDetail;
    expected: { type: string; payload: Record<string, unknown> };
  }> = [
    {
      name: 'routes an ordinary source-context open to the rightmost column',
      detail: { agentId: 'agent-1', sourcePanelId: 'panel-1' },
      expected: {
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: { wsId: 'ws-1', force: true },
      },
    },
    {
      name: 'routes a modifier open beside its source panel',
      detail: { agentId: 'agent-1', sourcePanelId: 'panel-1', openInAdjacentPanel: true },
      expected: {
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: { wsId: 'ws-1', sourcePanelId: 'panel-1', force: true },
      },
    },
    {
      name: 'routes an explicit new-column open in its selected layout',
      detail: {
        agentId: 'agent-1',
        panelLayoutId: 'layout-1',
        sourcePanelId: 'panel-1',
        openInNewColumn: true,
        adaptiveFirstChat: true,
        availablePanelCanvasWidth: 1400,
      },
      expected: {
        type: 'panelLayout/openTabInNewRootColumn',
        payload: {
          wsId: 'layout-1',
          sourcePanelId: 'panel-1',
          availableCanvasWidth: 1400,
          adaptiveFirstChat: true,
          force: true,
        },
      },
    },
    {
      name: 'routes a genuine exact-panel open to its target panel',
      detail: {
        agentId: 'agent-1',
        panelLayoutId: 'layout-1',
        targetPanelId: 'working-panel',
      },
      expected: {
        type: 'panelLayout/openTab',
        payload: { wsId: 'layout-1', panelId: 'working-panel', force: true },
      },
    },
  ];

  it.each(agentOpenCases)('$name', async ({ detail, expected }) => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          agentSessions: { byAgentId: { 'agent-1': { id: 'agent-1', name: 'Ada' } } },
        }),
      },
      appLayoutNavigationSaga,
    );
    channel.put(openAgentTabRequested('ws-1', detail));
    await settle();
    expect(dispatch).toHaveBeenNthCalledWith(1, ensureAgentSessionLoaded('ws-1', 'agent-1'));
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      ...expected,
      payload: {
        ...expected.payload,
        tab: {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('uses the fallback title for an unloaded agent and ignores invalid requests', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => ({ agentSessions: { byAgentId: {} } }) },
      appLayoutNavigationSaga,
    );
    channel.put(openAgentTabRequested('', { agentId: 'agent-1' }));
    channel.put(openAgentTabRequested('ws-1', { agentId: '' }));
    await settle();
    expect(dispatch).not.toHaveBeenCalled();

    channel.put(openAgentTabRequested('ws-1', { agentId: 'agent-missing' }));
    await settle();
    expect(dispatch).toHaveBeenNthCalledWith(1, ensureAgentSessionLoaded('ws-1', 'agent-missing'));
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        force: true,
        tab: {
          type: 'agent',
          title: 'Agent',
          agentId: 'agent-missing',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('opens the requested agent without creating panel pin state', async () => {
    const channel = stdChannel();
    let state: any = {
      agentSessions: { byAgentId: { 'agent-1': { id: 'agent-1', name: 'Ada' } } },
      panelLayout: { byWorkspaceId: { 'ws-1': { panels: {}, pendingPanelReveal: null } } },
    };
    const dispatch = vi.fn((action: any) => {
      if (action.type === 'panelLayout/openTabInRightmostColumnRequested') {
        state = {
          ...state,
          panelLayout: {
            byWorkspaceId: {
              'ws-1': {
                panels: {},
                pendingPanelReveal: {
                  panelId: 'panel-resolved',
                  tabId: 'tab-reused',
                  requestId: action.payload.newTabId,
                },
              },
            },
          },
        };
      }
    });
    const task = runSaga({ channel, dispatch, getState: () => state }, appLayoutNavigationSaga);

    channel.put(openAgentTabRequested('ws-1', { agentId: 'agent-1', pin: true }));
    await settle();

    const openAction = dispatch.mock.calls.find(
      ([action]) => action.type === 'panelLayout/openTabInRightmostColumnRequested',
    )?.[0];
    expect(openAction.payload.newTabId).not.toBe('tab-reused');
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'workspaceAgents/ensureAgentSessionLoaded',
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('keeps a normal two-column sidebar agent open in the rightmost column', async () => {
    const channel = stdChannel();
    const emitted: any[] = [];
    let state: any = {
      agentSessions: { byAgentId: { 'agent-2': { id: 'agent-2', name: 'Grace' } } },
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            ...emptyWorkspaceState,
            root: {
              type: 'split',
              direction: 'horizontal',
              children: [
                { type: 'panel', panelId: 'left' },
                { type: 'panel', panelId: 'right' },
              ],
              sizes: [50, 50],
            },
            panels: {
              left: {
                id: 'left',
                tabs: [{ id: 'left-tab', type: 'note', title: 'Left', noteId: 'left' }],
                activeTabId: 'left-tab',
              },
              right: {
                id: 'right',
                tabs: [{ id: 'old-right', type: 'file', title: 'Old right', filePath: 'old.ts' }],
                activeTabId: 'old-right',
              },
            },
            focusedPanelId: 'left',
            columnCount: 2,
          },
        },
      },
    };
    const dispatch = vi.fn((action: any) => {
      emitted.push(action);
      if (action.type === 'panelLayout/openTabInRightmostColumnRequested') {
        const { wsId, tab, force, allowDuplicate, newTabId, timestamp } = action.payload;
        state = {
          ...state,
          panelLayout: panelLayoutReducer(
            state.panelLayout,
            openTabInRightmostColumn(wsId, tab, { force, allowDuplicate, newTabId }, timestamp),
          ),
        };
      } else if (action.type === 'panelLayout/openTabInNewRootColumn') {
        state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
      }
    });
    const task = runSaga({ channel, dispatch, getState: () => state }, appLayoutNavigationSaga);

    channel.put(
      openAgentTabRequested('ws-1', {
        agentId: 'agent-2',
        panelLayoutId: 'ws-1',
        sourcePanelId: 'left',
      }),
    );
    await settle();

    const workspace = state.panelLayout.byWorkspaceId['ws-1'];
    const rootPanelIds = workspace.root.children.map((child: any) => child.panelId);
    expect(emitted.map((action) => action.type)).toEqual([
      'workspaceAgents/ensureAgentSessionLoaded',
      'panelLayout/openTabInRightmostColumnRequested',
    ]);
    expect(emitted.some((action) => action.type === 'panelLayout/openTabInNewRootColumn')).toBe(
      false,
    );
    expect(workspace.columnCount).toBe(2);
    expect(rootPanelIds).toEqual(['left', 'right']);
    expect(workspace.panels.right.tabs).toEqual([
      expect.objectContaining({ id: 'old-right' }),
      expect.objectContaining({ type: 'agent', agentId: 'agent-2', workspaceId: 'ws-1' }),
    ]);
    expect(workspace.panels.right.activeTabId).toBe(workspace.panels.right.tabs[1].id);
    expect(workspace.layoutHistory[0].panels.right).toMatchObject({
      activeTabId: 'old-right',
      tabs: [expect.objectContaining({ id: 'old-right' })],
    });
    task.cancel();
    await task.toPromise();
  });

  it('focuses the exact panel for a reused browser tab without pin state', async () => {
    const channel = stdChannel();
    const state: any = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              'panel-other': { tabs: [{ id: 'note-1', type: 'note' }] },
              'panel-browser': { tabs: [{ id: 'browser-1', type: 'browser' }] },
            },
            pendingPanelReveal: null,
          },
        },
      },
    };
    const dispatch = vi.fn((action: any) => {
      if (action.type === 'panelLayout/focusPanel') {
        state.panelLayout.byWorkspaceId['ws-1'].pendingPanelReveal = {
          panelId: 'panel-browser',
          tabId: 'browser-1',
          requestId: action.payload.requestId,
        };
      }
    });
    const task = runSaga({ channel, dispatch, getState: () => state }, appLayoutNavigationSaga);

    channel.put(focusBrowserTabRequested('ws-1', 'browser-1', true));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'panelLayout/setActiveTab',
      'panelLayout/focusPanel',
    ]);

    dispatch.mockClear();
    channel.put(focusBrowserTabRequested('ws-1', 'browser-1'));
    await settle();
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'panelLayout/setActiveTab',
      'panelLayout/focusPanel',
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('ignores non-browser and unknown tab focus requests', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              'panel-note': { tabs: [{ id: 'note-1', type: 'note' }] },
            },
          },
        },
      },
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, appLayoutNavigationSaga);

    channel.put(focusBrowserTabRequested('ws-1', 'note-1'));
    channel.put(focusBrowserTabRequested('ws-1', 'missing'));
    await settle();

    expect(dispatch).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });
});
