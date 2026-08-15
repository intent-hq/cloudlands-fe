import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { ensureAgentSessionLoaded } from '../../workspace-agents/workspace-agents-slice';
import { openAgentTabRequested } from '../app-layout-slice';
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
      type: 'panelLayout/openTab',
      payload: {
        wsId: 'ws-1',
        panelId: 'panel-1',
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
      type: 'panelLayout/openTabInAdjacentOrSplit',
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
      type: 'panelLayout/openTab',
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
});
