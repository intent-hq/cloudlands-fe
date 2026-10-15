import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ respondPermission: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { agents: { respondPermission: mocks.respondPermission } },
}));

import {
  approvePermission,
  cancelPermission,
  denyPermission,
  initialState,
  permissionScopeChanged,
  permissionReducer,
  permissionRequestReceived,
  selectPermissionOption,
  type PermissionRequest,
} from '../permission-slice';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { permissionResponseSaga } from './permission-response-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function request(
  requestId: string,
  options: PermissionRequest['options'] = [
    { id: 'allow-custom', label: 'Allow', destructive: false },
    { id: 'deny-custom', label: 'Deny', destructive: true },
  ],
): PermissionRequest {
  return {
    requestId,
    sessionId: 'agent-1',
    workspaceId: 'ws-1',
    title: 'Run command',
    description: 'desc',
    options,
    timestamp: 1,
  };
}

function harness(requests: PermissionRequest[] = [request('request-1')]) {
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  let permission = requests.reduce(
    (state, item) => permissionReducer(state, permissionRequestReceived(item)),
    initialState,
  );
  const dispatch = vi.fn((action) => {
    permission = permissionReducer(permission, action);
    for (const listener of listeners) listener();
  });
  const reduxStore = {
    getState: () =>
      withLegacyPrincipal({
        permission,
        agentSessions: { byAgentId: {} },
        workspace: { workspaces: createCollection('id', [{ id: 'ws-1', myRole: 'owner' }]) },
      }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: reduxStore.getState,
      context: { reduxStore },
    },
    permissionResponseSaga,
  );
  return {
    channel,
    dispatch,
    task,
    hasRequest: (requestId: string) => getItem(permission.requests, requestId) !== undefined,
    response: (requestId: string) => getItem(permission.responses, requestId),
  };
}

