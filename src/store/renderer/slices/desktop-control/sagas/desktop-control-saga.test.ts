import { workspaceBrowserClientReceived } from '../../browser-clients/browser-clients-slice';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import type { StoreAction } from '@themislib/themis/types';
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  prompt: vi.fn(),
  dismiss: vi.fn(),
  start: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (method: string, params: unknown) =>
    method === 'client.hello'
      ? Promise.resolve({ server: { capabilities: { desktopControl: 1 } } })
      : mocks.request(method, params),
}));
vi.mock('$features/desktop/renderer/desktop-notifications', () => ({
  showDesktopPrompt: mocks.prompt,
  dismissDesktopPrompt: mocks.dismiss,
  showDesktopStarted: mocks.start,
  showDesktopError: mocks.error,
}));
import { desktopControlSaga } from './desktop-control-saga';
import {
  desktopControlReducer,
  desktopReadRequested,
  desktopEventReceived,
  desktopDecisionRequested,
  desktopPermissionRequested,
} from '../desktop-control-slice';
import { desktopKey } from '../desktop-control-types';
import {
  workspaceEventsReducer,
  daemonEventsSubscribed,
  daemonEventsSubscribing,
} from '../../workspace-events/workspace-events-slice';
import { connectionStatusChanged } from '../../daemon-health/daemon-health-slice';
import { request, permission } from '$features/desktop/renderer/desktop-test-fixtures';
const tasks: Task[] = [];
function start(ready = true) {
  const channel = stdChannel();
  let state = {
    desktopControl: desktopControlReducer.initialState,
    workspaceEvents: workspaceEventsReducer(undefined, { type: 'init' }),
  };
  if (ready)
    state.workspaceEvents = workspaceEventsReducer(state.workspaceEvents, daemonEventsSubscribed());
  const dispatch = (action: StoreAction<unknown>) => {
    state = {
      desktopControl: desktopControlReducer(state.desktopControl, action),
      workspaceEvents: workspaceEventsReducer(state.workspaceEvents, action),
    };
    channel.put(action);
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, desktopControlSaga);
  tasks.push(task);
  return { dispatch, entry: () => state.desktopControl.byKey[desktopKey('workspace', 'agent')] };
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
const requested = () =>
  desktopEventReceived({ id: 'requested', type: 'desktop:permission-requested', data: request });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ state: { status: 'inactive' }, permission });
});
afterEach(() => {
  tasks.splice(0).forEach((t) => t.cancel());
});
describe('desktop consent wire lifecycle', () => {
  it.each(['allow_once', 'allow_future', 'deny'] as const)(
    'sends %s once without reporting readiness on ACK',
    async (decision) => {
      const h = start();
      h.dispatch(requested());
      await settle();
      mocks.request.mockResolvedValue({ accepted: true, requestId: 'request' });
      h.dispatch(desktopDecisionRequested('workspace', 'agent', 'request', decision));
      h.dispatch(desktopDecisionRequested('workspace', 'agent', 'request', decision));
      await settle();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('desktop.respondPermission', {
        workspaceId: 'workspace',
        requestId: 'request',
        decision,
      });
      expect(h.entry()?.state.status).toBe('pending_permission');
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );
  it.each(['allow_once', 'allow_future', 'deny'] as const)(
    'sends unassigned %s only as a consent decision, never a separate pin mutation',
    async (decision) => {
      const h = start();
      h.dispatch(
        desktopEventReceived({
          id: 'candidate',
          type: 'desktop:permission-requested',
          data: { ...request, claimsPrimary: true },
        }),
      );
      await settle();
      mocks.request.mockResolvedValue({ accepted: true, requestId: request.requestId });
      h.dispatch(desktopDecisionRequested('workspace', 'agent', request.requestId, decision));
      await settle();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('desktop.respondPermission', {
        workspaceId: 'workspace',
        requestId: request.requestId,
        decision,
      });
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );
  it('dismisses a losing claim and never replays a late Allow', async () => {
    const h = start();
    h.dispatch(
      desktopEventReceived({
        id: 'candidate',
        type: 'desktop:permission-requested',
        data: { ...request, claimsPrimary: true },
      }),
    );
    await settle();
    h.dispatch(
      desktopEventReceived({
        id: 'winner-elsewhere',
        type: 'desktop:permission-resolved',
        data: {
          workspaceId: 'workspace',
          agentId: 'agent',
          requestId: request.requestId,
          outcome: 'invalidated',
          state: { status: 'inactive' },
        },
      }),
    );
    h.dispatch(desktopDecisionRequested('workspace', 'agent', request.requestId, 'allow_future'));
    await settle();
    expect(h.entry()?.pending).toBeUndefined();
    expect(mocks.dismiss).toHaveBeenCalledWith(request.requestId);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('subscribes before reading and hydrates remembered permission without starting control', async () => {
    const h = start(false);
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue({
      state: { status: 'inactive' },
      permission: { ...permission, allowed: true },
    });
    h.dispatch(daemonEventsSubscribed());
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('desktop.getState', {
      workspaceId: 'workspace',
      agentId: 'agent',
    });
    expect(h.entry()?.permission?.allowed).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('keeps a prompt through ordinary agent turn completion and coalesces repeats', async () => {
    const h = start();
    h.dispatch(requested());
    h.dispatch({ type: 'agentSession/idle', payload: ['agent'] });
    h.dispatch(requested());
    await settle();
    expect(mocks.prompt).toHaveBeenCalledTimes(1);
    expect(h.entry()?.pending?.requestId).toBe('request');
  });
  it('notifies every actual start including remembered sessions, but not duplicate events', async () => {
    const h = start();
    for (const sessionId of ['first', 'first', 'second'])
      h.dispatch(
        desktopEventReceived({
          id: sessionId,
          type: 'desktop:session-changed',
          data: {
            workspaceId: 'workspace',
            agentId: 'agent',
            computerId: 'computer',
            computerName: permission.computerName,
            sessionId,
            status: 'active',
          },
        }),
      );
    await settle();
    expect(mocks.start.mock.calls).toEqual([
      ['first', permission.computerName],
      ['second', permission.computerName],
    ]);
  });
  it('disables future permission via the exact current computer without stopping the session', async () => {
    const h = start();
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    mocks.request.mockClear();
    mocks.request.mockResolvedValue({ permission });
    h.dispatch(desktopPermissionRequested('workspace', 'agent', 'computer', false));
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('desktop.setPermission', {
      workspaceId: 'workspace',
      agentId: 'agent',
      computerId: 'computer',
      allowed: false,
    });
    expect(mocks.request.mock.calls.some(([method]) => method === 'desktop.revoke')).toBe(false);
  });
  it('rejects stale and expired actions before sending them', async () => {
    const h = start();
    h.dispatch(desktopDecisionRequested('workspace', 'agent', 'old', 'allow_future'));
    h.dispatch(
      desktopEventReceived({
        id: 'expired',
        type: 'desktop:permission-requested',
        data: { ...request, expiresAt: '2000-01-01T00:00:00Z' },
      }),
    );
    await settle();
    h.dispatch(desktopDecisionRequested('workspace', 'agent', 'request', 'allow_once'));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
  it('clears disconnected prompts and never replays a decision', async () => {
    const h = start();
    h.dispatch(requested());
    await settle();
    h.dispatch(connectionStatusChanged('disconnected'));
    await settle();
    h.dispatch(desktopDecisionRequested('workspace', 'agent', 'request', 'allow_once'));
    await settle();
    expect(mocks.dismiss).toHaveBeenCalledWith('request');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('shows Windows readiness error without adding macOS advice', async () => {
    const h = start();
    h.dispatch(requested());
    await settle();
    h.dispatch(
      desktopEventReceived({
        id: 'failed',
        type: 'desktop:permission-resolved',
        data: {
          workspaceId: 'workspace',
          agentId: 'agent',
          requestId: 'request',
          outcome: 'failed',
          state: { status: 'inactive' },
          error: {
            code: 'desktop-os-permission-required',
            detail: 'Windows secure desktop is unavailable.',
          },
        },
      }),
    );
    await settle();
    expect(mocks.error).toHaveBeenCalledWith('Windows secure desktop is unavailable.');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('drops a pre-disconnect state reply', async () => {
    let resolve!: (value: unknown) => void;
    mocks.request.mockReturnValue(new Promise((done) => (resolve = done)));
    const h = start();
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    h.dispatch(daemonEventsSubscribing());
    resolve({ state: { status: 'inactive' }, permission, pending: request });
    await settle();
    expect(h.entry()?.pending).toBeUndefined();
    expect(mocks.prompt).not.toHaveBeenCalled();
  });
  it('reconciles an active snapshot once without duplicating its later start event', async () => {
    const h = start();
    mocks.request.mockResolvedValue({
      state: {
        status: 'active',
        sessionId: 'active-read',
        computerName: permission.computerName,
        hint: 'Release when finished',
      },
      permission: { ...permission, allowed: true },
    });
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    h.dispatch(
      desktopEventReceived({
        id: 'active-read-event',
        type: 'desktop:session-changed',
        data: {
          workspaceId: 'workspace',
          agentId: 'agent',
          computerId: 'computer',
          computerName: permission.computerName,
          sessionId: 'active-read',
          status: 'active',
        },
      }),
    );
    await settle();
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith('active-read', permission.computerName);
  });
  it('surfaces a stale decision without retrying it or saving future permission', async () => {
    const h = start();
    h.dispatch(requested());
    await settle();
    mocks.request.mockImplementation((method: string) =>
      method === 'desktop.respondPermission'
        ? Promise.reject(new Error('Request expired'))
        : Promise.resolve({ state: { status: 'inactive' }, permission }),
    );
    h.dispatch(desktopDecisionRequested('workspace', 'agent', 'request', 'allow_future'));
    await settle();
    expect(
      mocks.request.mock.calls.filter(([method]) => method === 'desktop.respondPermission'),
    ).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalledWith('Request expired');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(h.entry()?.permission?.allowed).toBe(false);
  });
  it('refreshes remembered permission when the workspace primary changes', async () => {
    const h = start();
    h.dispatch(desktopReadRequested('workspace', 'agent'));
    await settle();
    mocks.request.mockClear();
    mocks.request.mockResolvedValue({
      state: { status: 'inactive' },
      permission: { computerId: 'another', computerName: 'MacBook', allowed: false },
    });
    h.dispatch(
      workspaceBrowserClientReceived('workspace', {
        source: 'workspace',
        clientId: 'other-client',
        resolved: { clientId: 'other-client', name: 'MacBook' },
      }),
    );
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('desktop.getState', {
      workspaceId: 'workspace',
      agentId: 'agent',
    });
    expect(h.entry()?.permission?.computerId).toBe('another');
    expect(h.entry()?.permission?.allowed).toBe(false);
  });
});
