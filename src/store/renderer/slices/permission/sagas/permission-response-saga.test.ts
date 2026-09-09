import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ respondPermission: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { agents: { respondPermission: mocks.respondPermission } },
}));

import {
  approvePermission,
  cancelPermission,
  denyPermission,
  initialState,
  permissionReducer,
  permissionRequestReceived,
  selectPermissionOption,
  type PermissionRequest,
} from '../permission-slice';
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
    title: 'Run command',
    description: 'desc',
    options,
    timestamp: 1,
  };
}

function harness(requests: PermissionRequest[] = [request('request-1')]) {
  const channel = stdChannel();
  let permission = requests.reduce(
    (state, item) => permissionReducer(state, permissionRequestReceived(item)),
    initialState,
  );
  const dispatch = vi.fn((action) => {
    permission = permissionReducer(permission, action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ permission }) },
    permissionResponseSaga,
  );
  return {
    channel,
    dispatch,
    task,
    hasRequest: (requestId: string) => getItem(permission.requests, requestId) !== undefined,
  };
}

describe('permissionResponseSaga', () => {
  afterEach(() => vi.clearAllMocks());

  it('maps all four outcomes exactly and runs takeEvery workers concurrently', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mocks.respondPermission.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const run = harness();
    run.channel.put(approvePermission('request-1'));
    run.channel.put(denyPermission('request-1'));
    run.channel.put(cancelPermission('request-1'));
    run.channel.put(selectPermissionOption('request-1', 'allow-always'));
    await settle();

    expect(mocks.respondPermission.mock.calls).toEqual([
      ['request-1', { outcome: 'selected', optionId: 'allow-custom' }],
      ['request-1', { outcome: 'selected', optionId: 'deny-custom' }],
      ['request-1', { outcome: 'cancelled' }],
      ['request-1', { outcome: 'selected', optionId: 'allow-always' }],
    ]);
    expect(resolvers).toHaveLength(4);
    expect(run.hasRequest('request-1')).toBe(true);
    for (const resolve of resolvers) resolve({ success: true, resolved: true });
    await settle();
    expect(run.hasRequest('request-1')).toBe(false);
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
      ['approve-first', { outcome: 'selected', optionId: 'first-destructive' }],
      ['approve-empty', { outcome: 'selected', optionId: 'allow_once' }],
      ['deny-last', { outcome: 'selected', optionId: 'last-safe' }],
      ['deny-empty', { outcome: 'selected', optionId: 'reject_once' }],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes only after a successful transport, including resolved false', async () => {
    mocks.respondPermission.mockResolvedValue({ success: true, resolved: false });
    const run = harness();
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    await settle();

    expect(mocks.respondPermission).toHaveBeenCalledWith('request-1', {
      outcome: 'selected',
      optionId: 'allow-custom',
    });
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
    expect(run.dispatch).not.toHaveBeenCalled();
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
