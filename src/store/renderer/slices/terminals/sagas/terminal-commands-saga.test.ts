import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchWindowEvent: vi.fn(),
  disposeTerminal: vi.fn(),
}));

vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: mocks.dispatchWindowEvent }));
vi.mock('$features/terminal/terminal-manager.svelte', () => ({
  terminalManager: { disposeTerminal: mocks.disposeTerminal },
}));

import {
  selectActiveTerminalIdForWorkspace,
  selectTerminalsForWorkspace,
} from '../terminals-selectors';
import {
  addTerminal,
  closeActiveTerminalRequested,
  createTerminalRequested,
  terminalsReducer,
} from '../terminals-slice';
import { terminalCommandsSaga } from './terminal-commands-saga';
import { initialState as guestSessionsInitialState } from '../../guest-sessions/guest-sessions-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';

/** The window-identity slices `selectIsWorkspaceCollaborator` reads: an owner window on the local backend. */
const ownerWindowSlices = {
  connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
  guestSessions: guestSessionsInitialState,
};

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

function startSaga(myRole: 'owner' | 'collaborator' = 'owner') {
  let terminals = terminalsReducer(undefined, { type: '@@init' } as never);
  const workspace = { workspaces: createCollection('id', [{ id: 'ws-1', myRole }]) };
  const input = stdChannel();
  const dispatched: unknown[] = [];
  const dispatch = (action: unknown) => {
    dispatched.push(action);
    terminals = terminalsReducer(terminals, action as never);
    input.put(action as never);
    return action;
  };
  const task = runSaga(
    { channel: input, dispatch, getState: () => ({ ...ownerWindowSlices, terminals, workspace }) },
    terminalCommandsSaga,
  );
  const send = (action: unknown) => {
    terminals = terminalsReducer(terminals, action as never);
    input.put(action as never);
  };
  const getState = () => ({ ...ownerWindowSlices, terminals, workspace }) as never;
  return { dispatched, send, task, getState };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('terminalCommandsSaga', () => {
  it('routes createTerminalRequested to the overlay window event for that workspace', async () => {
    const { dispatched, send, task } = startSaga();

    send(createTerminalRequested('ws-1'));
    await settle();

    expect(mocks.dispatchWindowEvent).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchWindowEvent).toHaveBeenCalledWith('workspace:new-terminal', {
      workspaceId: 'ws-1',
    });
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('drops createTerminalRequested for a collaborator workspace (multiplayer w3)', async () => {
    const { dispatched, send, task } = startSaga('collaborator');

    send(createTerminalRequested('ws-1'));
    await settle();

    expect(mocks.dispatchWindowEvent).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('closes the active terminal through the overlay close path (state removal then PTY dispose)', async () => {
    const { dispatched, send, task, getState } = startSaga();
    send(addTerminal('ws-1', 'term-a'));
    send(addTerminal('ws-1', 'term-b'));
    expect(selectActiveTerminalIdForWorkspace.select(getState(), 'ws-1')).toBe('term-b');

    send(closeActiveTerminalRequested('ws-1'));
    await vi.waitFor(() => expect(mocks.disposeTerminal).toHaveBeenCalledTimes(1));

    expect(dispatched).toEqual([{ type: 'terminals/removeTerminal', payload: ['ws-1', 'term-b'] }]);
    expect(mocks.disposeTerminal).toHaveBeenCalledWith('term-b');
    expect(selectTerminalsForWorkspace.select(getState(), 'ws-1').map((t) => t.id)).toEqual([
      'term-a',
    ]);
    expect(selectActiveTerminalIdForWorkspace.select(getState(), 'ws-1')).toBe('term-a');
    task.cancel();
    await task.toPromise();
  });

  it('is a no-op when the workspace has no active terminal', async () => {
    const { dispatched, send, task } = startSaga();

    send(closeActiveTerminalRequested('ws-empty'));
    await settle();

    expect(dispatched).toEqual([]);
    expect(mocks.disposeTerminal).not.toHaveBeenCalled();
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });
});
