import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { terminals: { create: mocks.create } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: mocks.info, error: mocks.error }),
}));

import { createTerminalRequested } from '../terminals-slice';
import { terminalCreationSaga } from './terminal-creation-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga() {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action: { type: string; payload?: unknown }) => dispatched.push(action),
      getState: () => ({
        panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-1' } } },
      }),
    },
    terminalCreationSaga,
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

    channel.put(createTerminalRequested('ws-1'));
    await settle();

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

  it('logs a failed create without opening a tab', async () => {
    mocks.create.mockResolvedValue({ success: false, error: 'offline' });
    const { channel, dispatched, task } = startSaga();

    channel.put(createTerminalRequested('ws-1'));
    await settle();

    expect(mocks.error).toHaveBeenCalledWith('Failed to create terminal', { error: 'offline' });
    expect(dispatched).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'panelLayout/openTab' })]),
    );
    task.cancel();
    await task.toPromise();
  });
});
