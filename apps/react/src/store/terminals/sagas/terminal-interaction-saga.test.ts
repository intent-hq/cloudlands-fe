import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { terminalInteractionSaga } from './terminal-interaction-saga';
import { selectTerminalContext, selectTerminalAuthorityKey } from '../terminals-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  getTerminalOperations,
  getTerminalRead,
  getTerminalsForWorkspace,
} from '../../../../../../src/store/renderer/slices/terminals/terminals-projections';
import {
  terminalViewRefreshRequested,
  terminalOperationRequested,
  terminalViewRetired,
  terminalViewOpened,
} from '../../../../../../src/store/renderer/slices/terminals/terminals-slice';
import type { Workspace } from '$shared/types';
const transport = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
vi.mock('@/features/backend/backend-transport', () => ({ backend: transport }));
const ws = 'terminal-workspace';
let dispose: () => void;
let stop: () => void;
let ids: string[];
beforeEach(() => {
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/workspace' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(terminalViewOpened(ws, selectTerminalContext.select(store.state, ws)!, 'view-1'));
  ids = [];
  transport.backendRequest.mockReset().mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'terminal.create') {
      ids.push('pty-1');
      return { terminalId: 'pty-1' };
    }
    if (method === 'terminal.list')
      return { terminals: ids.map((id) => ({ id, name: 'Terminal' })), daemonBootId: 'boot' };
    if (method === 'terminal.kill') {
      ids = [];
      return { ok: true };
    }
    throw new Error(method);
  });
  stop = store.runSaga(terminalInteractionSaga);
});
afterEach(() => {
  stop();
  dispose();
});
function request(id: string, kind: 'create' | 'close' = 'create', terminalId?: string) {
  const context = selectTerminalContext.select(store.state, ws);
  expect(context).toBeTruthy();
  store.dispatch(
    terminalOperationRequested({
      id,
      workspaceId: ws,
      kind,
      terminalId,
      root: '/owned/workspace',
      context: context!,
      viewId: getTerminalRead(store.state, ws)!.viewId,
      authorityKey: selectTerminalAuthorityKey.select(store.state, ws)!,
      status: 'queued',
    }),
  );
}
it('deduplicates rapid explicit create, lists genuine ID and closes only the listed PTY', async () => {
  request('first');
  request('second');
  await vi.waitFor(() => expect(getTerminalsForWorkspace(store.state, ws)).toHaveLength(1));
  expect(transport.backendRequest.mock.calls.filter(([m]) => m === 'terminal.create')).toHaveLength(
    1,
  );
  request('close', 'close', 'pty-1');
  await vi.waitFor(() => expect(getTerminalsForWorkspace(store.state, ws)).toHaveLength(0));
  expect(transport.backendRequest.mock.calls.filter(([m]) => m === 'terminal.kill')).toHaveLength(
    1,
  );
});
it('keeps uncertain creation owned through departure and rejects a new create', async () => {
  let reject!: (error: Error) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options?.onDispatch?.();
    return new Promise((_r, j) => {
      reject = j;
    });
  });
  request('first');
  const context = selectTerminalContext.select(store.state, ws)!;
  store.dispatch(terminalViewRetired(ws, context, 'view-1'));
  store.dispatch(workspaceUnmounted(ws));
  reject(new Error('lost acknowledgement'));
  await vi.waitFor(() => expect(getTerminalOperations(store.state, ws)[0].status).toBe('unknown'));
  store.dispatch(workspaceMounted(ws));
  store.dispatch(terminalViewOpened(ws, selectTerminalContext.select(store.state, ws)!, 'view-1'));
  request('second');
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(getTerminalsForWorkspace(store.state, ws)).toEqual([]);
});
it('does not publish a retired read or send a missing terminal close', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  store.dispatch(terminalViewRefreshRequested(ws, 'view-1'));
  store.dispatch(terminalViewRetired(ws, selectTerminalContext.select(store.state, ws)!, 'view-1'));
  resolve({ terminals: [{ id: 'late', name: 'Late' }] });
  await Promise.resolve();
  await Promise.resolve();
  expect(getTerminalsForWorkspace(store.state, ws)).toEqual([]);
  store.dispatch(terminalViewOpened(ws, selectTerminalContext.select(store.state, ws)!, 'view-1'));
  request('close', 'close', 'missing');
  await vi.waitFor(() => expect(getTerminalOperations(store.state, ws)[0].status).toBe('failed'));
  expect(transport.backendRequest.mock.calls.some(([m]) => m === 'terminal.kill')).toBe(false);
});
it('retains dispatched settlement when the saga is cancelled without replay', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementation((_method, _params, options) => {
    options?.onDispatch?.();
    return new Promise((r) => {
      resolve = r;
    });
  });
  request('first');
  stop();
  resolve({ terminalId: 'settled' });
  await vi.waitFor(() =>
    expect(getTerminalOperations(store.state, ws)[0].result?.id).toBe('settled'),
  );
  stop = store.runSaga(terminalInteractionSaga);
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
});

