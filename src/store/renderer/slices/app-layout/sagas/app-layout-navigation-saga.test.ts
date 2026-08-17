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

  it('focuses the panel and activates the tab for focusBrowserTabRequested, ignoring unknown tabs', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          panelLayout: {
            byWorkspaceId: {
              'ws-1': {
                panels: {
                  'panel-a': { tabs: [{ id: 'note-1', type: 'note' }] },
                  'panel-b': { tabs: [{ id: 'browser-1', type: 'browser' }] },
                },
              },
            },
          },
        }),
      },
      appLayoutNavigationSaga,
    );
    channel.put(focusBrowserTabRequested('ws-1', 'browser-1'));
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toEqual({
      type: 'panelLayout/focusPanel',
      payload: ['ws-1', 'panel-b'],
    });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/setActiveTab',
      payload: { wsId: 'ws-1', tabId: 'browser-1', panelId: 'panel-b' },
    });

    dispatch.mockClear();
    channel.put(focusBrowserTabRequested('ws-1', 'missing-tab'));
    channel.put(focusBrowserTabRequested('', 'browser-1'));
    channel.put(focusBrowserTabRequested('ws-1', ''));
    await settle();
    expect(dispatch).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });

  // focusTab is a browser-only action: a supplied id that matches an agent,
  // note, or terminal tab must not activate that unrelated tab.
  it('never activates a non-browser tab for focusBrowserTabRequested', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          panelLayout: {
            byWorkspaceId: {
              'ws-1': {
                panels: {
                  'panel-a': {
                    tabs: [
                      { id: 'note-1', type: 'note' },
                      { id: 'agent-1', type: 'agent' },
                      { id: 'terminal-1', type: 'terminal' },
                    ],
                  },
                },
              },
            },
          },
        }),
      },
      appLayoutNavigationSaga,
    );
    channel.put(focusBrowserTabRequested('ws-1', 'note-1'));
    channel.put(focusBrowserTabRequested('ws-1', 'agent-1'));
    channel.put(focusBrowserTabRequested('ws-1', 'terminal-1'));
    await settle();
    expect(dispatch).not.toHaveBeenCalled();

    task.cancel();
    await task.toPromise();
  });
});
