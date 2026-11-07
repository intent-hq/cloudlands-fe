import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const ui = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(async () => true),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: ui }));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: ui.confirm }));
import {
  BackendError,
  installMockBackend,
  resetMockBackend,
} from '../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import { E2B_PROVIDER, E2B_SANDBOXES } from '../../test/cloud-machines-preview';
import { cloudMachinesSaga } from './cloud-machines-saga';
import {
  CLOUD_CONFIGURE_KEY,
  CLOUD_REMOVE_KEY,
  CLOUD_VALIDATE_KEY,
  cloudMachineDeleteRequested,
  cloudMachinePauseRequested,
  cloudMachinesConfigureRequested,
  cloudMachinesLoaded,
  cloudMachinesRemoveRequested,
} from './cloud-machines-slice';

const SECRET = 'e2b_sk_live_do-not-store-me';
let task: Task;
let channel: ReturnType<typeof stdChannel>;

function start() {
  channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    cloudMachinesSaga,
  );
}

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

async function settle() {
  await vi.waitFor(() => expect(Object.keys(store.state.cloudMachines.pending)).toEqual([]));
}

let current: ReturnType<typeof installMockBackend> | null = null;
const requests = () => current?.requests ?? [];

function backend(capabilities: Record<string, unknown> = { remoteMachines: 1, cloudMachines: 1 }) {
  const mock = installMockBackend();
  current = mock;
  mock.onRequest('client.hello', () => ({ server: { capabilities } }));
  mock.onRequest('cloudMachines.list', () => ({
    providers: [E2B_PROVIDER, { id: 'other', state: 'ready', configuredAt: 'x' }],
    // A row without `cloud` is not a sandbox and is dropped.
    machines: [...E2B_SANDBOXES, { ...E2B_SANDBOXES[0], id: 'plain', cloud: undefined }],
  }));
  return mock;
}

function seedLoaded() {
  store.dispatch(
    cloudMachinesLoaded({
      supported: true,
      providers: [E2B_PROVIDER],
      machines: E2B_SANDBOXES,
      readAt: 1,
    }),
  );
}

const remoteLoaded = remoteMachinesLoaded({
  supported: true,
  machines: [],
  localFingerprint: null,
  executorBackends: null,
});

beforeEach(() => {
  store.init();
  store.dispatch(backendReconnected());
  store.dispatch(setLabsRemoteAgentsEnabled(true));
  ui.confirm.mockResolvedValue(true);
});

afterEach(() => {
  task?.cancel();
  resetMockBackend();
  vi.clearAllMocks();
});

describe('cloud machines saga — refresh', () => {
  it('loads the E2B provider and sandbox rows after remote machines load', async () => {
    backend();
    start();
    dispatch(remoteLoaded);
    await vi.waitFor(() => expect(store.state.cloudMachines.loaded).toBe(true));
    expect(Object.keys(store.state.cloudMachines.providers)).toEqual(['e2b']);
    expect(Object.keys(store.state.cloudMachines.machines)).toEqual(['sb-1', 'sb-2', 'sb-3']);
  });

  it.each([
    { remoteMachines: 1 },
    { remoteMachines: 1, cloudMachines: true },
    { cloudMachines: 1 },
  ])('stays unsupported and never lists for %o', async (capabilities) => {
    backend(capabilities);
    start();
    dispatch(
      remoteMachinesLoaded({
        supported: capabilities.remoteMachines === 1,
        machines: [],
        localFingerprint: null,
        executorBackends: null,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.state.cloudMachines.supported).toBe(false);
    expect(requests().some((r) => r.method === 'cloudMachines.list')).toBe(false);
  });
});

describe('cloud machines saga — configure', () => {
  it('sends the key once and never keeps it in state', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.configure', () => ({ provider: E2B_PROVIDER }));
    start();
    dispatch(
      cloudMachinesConfigureRequested({
        apiKey: SECRET,
        size: '8x16',
        idlePauseMinutes: 15,
        pausedDeleteDays: 3,
      }),
    );
    await settle();
    const request = requests().find((r) => r.method === 'cloudMachines.configure');
    expect(request?.params).toEqual({
      provider: 'e2b',
      apiKey: SECRET,
      size: '8x16',
      idlePauseMinutes: 15,
      pausedDeleteDays: 3,
    });
    expect(store.state.cloudMachines.providers.e2b).toEqual(E2B_PROVIDER);
    expect(JSON.stringify(store.state)).not.toContain(SECRET);
    expect(ui.success).toHaveBeenCalled();
  });

  it('tests with validateOnly without saving the provider', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.configure', () => ({ provider: E2B_PROVIDER }));
    start();
    dispatch(cloudMachinesConfigureRequested({ apiKey: SECRET, size: '4x8' }, true));
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'e2b',
      apiKey: SECRET,
      size: '4x8',
      validateOnly: true,
    });
    expect(store.state.cloudMachines.validated).toEqual(E2B_PROVIDER);
    expect(store.state.cloudMachines.providers).toEqual({});
    expect(ui.success).not.toHaveBeenCalled();
  });

  it('keeps a rejected key as a typed failure on the operation', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.configure', () => {
      throw new BackendError({
        code: 'RPC_ERROR',
        rpcCode: -32602,
        message: 'E2B rejected the API key',
        data: {
          code: 'cloud-machine-unavailable',
          provider: 'e2b',
          reason: 'key-rejected',
          retryable: false,
        },
      });
    });
    start();
    dispatch(cloudMachinesConfigureRequested({ apiKey: SECRET }, true));
    await settle();
    expect(store.state.cloudMachines.failures[CLOUD_VALIDATE_KEY]?.cloud).toEqual({
      code: 'cloud-machine-unavailable',
      reason: 'key-rejected',
      retryable: false,
    });
    expect(store.state.cloudMachines.failures[CLOUD_CONFIGURE_KEY]).toBeUndefined();
    expect(JSON.stringify(store.state)).not.toContain(SECRET);
  });

  it('marks a non-owner refusal as forbidden', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.configure', () => {
      throw new BackendError({ code: 'RPC_ERROR', rpcCode: -32003, message: 'forbidden' });
    });
    start();
    dispatch(cloudMachinesConfigureRequested({ apiKey: SECRET }));
    await settle();
    expect(store.state.cloudMachines.failures[CLOUD_CONFIGURE_KEY]?.forbidden).toBe(true);
  });
});

