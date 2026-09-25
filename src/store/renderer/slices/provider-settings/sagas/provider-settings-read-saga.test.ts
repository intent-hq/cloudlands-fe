import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { PI_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerPathsRequested,
  providerPathSaved,
  piAdapterInstallRequested,
} from '../provider-settings-slice';
import { initialState as availabilityState } from '../../agent-availability/agent-availability-slice';
import { providerSettingsSaga } from './provider-settings-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { settings: { get: mocks.get } } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: mocks.success, error: mocks.error },
}));

const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function harness(piAvailable = false) {
  let state = initialState;
  const channel = stdChannel();
  const send = (action: Parameters<typeof providerSettingsReducer>[1]) => {
    state = providerSettingsReducer(state, action);
    channel.put(action);
  };
  const task = runSaga(
    {
      channel,
      dispatch: send,
      getState: () => ({
        providerSettings: state,
        agentAvailability: {
          ...availabilityState,
          providerStatusMap: { pi: { available: piAvailable } },
        },
      }),
    },
    providerSettingsSaga,
  );
  tasks.push(task);
  send(providerSettingsSessionOpened('panel'));
  return { send, task, state: () => state };
}
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
});

it('requests configured and resolved paths exactly and ignores a pre-save response', async () => {
  let release!: (value: unknown) => void;
  mocks.get.mockResolvedValue({ path: 'providers.paths', value: { codex: '/old' } });
  mocks.invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const h = harness();
  h.send(providerPathsRequested());
  await settle();
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('providers.paths');
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PROVIDERS_CHANNELS.GET_PATHS);
  h.send(providerPathSaved('codex', '/new'));
  release({ success: true, data: { paths: { codex: '/old' }, secondaryPaths: {} } });
  await settle();
  expect(h.state().paths.configured).toEqual({ codex: '/new' });
  expect(h.state().paths.resolved).toEqual({});
});

it('retries a failed paths read and renders the daemon-shaped resolved result', async () => {
  mocks.get
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ value: { codex: '/configured' } });
  mocks.invoke.mockResolvedValue({
    success: true,
    data: {
      paths: { codex: '/resolved' },
      secondaryPaths: { unsloth: '/unsloth' },
      npxPackages: { pi: 'pi-pkg' },
    },
  });
  const h = harness();
  h.send(providerPathsRequested());
  await settle();
  expect(h.state().pathsStatus).toBe('failure');
  h.send(providerPathsRequested());
  await settle();
  expect(h.state().pathsStatus).toBe('success');
  expect(h.state().paths).toEqual({
    configured: { codex: '/configured' },
    resolved: { codex: '/resolved' },
    secondary: { unsloth: '/unsloth' },
    npxPackages: { pi: 'pi-pkg' },
  });
});

it.each(['failure-envelope', 'rejection'] as const)(
  'publishes configured paths while discovery is pending and retains them on %s',
  async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (cause: Error) => void;
    mocks.get.mockResolvedValue({ path: 'providers.paths', value: { codex: '/configured' } });
    mocks.invoke.mockReturnValueOnce(
      new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
      }),
    );
    const h = harness();
    h.send(providerPathsRequested());
    await settle();
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('providers.paths');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PROVIDERS_CHANNELS.GET_PATHS);
    expect(h.state().paths.configured).toEqual({ codex: '/configured' });
    expect(h.state().pathsStatus).toBe('pending');
    if (outcome === 'rejection') reject(new Error('discovery unavailable'));
    else resolve({ success: false, error: 'discovery unavailable' });
    await settle();
    expect(h.state().pathsStatus).toBe('failure');
    expect(h.state().paths.configured).toEqual({ codex: '/configured' });
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: { paths: { codex: '/resolved' }, secondaryPaths: {} },
    });
    h.send(providerPathsRequested());
    await settle();
    expect(h.state().pathsStatus).toBe('success');
    expect(h.state().paths.configured).toEqual({ codex: '/configured' });
    expect(h.state().paths.resolved).toEqual({ codex: '/resolved' });
  },
);

it('checks an available Pi adapter, installs it and completes only after checking the result', async () => {
  let release!: (value: boolean) => void;
  mocks.invoke
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce({ success: true })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
  const h = harness(true);
  await settle();
  expect(h.state().piAdapter.installed).toBe(false);
  h.send(piAdapterInstallRequested({ id: 'install', sessionId: 'panel' }));
  await settle();
  expect(mocks.invoke.mock.calls).toEqual([
    [PI_CHANNELS.CHECK_MCP_ADAPTER],
    [PI_CHANNELS.INSTALL_MCP_ADAPTER],
    [PI_CHANNELS.CHECK_MCP_ADAPTER],
  ]);
  expect(getItem(h.state().requests, 'install')?.status).toBe('pending');
  release(true);
  await settle();
  expect(h.state().piAdapter.installed).toBe(true);
  expect(getItem(h.state().requests, 'install')?.status).toBe('success');
});

it('does not let an older adapter check overwrite a completed installation', async () => {
  let release!: (value: boolean) => void;
  mocks.invoke
    .mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    )
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce(true);
  const h = harness(true);
  h.send(piAdapterInstallRequested({ id: 'install', sessionId: 'panel' }));
  await settle();
  expect(h.state().piAdapter.installed).toBe(true);
  expect(getItem(h.state().requests, 'install')?.status).toBe('success');
  release(false);
  await settle();
  expect(h.state().piAdapter.installed).toBe(true);
});

it('settles a negative adapter install result and leaves the next retry usable', async () => {
  mocks.invoke
    .mockResolvedValueOnce({ success: false, error: 'unavailable' })
    .mockResolvedValueOnce({ success: true })
    .mockResolvedValueOnce(true);
  const h = harness();
  h.send(piAdapterInstallRequested({ id: 'failed', sessionId: 'panel' }));
  await settle();
  expect(getItem(h.state().requests, 'failed')?.status).toBe('failure');
  h.send(piAdapterInstallRequested({ id: 'retry', sessionId: 'panel' }));
  await settle();
  expect(getItem(h.state().requests, 'retry')?.status).toBe('success');
});

it.each(['failure-envelope', 'rejection'] as const)(
  'preserves Pi install error details from %s in the failure notification',
  async (outcome) => {
    const detail = 'npm could not write the adapter installation directory';
    if (outcome === 'rejection') mocks.invoke.mockRejectedValueOnce(new Error(detail));
    else mocks.invoke.mockResolvedValueOnce({ success: false, error: detail });
    const h = harness();
    h.send(piAdapterInstallRequested({ id: 'failed', sessionId: 'panel' }));
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
        description: detail,
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PI_CHANNELS.INSTALL_MCP_ADAPTER);
    expect(getItem(h.state().requests, 'failed')?.status).toBe('failure');
    expect(mocks.success).not.toHaveBeenCalled();
  },
);

it('cancels in-flight and queued adapter requests when the owner stops', async () => {
  mocks.invoke.mockImplementation(() => new Promise(() => {}));
  const h = harness();
  h.send(piAdapterInstallRequested({ id: 'one', sessionId: 'panel' }));
  h.send(piAdapterInstallRequested({ id: 'two', sessionId: 'panel' }));
  h.task.cancel();
  await h.task.toPromise();
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(PI_CHANNELS.INSTALL_MCP_ADAPTER);
  expect(getItem(h.state().requests, 'one')?.status).toBe('cancelled');
  expect(getItem(h.state().requests, 'two')?.status).toBe('cancelled');
});
