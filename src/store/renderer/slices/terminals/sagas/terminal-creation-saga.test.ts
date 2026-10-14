import { createEventRecoveryMiddleware } from '$store/renderer/middlewares/event-recovery';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { fork } from 'typed-redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  clearTerminalCreationOutcome,
  createOverlayTerminalRequested,
  createPanelTerminalRequested,
  createTerminalRequested,
  terminalsReducer,
} from '../terminals-slice';
import { terminalCreationSaga } from './terminal-creation-saga';
import { terminalCommandsSaga } from './terminal-commands-saga';
import { initialState as guestSessionsInitialState } from '../../guest-sessions/guest-sessions-slice';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function startSaga(
  myRole: 'owner' | 'collaborator' = 'owner',
  beforeDispatch?: (action: { type: string }) => void,
) {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  let terminals = terminalsReducer(undefined, { type: '@@INIT' });
  const dispatch = createEventRecoveryMiddleware()({} as never)(
    (action: { type: string; payload?: unknown }) => {
      dispatched.push(action);
      terminals = terminalsReducer(terminals, action);
    },
  );
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        beforeDispatch?.(action);
        return dispatch(action);
      },
      getState: () =>
        withLegacyPrincipal({
          connections: { activeId: LOCAL_CONNECTION_ID, windowBackendId: LOCAL_CONNECTION_ID },
          // Settled owner window: guest list received, no host joined.
          guestSessions: { ...guestSessionsInitialState, hasReceivedList: true },
          panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-1' } } },
          terminals,
          workspace: { workspaces: createCollection('id', [{ id: 'ws-1', myRole }]) },
        }),
    },
    function* () {
      yield* fork(terminalCreationSaga);
      yield* fork(terminalCommandsSaga);
    },
  );
  return {
    channel,
    dispatched,
    task,
    put: (action: ReturnType<typeof createOverlayTerminalRequested> | { type: string }) => {
      terminals = terminalsReducer(terminals, action);
      channel.put(action);
    },
    getTerminalsState: () => terminals,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => rendererEventRecovery.dispose());

