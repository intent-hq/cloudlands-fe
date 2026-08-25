import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({ respondPermission: vi.fn() }));
vi.mock('$lib/client', () => ({
  appClient: { agents: { respondPermission: mocks.respondPermission } },
}));

import { initialState, permissionReducer, permissionRequestReceived, selectPermissionOption, type PermissionRequest } from '../permission-slice';
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
  const dispatch = vi.fn((action) => { permission = permissionReducer(permission, action); });
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

  it('removes only after a successful transport, including resolved false', async () => {
    mocks.respondPermission.mockResolvedValue({ success: true, resolved: false });
    const run = harness();
    run.channel.put(selectPermissionOption('request-1', 'allow-custom'));
    await settle();

    expect(mocks.respondPermission).toHaveBeenCalledWith(
      'request-1',
      { outcome: 'selected', optionId: 'allow-custom' },
    );
    expect(run.hasRequest('request-1')).toBe(false);
    expect(run.dispatch.mock.calls.filter(
      ([action]) => action.type === 'permission/removePermissionRequest',
    )).toHaveLength(1);
    run.task.cancel();
    await run.task.toPromise();
  });
});