it('retires a close held in preflight and does not adopt a reentered view', async () => {
  ids = ['pty-1'];
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  request('close', 'close', 'pty-1');
  store.dispatch(terminalViewRetired(ws, selectTerminalContext.select(store.state, ws)!, 'view-1'));
  store.dispatch(terminalViewRefreshRequested(ws, 'view-1'));
  resolve({ terminals: [{ id: 'pty-1', name: 'Terminal' }] });
  await vi.waitFor(() => expect(getTerminalOperations(store.state, ws)[0].status).toBe('failed'));
  expect(transport.backendRequest.mock.calls.some(([m]) => m === 'terminal.kill')).toBe(false);
});
it('rejects root drift at the final transport guard before creating a PTY', async () => {
  let dispatch!: () => void;
  let reject!: (error: unknown) => void;
  transport.backendRequest.mockImplementationOnce(
    (_method, _params, options) =>
      new Promise((_r, j) => {
        reject = j;
        dispatch = options.onDispatch;
      }),
  );
  request('first');
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/different/root' } as Workspace),
  );
  try {
    dispatch();
    throw new Error('guard did not reject');
  } catch (error) {
    reject(error);
  }
  await vi.waitFor(() => expect(getTerminalOperations(store.state, ws)[0].status).toBe('failed'));
  expect(getTerminalOperations(store.state, ws)[0].result?.terminalOutcome).toBeUndefined();
});

for (const kind of ['create', 'close'] as const) {
  it.each([false, true])(
    `rejects a captured ${kind} callback after retirement, reentered=%s`,
    async (reenter) => {
      const context = selectTerminalContext.select(store.state, ws)!;
      const action = terminalOperationRequested({
        id: 'late',
        workspaceId: ws,
        context,
        viewId: 'view-1',
        authorityKey: selectTerminalAuthorityKey.select(store.state, ws)!,
        root: '/owned/workspace',
        kind,
        terminalId: kind === 'close' ? 'pty-1' : undefined,
        status: 'queued',
      });
      store.dispatch(terminalViewRetired(ws, context, 'view-1'));
      store.dispatch(workspaceUnmounted(ws));
      if (reenter) {
        store.dispatch(workspaceMounted(ws));
        store.dispatch(terminalViewOpened(ws, context, 'view-2'));
      }
      store.dispatch(action);
      await Promise.resolve();
      expect(transport.backendRequest).not.toHaveBeenCalled();
      expect(getTerminalOperations(store.state, ws)).toEqual([]);
    },
  );
}
it('keeps the replacement view read alive when an older cleanup arrives', async () => {
  const context = selectTerminalContext.select(store.state, ws)!;
  store.dispatch(terminalViewOpened(ws, context, 'view-2'));
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  store.dispatch(terminalViewRefreshRequested(ws, 'view-2'));
  store.dispatch(terminalViewRetired(ws, context, 'view-1'));
  store.dispatch(terminalViewRefreshRequested(ws, 'view-1'));
  resolve({ terminals: [{ id: 'current', name: 'Current' }] });
  await vi.waitFor(() =>
    expect(getTerminalsForWorkspace(store.state, ws).map((t) => t.id)).toEqual(['current']),
  );
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
});

it('retains a dispatched unknown Close after departure and refuses a replacement close', async () => {
  ids = ['pty-1'];
  let reject!: (error: Error) => void;
  transport.backendRequest.mockImplementation((method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'terminal.list')
      return Promise.resolve({ terminals: [{ id: 'pty-1', name: 'Terminal' }] });
    if (method === 'terminal.kill')
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    throw new Error(method);
  });
  request('closing', 'close', 'pty-1');
  await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
  const context = selectTerminalContext.select(store.state, ws)!;
  store.dispatch(terminalViewRetired(ws, context, 'view-1'));
  store.dispatch(workspaceUnmounted(ws));
  reject(new Error('Lost close acknowledgement'));
  await vi.waitFor(() => expect(getTerminalOperations(store.state, ws)[0].status).toBe('unknown'));
  store.dispatch(workspaceMounted(ws));
  store.dispatch(terminalViewOpened(ws, context, 'view-2'));
  request('replacement-close', 'close', 'pty-1');
  expect(
    transport.backendRequest.mock.calls.filter(([method]) => method === 'terminal.kill'),
  ).toHaveLength(1);
  expect(getTerminalOperations(store.state, ws)).toHaveLength(1);
  expect(getTerminalsForWorkspace(store.state, ws)).toEqual([]);
});
