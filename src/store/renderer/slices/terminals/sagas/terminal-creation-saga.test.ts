import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { runSaga, stdChannel } from 'redux-saga';
import { fork } from 'typed-redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  dispatchWindowEvent: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/utils/window-events', () => ({ dispatchWindowEvent: mocks.dispatchWindowEvent }));

vi.mock('$lib/client', () => ({
  appClient: { terminals: { create: mocks.create, list: mocks.list } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ info: mocks.info, error: mocks.error }),
}));

import {
  clearTerminalCreationOutcome,
  createOverlayTerminalRequested,
  createPanelTerminalRequested,
  createTerminalRequested,
  loadWorkspaceTerminals,
  openFirstPanelTerminalRequested,
  openTerminalOverlay,
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
  seed: Array<{ type: string; payload?: unknown }> = [],
) {
  const channel = stdChannel();
  const dispatched: Array<{ type: string; payload?: unknown }> = [];
  let terminals = seed.reduce(terminalsReducer, terminalsReducer(undefined, { type: '@@INIT' }));
  let workspaces = createCollection('id', [{ id: 'ws-1', myRole }]);
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
          // Settled owner window: guest list received, no host joined.
          guestSessions: { ...guestSessionsInitialState, hasReceivedList: true },
          panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-1' } } },
          terminals,
          workspace: { workspaces },
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
    leaveWorkspace: () => {
      workspaces = createCollection('id', []);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (e: Error) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const seeded = (...ids: string[]) =>
  loadWorkspaceTerminals(
    'ws-1',
    ids.map((id, index) => ({ id, name: `Shell ${index + 1}` })),
  );
const types = (actions: Array<{ type: string }>) => actions.map((action) => action.type);
const openedTabs = (actions: Array<{ type: string; payload?: unknown }>) =>
  actions
    .filter((action) => action.type === 'panelLayout/openTab')
    .map((action) => {
      const payload = action.payload as {
        panelId?: string;
        tab: { terminalId: string; title: string };
      };
      return {
        panelId: payload.panelId,
        terminalId: payload.tab.terminalId,
        title: payload.tab.title,
      };
    });

describe('openFirstPanelTerminalRequested', () => {
  it('opens the first listed terminal in the focused panel without creating or listing', async () => {
    const { channel, dispatched, getTerminalsState, task } = startSaga('owner', [
      seeded('pty-a', 'pty-b'),
    ]);

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(openedTabs(dispatched)).toEqual([
      { panelId: 'panel-1', terminalId: 'pty-a', title: 'Shell 1' },
    ]);
    expect(getTerminalsState().workspaces['ws-1'].placements).toEqual({ 'pty-a': 'panel' });
    task.cancel();
    await task.toPromise();
  });

  it('targets the requested panel and closes the overlay showing that terminal', async () => {
    const { channel, dispatched, getTerminalsState, task } = startSaga('owner', [
      seeded('pty-a'),
      openTerminalOverlay('ws-1', 'pty-a'),
    ]);

    channel.put(openFirstPanelTerminalRequested('ws-1', 'panel-2'));
    await settle();

    expect(openedTabs(dispatched)).toEqual([
      { panelId: 'panel-2', terminalId: 'pty-a', title: 'Shell 1' },
    ]);
    expect(types(dispatched)).toContain('terminals/close');
    expect(getTerminalsState().workspaces['ws-1'].isOpen).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it('keeps the overlay open when it shows a different terminal', async () => {
    const { channel, dispatched, task } = startSaga('owner', [
      seeded('pty-a', 'pty-b'),
      openTerminalOverlay('ws-1', 'pty-b'),
    ]);

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(openedTabs(dispatched).map((tab) => tab.terminalId)).toEqual(['pty-a']);
    expect(types(dispatched)).not.toContain('terminals/close');
    task.cancel();
    await task.toPromise();
  });

  it('hydrates an unloaded workspace and reuses a daemon terminal instead of creating', async () => {
    mocks.list.mockResolvedValue({
      terminals: [{ id: 'daemon-pty', name: 'Setup Script' }],
      daemonBootId: 'boot-1',
    });
    const { channel, dispatched, getTerminalsState, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(types(dispatched).slice(0, 2)).toEqual([
      'terminals/loadWorkspaceTerminals',
      'panelLayout/openTab',
    ]);
    expect(openedTabs(dispatched)).toEqual([
      { panelId: 'panel-1', terminalId: 'daemon-pty', title: 'Setup Script' },
    ]);
    expect(getTerminalsState().workspaces['ws-1'].daemonBootId).toBe('boot-1');
    task.cancel();
    await task.toPromise();
  });

  it('creates and opens a terminal when the workspace has none', async () => {
    mocks.list.mockResolvedValue({ terminals: [], daemonBootId: 'boot-1' });
    mocks.create.mockResolvedValue({ success: true, id: 'new-pty' });
    const { channel, dispatched, getTerminalsState, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'ws-1',
      cols: 80,
      rows: 24,
    });
    expect(openedTabs(dispatched).map((tab) => [tab.panelId, tab.terminalId])).toEqual([
      ['panel-1', 'new-pty'],
    ]);
    expect(getTerminalsState().workspaces['ws-1'].placements).toEqual({ 'new-pty': 'panel' });
    task.cancel();
    await task.toPromise();
  });

  it('coalesces rapid activations while creating, then opens the created terminal on the next', async () => {
    mocks.list.mockResolvedValue({ terminals: [] });
    const create = deferred<{ success: true; id: string }>();
    mocks.create.mockReturnValue(create.promise);
    const { channel, dispatched, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();
    channel.put(openFirstPanelTerminalRequested('ws-1'));
    channel.put(openFirstPanelTerminalRequested('ws-1', 'panel-2'));
    create.resolve({ success: true, id: 'new-pty' });
    await settle();
    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(openedTabs(dispatched).map((tab) => tab.terminalId)).toEqual(['new-pty', 'new-pty']);
    task.cancel();
    await task.toPromise();
  });

  it.each([
    ['a refused create', () => mocks.create.mockResolvedValueOnce({ success: false, error: 'x' })],
    ['a thrown create', () => mocks.create.mockRejectedValueOnce(new Error('offline'))],
  ])('retries after %s', async (_label, failOnce) => {
    mocks.list.mockResolvedValue({ terminals: [] });
    failOnce();
    mocks.create.mockResolvedValueOnce({ success: true, id: 'retry-pty' });
    const { channel, dispatched, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();
    expect(openedTabs(dispatched)).toEqual([]);

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(openedTabs(dispatched).map((tab) => tab.terminalId)).toEqual(['retry-pty']);
    task.cancel();
    await task.toPromise();
  });

  it('does not create when the list read fails, and retries the read next time', async () => {
    mocks.list
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ terminals: [{ id: 'daemon-pty', name: '' }] });
    const { channel, dispatched, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(openedTabs(dispatched).map((tab) => tab.terminalId)).toEqual(['daemon-pty']);
    task.cancel();
    await task.toPromise();
  });

  it('drops the result when the workspace context changes during the list read', async () => {
    const list = deferred<{ terminals: unknown[] }>();
    mocks.list.mockReturnValue(list.promise);
    const { channel, dispatched, leaveWorkspace, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();
    leaveWorkspace();
    list.resolve({ terminals: [] });
    await settle();

    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('drops the open when the workspace context changes during creation', async () => {
    mocks.list.mockResolvedValue({ terminals: [] });
    const create = deferred<{ success: true; id: string }>();
    mocks.create.mockReturnValue(create.promise);
    const { channel, dispatched, leaveWorkspace, task } = startSaga();

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();
    leaveWorkspace();
    create.resolve({ success: true, id: 'late-pty' });
    await settle();

    expect(openedTabs(dispatched)).toEqual([]);
    expect(types(dispatched)).not.toContain('terminals/setPlacement');
    task.cancel();
    await task.toPromise();
  });

  it('drops a collaborator request before any terminal read or create', async () => {
    const { channel, dispatched, task } = startSaga('collaborator');

    channel.put(openFirstPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('leaves explicit panel creation creating a new terminal on every request', async () => {
    mocks.create
      .mockResolvedValueOnce({ success: true, id: 'explicit-1' })
      .mockResolvedValueOnce({ success: true, id: 'explicit-2' });
    const { channel, dispatched, task } = startSaga('owner', [seeded('pty-a')]);

    channel.put(createPanelTerminalRequested('ws-1'));
    channel.put(createPanelTerminalRequested('ws-1'));
    await settle();

    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(openedTabs(dispatched).map((tab) => tab.terminalId)).toEqual([
      'explicit-1',
      'explicit-2',
    ]);
    task.cancel();
    await task.toPromise();
  });
});
