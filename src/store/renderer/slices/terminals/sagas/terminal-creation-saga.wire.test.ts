import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/client', async () => {
  const { LiveTerminalsClient } = await import('$lib/client/live/live-terminals-client');
  return { appClient: { terminals: new LiveTerminalsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { initialState as guestSessionsInitialState } from '../../guest-sessions/guest-sessions-slice';
import { openFirstPanelTerminalRequested, terminalsReducer } from '../terminals-slice';
import { terminalCreationSaga } from './terminal-creation-saga';

afterEach(() => vi.clearAllMocks());

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function start() {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  let terminals = terminalsReducer(undefined, { type: '@@INIT' });
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string; payload?: unknown }) => {
        dispatched.push(action);
        terminals = terminalsReducer(terminals, action);
      },
      getState: () =>
        withLegacyPrincipal({
          connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
          guestSessions: { ...guestSessionsInitialState, hasReceivedList: true },
          panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-1' } } },
          terminals,
          workspace: { workspaces: createCollection('id', [{ id: 'ws-1', myRole: 'owner' }]) },
        }),
    },
    terminalCreationSaga,
  );
  const openedTerminalIds = () =>
    dispatched
      .filter((action) => action.type === 'panelLayout/openTab')
      .map((action) => (action.payload as { tab: { terminalId: string } }).tab.terminalId);
  return { channel, task, openedTerminalIds };
}

it('reuses a daemon terminal: terminal.list only, never terminal.create', async () => {
  vi.mocked(backendRequest).mockResolvedValueOnce({
    terminals: [{ id: 'daemon-pty', name: 'Setup Script', cwd: '/w', isExecutingCommand: false }],
    daemonBootId: 'boot-1',
  });
  const { channel, task, openedTerminalIds } = start();

  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();
  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();

  expect(vi.mocked(backendRequest).mock.calls).toEqual([
    ['terminal.list', { workspaceId: 'ws-1' }],
  ]);
  expect(openedTerminalIds()).toEqual(['daemon-pty', 'daemon-pty']);
  task.cancel();
  await task.toPromise();
});

it('creates once when the daemon lists none, then reopens the created terminal', async () => {
  vi.mocked(backendRequest)
    .mockResolvedValueOnce({ terminals: [], daemonBootId: 'boot-1' })
    .mockResolvedValueOnce({ terminalId: 'new-pty' });
  const { channel, task, openedTerminalIds } = start();

  channel.put(openFirstPanelTerminalRequested('ws-1'));
  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();
  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();

  expect(vi.mocked(backendRequest).mock.calls).toEqual([
    ['terminal.list', { workspaceId: 'ws-1' }],
    ['terminal.create', { workspaceId: 'ws-1', cols: 80, rows: 24 }],
  ]);
  expect(openedTerminalIds()).toEqual(['new-pty', 'new-pty']);
  task.cancel();
  await task.toPromise();
});

it('retries terminal.create after a daemon refusal', async () => {
  vi.mocked(backendRequest)
    .mockResolvedValueOnce({ terminals: [] })
    .mockRejectedValueOnce(new Error('spawn failed'))
    .mockResolvedValueOnce({ terminals: [] })
    .mockResolvedValueOnce({ terminalId: 'retry-pty' });
  const { channel, task, openedTerminalIds } = start();

  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();
  channel.put(openFirstPanelTerminalRequested('ws-1'));
  await settle();

  expect(vi.mocked(backendRequest).mock.calls).toEqual([
    ['terminal.list', { workspaceId: 'ws-1' }],
    ['terminal.create', { workspaceId: 'ws-1', cols: 80, rows: 24 }],
    ['terminal.list', { workspaceId: 'ws-1' }],
    ['terminal.create', { workspaceId: 'ws-1', cols: 80, rows: 24 }],
  ]);
  expect(openedTerminalIds()).toEqual(['retry-pty']);
  task.cancel();
  await task.toPromise();
});