describe('cloud machines saga — sandboxes and removal', () => {
  it('pauses a sandbox and stores the returned row', async () => {
    const mock = backend();
    const paused = {
      ...E2B_SANDBOXES[0]!,
      cloud: { ...E2B_SANDBOXES[0]!.cloud!, state: 'paused' },
    };
    mock.onRequest('cloudMachines.pause', () => ({ machine: paused }));
    seedLoaded();
    start();
    dispatch(cloudMachinePauseRequested('sb-1'));
    await settle();
    expect(store.state.cloudMachines.machines['sb-1']?.cloud?.state).toBe('paused');
  });

  it('records machine-in-use from pause as a busy sandbox', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.pause', () => {
      throw new BackendError({
        code: 'RPC_ERROR',
        rpcCode: -32602,
        message: 'busy',
        data: { code: 'machine-in-use', runningAgents: 1 },
      });
    });
    seedLoaded();
    start();
    dispatch(cloudMachinePauseRequested('sb-1'));
    await settle();
    expect(store.state.cloudMachines.failures['sb-1']?.inUse).toBe(true);
  });

  it('deletes a sandbox after confirmation and warns about unconfirmed stops', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.kill', () => ({ ok: true, unconfirmedStops: ['agent-sb-2'] }));
    seedLoaded();
    start();
    dispatch(cloudMachineDeleteRequested('sb-2'));
    await vi.waitFor(() => expect(store.state.cloudMachines.machines['sb-2']).toBeUndefined());
    expect(requests().at(-1)?.params).toEqual({ machineId: 'sb-2' });
    expect(ui.warning).toHaveBeenCalled();
  });

  it('does nothing when the delete is not confirmed', async () => {
    backend();
    ui.confirm.mockResolvedValueOnce(false);
    seedLoaded();
    start();
    dispatch(cloudMachineDeleteRequested('sb-2'));
    await vi.waitFor(() => expect(ui.confirm).toHaveBeenCalled());
    expect(requests().some((r) => r.method === 'cloudMachines.kill')).toBe(false);
    expect(store.state.cloudMachines.machines['sb-2']).toBeDefined();
  });

  it('removes E2B with stopAgents while sandboxes are live', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.remove', () => ({ ok: true, unconfirmedStops: [] }));
    seedLoaded();
    start();
    dispatch(cloudMachinesRemoveRequested());
    await vi.waitFor(() => expect(store.state.cloudMachines.providers).toEqual({}));
    expect(requests().at(-1)?.params).toEqual({ provider: 'e2b', stopAgents: true });
    expect(store.state.cloudMachines.machines).toEqual({});
    expect(store.state.cloudMachines.pending[CLOUD_REMOVE_KEY]).toBeUndefined();
  });
});