describe('permissionResponseSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('maps all four outcomes exactly and responds concurrently to distinct requests', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.respondPermission.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const run = harness([
      request('approve'),
      request('deny'),
      request('cancel'),
      request('option', [{ id: 'allow-custom', label: 'Allow' }]),
    ]);
    run.channel.put(approvePermission('approve'));
    run.channel.put(denyPermission('deny'));
    run.channel.put(cancelPermission('cancel'));
    run.channel.put(selectPermissionOption('option', 'allow-custom'));
    await settle();
    expect(mocks.respondPermission.mock.calls).toEqual([
      ['approve', { outcome: 'selected', optionId: 'allow-custom' }, 'ws-1'],
      ['deny', { outcome: 'selected', optionId: 'deny-custom' }, 'ws-1'],
      ['cancel', { outcome: 'cancelled' }, 'ws-1'],
      ['option', { outcome: 'selected', optionId: 'allow-custom' }, 'ws-1'],
    ]);
    expect(resolvers).toHaveLength(4);
    for (const id of ['approve', 'deny', 'cancel', 'option'])
      expect(run.response(id)?.status).toBe('submitting');
    for (const resolve of resolvers) resolve({ success: true, resolved: true });
    await settle();
    for (const id of ['approve', 'deny', 'cancel', 'option']) {
      expect(run.hasRequest(id)).toBe(false);
      expect(run.response(id)).toBeUndefined();
    }
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces repeated decisions for one pending request and retains visible failure for retry', async () => {
    let resolve!: (value: unknown) => void;
    mocks.respondPermission.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const run = harness();
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    run.channel.put(denyPermission('request-1'));
    await settle();
    expect(mocks.respondPermission).toHaveBeenCalledTimes(1);
    resolve({ success: false, error: 'offline' });
    await settle();
    expect(run.response('request-1')).toMatchObject({
      status: 'failed',
      error: 'offline',
      attempt: 1,
    });
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    await settle();
    expect(mocks.respondPermission).toHaveBeenCalledTimes(2);
    expect(run.response('request-1')).toMatchObject({ status: 'submitting', attempt: 2 });
    resolve({ success: true, resolved: true });
    await settle();
    expect(run.hasRequest('request-1')).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('rejects stale rendered authority and unknown options before transport', async () => {
    const run = harness();
    run.channel.put(selectPermissionOption('request-1', 'allow-custom', 'retired-authority'));
    run.channel.put(selectPermissionOption('request-1', 'not-an-option'));
    await settle();
    expect(mocks.respondPermission).not.toHaveBeenCalled();
    expect(run.response('request-1')).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not remove a replacement prompt when a retired response completes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.respondPermission.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const run = harness();
    run.dispatch(permissionScopeChanged('old-principal'));
    run.dispatch(permissionRequestReceived(request('request-1')));
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    await settle();
    run.dispatch(permissionScopeChanged('new-principal'));
    run.dispatch(permissionRequestReceived(request('request-1')));
    resolve({ success: true, resolved: true });
    await settle();
    expect(run.hasRequest('request-1')).toBe(true);
    expect(run.response('request-1')).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('uses the exact approve and deny fallback rules', async () => {
    mocks.respondPermission.mockResolvedValue({ success: false, error: 'retain' });
    const run = harness([
      request('approve-first', [
        { id: 'first-destructive', label: 'First', destructive: true },
        { id: 'second-destructive', label: 'Second', destructive: true },
      ]),
      request('approve-empty', []),
      request('deny-last', [
        { id: 'first-safe', label: 'First', destructive: false },
        { id: 'last-safe', label: 'Last', destructive: false },
      ]),
      request('deny-empty', []),
    ]);

    run.channel.put(approvePermission('approve-first'));
    run.channel.put(approvePermission('approve-empty'));
    run.channel.put(denyPermission('deny-last'));
    run.channel.put(denyPermission('deny-empty'));
    await settle();

    expect(mocks.respondPermission.mock.calls).toEqual([
      ['approve-first', { outcome: 'selected', optionId: 'first-destructive' }, 'ws-1'],
      ['approve-empty', { outcome: 'selected', optionId: 'allow_once' }, 'ws-1'],
      ['deny-last', { outcome: 'selected', optionId: 'last-safe' }, 'ws-1'],
      ['deny-empty', { outcome: 'selected', optionId: 'reject_once' }, 'ws-1'],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes only after a successful transport, including resolved false', async () => {
    mocks.respondPermission.mockResolvedValue({ success: true, resolved: false });
    const run = harness();
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    await settle();

    expect(mocks.respondPermission).toHaveBeenCalledWith(
      'request-1',
      {
        outcome: 'selected',
        optionId: 'allow-custom',
      },
      'ws-1',
    );
    expect(run.hasRequest('request-1')).toBe(false);
    expect(
      run.dispatch.mock.calls.filter(
        ([action]) => action.type === 'permission/removePermissionRequest',
      ),
    ).toHaveLength(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retains requests on unsuccessful and thrown transports', async () => {
    mocks.respondPermission
      .mockResolvedValueOnce({ success: false, error: 'offline' })
      .mockRejectedValueOnce(new Error('transport threw'));
    const run = harness([request('unsuccessful'), request('thrown')]);
    run.channel.put(cancelPermission('unsuccessful'));
    run.channel.put(selectPermissionOption('thrown', 'deny-custom'));
    await settle();

    expect(run.hasRequest('unsuccessful')).toBe(true);
    expect(run.hasRequest('thrown')).toBe(true);
    expect(
      run.dispatch.mock.calls.filter(
        ([action]) => action.type === 'permission/removePermissionRequest',
      ),
    ).toHaveLength(0);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('treats missing approve and deny requests as no-ops', async () => {
    const run = harness([]);
    run.channel.put(approvePermission('missing-approve'));
    run.channel.put(denyPermission('missing-deny'));
    await settle();

    expect(mocks.respondPermission).not.toHaveBeenCalled();
    expect(
      run.dispatch.mock.calls.filter(([action]) => action.type !== 'permission/scopeChanged'),
    ).toHaveLength(0);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retains the request when an in-flight response is cancelled', async () => {
    let resolveResponse!: (value: unknown) => void;
    mocks.respondPermission.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const run = harness();
    run.channel.put(cancelPermission('request-1'));
    await vi.waitFor(() => expect(mocks.respondPermission).toHaveBeenCalledTimes(1));
    run.task.cancel();
    await run.task.toPromise();
    resolveResponse({ success: true, resolved: true });
    await settle();

    expect(run.hasRequest('request-1')).toBe(true);
    expect(
      run.dispatch.mock.calls.filter(
        ([action]) => action.type === 'permission/removePermissionRequest',
      ),
    ).toHaveLength(0);
  });
});
