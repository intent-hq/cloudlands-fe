import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ backendRequest: vi.fn(), invoke: vi.fn() }));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.backendRequest,
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  BackendError: class BackendError extends Error {
    constructor(payload: { code: string; message: string }) {
      super(payload.message);
      this.code = payload.code;
    }
    code: string;
  },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  const { LiveTerminalsClient } = await import('$lib/client/live/live-terminals-client');
  return {
    appClient: { settings: new LiveSettingsClient(), terminals: new LiveTerminalsClient() },
  };
});

import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  initializeRtkSettings,
  installRtkRequested,
  rtkSettingLoaded,
  rtkUpdateSucceeded,
  updateRtkEnabledRequested,
} from '$store/renderer/slices/host-requirements/host-requirements-slice';
import { hostRequirementsSaga } from '$store/renderer/slices/host-requirements/sagas/host-requirements-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('RtkSettings mock-BE contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends exact settings and terminal requests and handles protocol responses', async () => {
    mocks.invoke.mockResolvedValue({ success: true, data: { available: true } });
    mocks.backendRequest.mockImplementation(async (method: string) => {
      if (method === 'settings.get') {
        return {
          path: 'rtk.enabled',
          value: false,
          definition: { path: 'rtk.enabled', type: 'boolean', scope: 'user' },
        };
      }
      if (method === 'settings.update') {
        return { applied: [{ path: 'rtk.enabled', value: true }], revision: 2 };
      }
      if (method === 'terminal.create') return { terminalId: 'term-rtk' };
      throw new Error(`Unexpected method: ${method}`);
    });
    const channel = stdChannel();
    const dispatched: unknown[] = [];
    const task = runSaga(
      { channel, dispatch: (action) => dispatched.push(action) },
      hostRequirementsSaga,
    );

    channel.put(initializeRtkSettings());
    await settle();
    channel.put(updateRtkEnabledRequested(true));
    await settle();
    channel.put(installRtkRequested());
    await settle();

    expect(mocks.backendRequest.mock.calls).toEqual([
      ['settings.get', { path: 'rtk.enabled' }],
      ['settings.update', { changes: [{ path: 'rtk.enabled', value: true }] }],
      [
        'terminal.create',
        {
          workspaceId: ROOT_WORKSPACE_ID,
          cols: 80,
          rows: 24,
          command: 'brew install rtk',
        },
      ],
    ]);
    expect(dispatched).toContainEqual(rtkSettingLoaded(false));
    expect(dispatched).toContainEqual(rtkUpdateSucceeded(true));
    task.cancel();
    await task.toPromise();
  });
});
