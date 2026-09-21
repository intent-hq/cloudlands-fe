import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { fork } from 'typed-redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  dispatchWindowEvent: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: mocks.dispatchWindowEvent }));

vi.mock('$lib/client', () => ({
  appClient: { terminals: { create: mocks.create } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: mocks.info, error: mocks.error }),
}));

import { createTerminalRequested, createPanelTerminalRequested } from '../terminals-slice';
import { terminalCreationSaga } from './terminal-creation-saga';
import { terminalCommandsSaga } from './terminal-commands-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga(myRole: 'owner' | 'collaborator' = 'owner') {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string; payload?: unknown }) => dispatched.push(action),
      getState: () => ({
        panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-1' } } },
        workspace: { workspaces: createCollection('id', [{ id: 'ws-1', myRole }]) },
      }),
    },
    function* () {
      yield* fork(terminalCreationSaga);
      yield* fork(terminalCommandsSaga);
    },
  );
  return { channel, dispatched, task };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('terminalCreationSaga', () => {
  it('creates, reloads, and opens a terminal in the focused panel', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'term-1' });
    const { channel, dispatched, task } = startSaga();

    channel.put(createPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchWindowEvent).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({ workspaceId: 'ws-1', cols: 80, rows: 24 });
    expect(dispatched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'terminals/removeTerminal', payload: ['ws-1', 'term-1'] }),
        expect.objectContaining({ type: 'terminals/saveTerminalMetadata' }),
        expect.objectContaining({ type: 'terminals/hydrateTerminalsRequested' }),
        expect.objectContaining({
          type: 'panelLayout/openTab',
          payload: expect.objectContaining({
            wsId: 'ws-1',
            panelId: 'panel-1',
            tab: expect.objectContaining({
              type: 'terminal',
              terminalId: 'term-1',
              closable: true,
            }),
          }),
        }),
      ]),
    );
    task.cancel();
    await task.toPromise();
  });

  it('opens in the requested panel even when another panel is focused', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'term-2' });
    const { channel, dispatched, task } = startSaga();

    channel.put(createPanelTerminalRequested('ws-1', 'panel-2'));
    await settle();

    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({ wsId: 'ws-1', panelId: 'panel-2' }),
      }),
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchWindowEvent).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('leaves overlay creation requests to terminalCommandsSaga', async () => {
    const { channel, dispatched, task } = startSaga();

    channel.put(createTerminalRequested('ws-1'));
    await settle();

    expect(mocks.dispatchWindowEvent).toHaveBeenCalledExactlyOnceWith('workspace:new-terminal', {
      workspaceId: 'ws-1',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  // The global new-terminal shortcut dispatches createPanelTerminalRequested
  // without a role check; the saga is where a collaborator's request stops
  // before the owner-only `terminal.create` (multiplayer w3).
  it('drops a collaborator request before calling terminal.create', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'term-1' });
    const { channel, dispatched, task } = startSaga('collaborator');

    channel.put(createPanelTerminalRequested('ws-1'));
    channel.put(createPanelTerminalRequested('ws-1', 'panel-2'));
    await settle();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it('drops a collaborator overlay creation request before the window event', async () => {
    const { channel, dispatched, task } = startSaga('collaborator');

    channel.put(createTerminalRequested('ws-1'));
    await settle();

    expect(mocks.dispatchWindowEvent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('logs a failed create without opening a tab', async () => {
    mocks.create.mockResolvedValue({ success: false, error: 'offline' });
    const { channel, dispatched, task } = startSaga();

    channel.put(createPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.error).toHaveBeenCalledWith('Failed to create terminal', { error: 'offline' });
    expect(dispatched).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'panelLayout/openTab' })]),
    );
    task.cancel();
    await task.toPromise();
  });
});
