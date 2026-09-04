import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  isElectron: vi.fn(() => true),
  on: vi.fn(),
  offById: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()),
  callbacks: {} as Record<string, (data: any) => void>,
}));
vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigate }));
vi.mock('svelte-sonner', () => ({ toast: { warning: mocks.warning, error: mocks.error } }));

import { agentEventsIpcSaga } from './agent-events-ipc-saga';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('agentEventsIpcSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isElectron.mockReturnValue(true);
    mocks.callbacks = {};
    mocks.on.mockImplementation((channel, callback) => {
      mocks.callbacks[channel] = callback;
      return `id:${channel}`;
    });
    Object.assign(window, { electronAPI: { on: mocks.on, offById: mocks.offById } });
  });
  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('shows exact auth and plan toasts and routes the terminal action', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, agentEventsIpcSaga);
    mocks.callbacks['agent:auth-required']({
      workspaceId: 'ws-1',
      agentId: 'a-1',
      isRemote: true,
      host: 'host',
      message: 'Sign in',
    });
    mocks.callbacks['agent:plan-required']({
      workspaceId: 'ws-1',
      agentId: 'a-1',
      message: 'Upgrade',
      helpUrl: 'https://help',
    });
    await settle();

    const authOptions = mocks.warning.mock.calls[0][1];
    expect(mocks.warning.mock.calls[0]).toEqual([
      'Agent Authentication Required',
      {
        description: 'Sign in',
        duration: 15_000,
        action: { label: 'Open Terminal', onClick: authOptions.action.onClick },
      },
    ]);
    expect(mocks.error.mock.calls[0]).toEqual([
      'Intent: Plan Upgrade Required',
      {
        description: 'Upgrade',
        duration: 20_000,
      },
    ]);
    authOptions.action.onClick();
    expect(mocks.navigate.mock.calls).toEqual([['/workspace/ws-1?panel=terminal']]);
    task.cancel();
    await task.toPromise();
  });

  it('does not route an auth toast without a workspace and swallows toast failures', async () => {
    mocks.warning.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, agentEventsIpcSaga);
    mocks.callbacks['agent:auth-required']({ isRemote: false, message: 'Sign in' });
    mocks.callbacks['agent:plan-required']({ message: 'Upgrade' });
    await settle();
    expect(mocks.navigate.mock.calls).toEqual([]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
    await task.toPromise();
  });

  it('ignores missing event payloads', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, agentEventsIpcSaga);
    mocks.callbacks['agent:auth-required'](undefined);
    mocks.callbacks['agent:plan-required'](undefined);
    await settle();
    expect(mocks.warning.mock.calls).toEqual([]);
    expect(mocks.error.mock.calls).toEqual([]);
    task.cancel();
    await task.toPromise();
  });

  it('registers all channels and unregisters them on cancellation', async () => {
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, agentEventsIpcSaga);
    expect(mocks.on.mock.calls.map(([channel]) => channel)).toEqual([
      'agent:auth-required',
      'agent:plan-required',
    ]);
    task.cancel();
    await task.toPromise();
    expect(mocks.offById.mock.calls).toEqual([
      ['agent:auth-required', 'id:agent:auth-required'],
      ['agent:plan-required', 'id:agent:plan-required'],
    ]);
  });

  it('is a no-op outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await runSaga({ dispatch: vi.fn(), getState: () => ({}) }, agentEventsIpcSaga).toPromise();
    expect(mocks.on.mock.calls).toEqual([]);
  });
});
