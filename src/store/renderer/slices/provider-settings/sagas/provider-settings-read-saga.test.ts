import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import {
  initialState,
  providerSettingsReducer,
  providerSettingsSessionOpened,
  providerPathsRequested,
  providerPathSaved,
} from '../provider-settings-slice';
import { providerSettingsSaga } from './provider-settings-saga';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { settings: { get: mocks.get } } }));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

const tasks: Task[] = [];
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function harness() {
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
      getState: () => ({ providerSettings: state }),
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