describe('terminalCreationSaga', () => {
  it('returns the daemon-assigned id for an authorized overlay create', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'daemon-pty-1' });
    const { channel, dispatched, task } = startSaga();
    const request = createOverlayTerminalRequested('ws-1');

    channel.put(request);
    await expect(request.promise).resolves.toBe('daemon-pty-1');

    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'ws-1',
      cols: 80,
      rows: 24,
    });
    expect(dispatched.map((action) => action.type)).toEqual([
      'terminals/addTerminal',
      'terminals/open',
      createOverlayTerminalRequested.success.type,
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('publishes a correlated success after saga-owned insertion and opening', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'daemon-pty-1' });
    const { dispatched, getTerminalsState, put, task } = startSaga();
    const request = createOverlayTerminalRequested('ws-1', {
      id: 'mount-1',
      resourceId: 'overlay',
    });

    put(request);
    await expect(request.promise).resolves.toBe('daemon-pty-1');

    expect(dispatched.map((action) => action.type)).toEqual([
      'terminals/addTerminal',
      'terminals/open',
      'terminals/terminalCreationFinished',
      createOverlayTerminalRequested.success.type,
    ]);
    expect(getTerminalsState().creationOutcomes.map['mount-1']).toMatchObject({
      status: 'success',
      terminalId: 'daemon-pty-1',
      seq: request.seq,
    });
    task.cancel();
    await task.toPromise();
  });

  it('keeps a created terminal visible after the requesting overlay releases', async () => {
    let resolveCreate: (value: { success: true; id: string }) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const { dispatched, put, task } = startSaga();
    const request = createOverlayTerminalRequested('ws-1', {
      id: 'mount-1',
      resourceId: 'overlay',
    });

    put(request);
    await settle();
    put(clearTerminalCreationOutcome('mount-1'));
    resolveCreate({ success: true, id: 'orphaned-pty' });
    await expect(request.promise).resolves.toBe('orphaned-pty');

    expect(dispatched.map((action) => action.type)).toEqual([
      'terminals/addTerminal',
      createOverlayTerminalRequested.success.type,
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('fences saga-owned insertion and its correlated outcome at reducer dispatch', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'retired-at-dispatch' });
    const run = startSaga('owner', (action) => {
      if (action.type === 'terminals/addTerminal') rendererEventRecovery.dispose();
    });
    const request = createOverlayTerminalRequested('ws-1', { id: 'mount', resourceId: 'overlay' });
    run.put(request);
    await expect(request.promise).rejects.toThrow();
    expect(
      run.getTerminalsState().workspaces['ws-1']?.terminals.map['retired-at-dispatch'],
    ).toBeUndefined();
    expect(run.getTerminalsState().creationOutcomes.map.mount).not.toMatchObject({
      status: 'success',
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rejects an old-session overlay create reply before it can restore a terminal', async () => {
    let finish!: (value: { success: boolean; id: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { channel, dispatched, task, getTerminalsState } = startSaga();
    const request = createOverlayTerminalRequested('ws-1');
    const result = request.promise.then(
      () => 'accepted',
      () => 'rejected',
    );
    channel.put(request);
    await settle();
    rendererEventRecovery.dispose();
    finish({ success: true, id: 'obsolete-terminal' });
    expect(await result).toBe('rejected');
    expect(
      getTerminalsState().workspaces['ws-1']?.terminals.map['obsolete-terminal'],
    ).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(
      dispatched.some((action) => action.type === createOverlayTerminalRequested.success.type),
    ).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it.each(['push', 'retire', 'replacement'])(
    'keeps original command authority across %s',
    async (change) => {
      const key = 'terminals:' + JSON.stringify(['ws-1']);
      const scope = rendererEventRecovery.attach({
        supported: true,
        isCurrent: () => true,
        request: async <T>() => ({}) as T,
        fence: async (_ids, observe) => {
          observe();
        },
        dispose: () => {},
        onRetired: () => () => {},
        onNotification: () => () => {},
      })!;
      const owner = {
        key,
        workspaceId: 'ws-1',
        eventTypes: ['terminal:exit'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      };
      scope.registerResource(owner);
      let finish!: (value: { success: boolean; id: string }) => void;
      mocks.create.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const { channel, task, getTerminalsState } = startSaga();
      const request = createOverlayTerminalRequested('ws-1');
      const result = request.promise.then(
        () => 'accepted',
        () => 'rejected',
      );
      channel.put(request);
      await settle();
      rendererEventRecovery.push(key);
      if (change !== 'push') rendererEventRecovery.captureRetirement(key)(new Error('Denied'));
      if (change === 'replacement') scope.registerResource(owner);
      finish({ success: true, id: 'created-terminal' });
      expect(await result).toBe(change !== 'push' ? 'rejected' : 'accepted');
      expect(!!getTerminalsState().workspaces['ws-1']?.terminals.map['created-terminal']).toBe(
        change === 'push',
      );
      expect(mocks.create).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    },
  );

  it('allows the root overlay to create without a workspace membership row', async () => {
    mocks.create.mockResolvedValue({ success: true, id: 'daemon-root-pty' });
    const { channel, task } = startSaga();
    const request = createOverlayTerminalRequested(ROOT_WORKSPACE_ID);

    channel.put(request);
    await expect(request.promise).resolves.toBe('daemon-root-pty');

    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: ROOT_WORKSPACE_ID,
      cols: 80,
      rows: 24,
    });
    task.cancel();
    await task.toPromise();
  });

  it('rejects a collaborator overlay create before terminal.create', async () => {
    const { channel, dispatched, task } = startSaga('collaborator');
    const request = createOverlayTerminalRequested('ws-1');

    channel.put(request);
    await expect(request.promise).rejects.toThrow();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched.map((action) => action.type)).toEqual([
      createOverlayTerminalRequested.failure.type,
    ]);
    task.cancel();
    await task.toPromise();
  });

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
