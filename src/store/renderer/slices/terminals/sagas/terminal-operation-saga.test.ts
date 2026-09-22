import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import {
  addTerminal,
  createTerminalFromOverlayFailed,
  createTerminalFromOverlayRequested,
  createTerminalFromOverlaySucceeded,
  createTerminalWithCommandRequested,
  openTerminalOverlay,
} from '../terminals-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { terminalOperationSaga } from './terminal-operation-saga';

describe('terminalOperationSaga', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a terminal with the exact protocol request and exposes it after success', async () => {
    const create = vi.spyOn(appClient.terminals, 'create').mockResolvedValue({
      success: true,
      id: 'terminal-1',
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action) },
      terminalOperationSaga,
    );

    const request = createTerminalWithCommandRequested('ws-1', 'git pull', '/repo', 'Pull');
    channel.put(request);

    await vi.waitFor(() => expect(actions).toContainEqual(request.success('terminal-1')));
    expect(create).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      command: 'git pull',
      cwd: '/repo',
      cols: 80,
      rows: 24,
    });
    expect(actions).toContainEqual(addTerminal('ws-1', 'terminal-1', 'Pull'));
    expect(actions).toContainEqual(openTerminalOverlay('ws-1', 'terminal-1'));

    task.cancel();
    await task.toPromise();
  });

  it('routes overlay creation through the saga-owned terminal client', async () => {
    const create = vi.spyOn(appClient.terminals, 'create').mockResolvedValue({
      success: true,
      id: 'terminal-overlay',
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action) },
      terminalOperationSaga,
    );

    channel.put(createTerminalFromOverlayRequested('ws-overlay'));

    await vi.waitFor(() =>
      expect(actions).toContainEqual(openTerminalOverlay('ws-overlay', 'terminal-overlay')),
    );
    expect(create).toHaveBeenCalledWith({
      workspaceId: 'ws-overlay',
      cols: 80,
      rows: 24,
    });
    expect(actions).toContainEqual(addTerminal('ws-overlay', 'terminal-overlay'));
    expect(actions).toContainEqual(
      createTerminalFromOverlaySucceeded('ws-overlay', 'terminal-overlay'),
    );

    task.cancel();
    await task.toPromise();
  });

  it('reports an unsuccessful overlay create through the keyed operation state', async () => {
    vi.spyOn(appClient.terminals, 'create').mockResolvedValue({
      success: false,
      error: 'offline',
    });
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action) },
      terminalOperationSaga,
    );

    channel.put(createTerminalFromOverlayRequested('ws-overlay'));

    await vi.waitFor(() =>
      expect(actions).toContainEqual(createTerminalFromOverlayFailed('ws-overlay', 'offline')),
    );
    expect(actions).not.toContainEqual(expect.objectContaining({ type: addTerminal.type }));
    expect(actions).not.toContainEqual(expect.objectContaining({ type: openTerminalOverlay.type }));

    task.cancel();
    await task.toPromise();
  });

  it('keeps one overlay create in flight per workspace and cancels it on unmount', async () => {
    const create = vi.spyOn(appClient.terminals, 'create').mockReturnValue(new Promise(() => {}));
    const channel = stdChannel();
    const actions: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => actions.push(action) },
      terminalOperationSaga,
    );

    channel.put(createTerminalFromOverlayRequested('ws-overlay'));
    channel.put(createTerminalFromOverlayRequested('ws-overlay'));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));

    channel.put(workspaceUnmounted('ws-overlay'));
    await vi.waitFor(() =>
      expect(actions).toContainEqual(
        createTerminalFromOverlayFailed('ws-overlay', 'Terminal creation cancelled'),
      ),
    );
    expect(actions).not.toContainEqual(
      expect.objectContaining({ type: createTerminalFromOverlaySucceeded.type }),
    );

    task.cancel();
    await task.toPromise();
  });
});
