import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { focusBrowserTabRequested, openAgentTabRequested } from '../app-layout-slice';
import { appLayoutNavigationSaga } from './app-layout-navigation-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('appLayoutNavigationSaga', () => {
  it('requests hydration before opening normal and adjacent agent tabs', async () => {
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
    channel.put(openAgentTabRequested('ws-1', { agentId: 'agent-1', sourcePanelId: 'panel-1' }));
    await settle();
    expect(dispatch).toHaveBeenNthCalledWith(1, ensureAgentSessionLoaded('ws-1', 'agent-1'));
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInNewRootColumn',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-1',
        force: true,
        tab: {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });

    dispatch.mockClear();
    channel.put(
      openAgentTabRequested('ws-1', {
        agentId: 'agent-1',
        sourcePanelId: 'panel-1',
        openInAdjacentPanel: true,
      }),
    );
    await settle();
    expect(dispatch).toHaveBeenNthCalledWith(1, ensureAgentSessionLoaded('ws-1', 'agent-1'));
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInNewRootColumn',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-1',
        force: true,
        tab: {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });

    dispatch.mockClear();
    channel.put(
      openAgentTabRequested('ws-1', {
        agentId: 'agent-1',
        panelLayoutId: 'layout-1',
        openInNewColumn: true,
        adaptiveFirstChat: true,
        availablePanelCanvasWidth: 1400,
      }),
    );
    await settle();
    expect(dispatch).toHaveBeenNthCalledWith(1, ensureAgentSessionLoaded('ws-1', 'agent-1'));
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInNewRootColumn',
      payload: {
        wsId: 'layout-1',
        adaptiveFirstChat: true,
        availableCanvasWidth: 1400,
        force: true,
        tab: { agentId: 'agent-1', workspaceId: 'ws-1' },
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
      type: 'panelLayout/openTabInNewRootColumn',
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

  it('uses the explicit layout and source panel for a normal agent open', async () => {
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
    channel.put(
      openAgentTabRequested('ws-1', {
        agentId: 'agent-1',
        panelLayoutId: 'layout-1',
        sourcePanelId: 'working-panel',
      }),
    );
    await settle();

    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInNewRootColumn',
      payload: {
        wsId: 'layout-1',
        sourcePanelId: 'working-panel',
        tab: { agentId: 'agent-1', workspaceId: 'ws-1' },
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
      if (action.type === 'panelLayout/openTabInNewRootColumn') {
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
      ([action]) => action.type === 'panelLayout/openTabInNewRootColumn',
    )?.[0];
    expect(openAction.payload.newTabId).not.toBe('tab-reused');
    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'workspaceAgents/ensureAgentSessionLoaded',
      'panelLayout/openTabInNewRootColumn',
    ]);
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
