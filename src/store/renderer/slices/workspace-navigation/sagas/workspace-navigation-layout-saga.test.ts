import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { hydrateWorkspaceNavigation } from '../workspace-navigation-slice';
import { workspaceNavigationLayoutSaga } from './workspace-navigation-layout-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('workspaceNavigationLayoutSaga', () => {
  it('rehydrates the note before the adjacent agent request', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, workspaceNavigationLayoutSaga);
    channel.put(
      hydrateWorkspaceNavigation('ws-1', {
        mainPanel: { type: 'notes', selectedNoteId: 'spec' },
        drawer: { open: true, type: 'agent', itemId: 'agent-1' },
      }),
    );
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        tab: {
          type: 'note',
          title: 'Spec',
          noteId: 'spec',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      openAgentTabRequested('ws-1', { agentId: 'agent-1', openInAdjacentPanel: true }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens an agent-only drawer without forcing adjacency', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, workspaceNavigationLayoutSaga);
    channel.put(
      hydrateWorkspaceNavigation('ws-1', {
        mainPanel: { type: 'empty' },
        drawer: { open: true, type: 'agent', itemId: 'agent-1' },
      }),
    );
    await settle();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(
      openAgentTabRequested('ws-1', { agentId: 'agent-1', openInAdjacentPanel: false }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('hydrates a note without reopening a closed drawer and ignores empty layouts', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch }, workspaceNavigationLayoutSaga);
    channel.put(
      hydrateWorkspaceNavigation('ws-1', {
        mainPanel: { type: 'notes', selectedNoteId: 'note-1' },
        drawer: { open: false, type: 'agent', itemId: 'agent-1' },
      }),
    );
    await settle();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        tab: { type: 'note', title: 'note-1', noteId: 'note-1', workspaceId: 'ws-1' },
      },
    });

    dispatch.mockClear();
    channel.put(
      hydrateWorkspaceNavigation('ws-1', {
        mainPanel: { type: 'empty' },
        drawer: { open: false, type: null, itemId: null },
      }),
    );
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });
});
