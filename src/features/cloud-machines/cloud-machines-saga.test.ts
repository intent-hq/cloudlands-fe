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
import {
  E2B_PROVIDER,
  E2B_SANDBOXES,
  NORTHFLANK_ENTRY,
  NORTHFLANK_SANDBOXES,
  TEAM_ENTRY,
  TEAM_SANDBOXES,
} from '../../test/cloud-machines-preview';
import { cloudMachinesSaga } from './cloud-machines-saga';
import {
  NEW_CLOUD_ENTRY,
  cloudConfigureKey,
  cloudRemoveKey,
  cloudValidateKey,
  cloudMachineDeleteRequested,
  cloudMachinePauseRequested,
  cloudMachinesConfigureRequested,
  cloudMachinesLoaded,
  cloudMachinesRemoveRequested,
  cloudProviderRemoved,
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
    expect(store.state.cloudMachines.validated[NEW_CLOUD_ENTRY]).toEqual(E2B_PROVIDER);
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
    expect(store.state.cloudMachines.failures[cloudValidateKey(NEW_CLOUD_ENTRY)]?.cloud).toEqual({
      code: 'cloud-machine-unavailable',
      reason: 'key-rejected',
      retryable: false,
      provider: 'e2b',
    });
    expect(store.state.cloudMachines.failures[cloudConfigureKey(NEW_CLOUD_ENTRY)]).toBeUndefined();
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
    expect(store.state.cloudMachines.failures[cloudConfigureKey(NEW_CLOUD_ENTRY)]?.forbidden).toBe(
      true,
    );
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
    dispatch(cloudMachinesRemoveRequested('e2b'));
    await vi.waitFor(() => expect(store.state.cloudMachines.providers).toEqual({}));
    expect(requests().at(-1)?.params).toEqual({ provider: 'e2b', stopAgents: true });
    expect(store.state.cloudMachines.machines).toEqual({});
    expect(store.state.cloudMachines.pending[cloudRemoveKey('e2b')]).toBeUndefined();
  });
});

describe('cloud machines saga — named entries', () => {
  const ENTRIES = { remoteMachines: 1, cloudMachines: 1, cloudMachineEntries: 1 };

  function entriesBackend() {
    const mock = backend(ENTRIES);
    mock.onRequest('cloudMachines.list', () => ({
      providers: [E2B_PROVIDER, TEAM_ENTRY],
      machines: [...E2B_SANDBOXES, ...TEAM_SANDBOXES],
    }));
    return mock;
  }

  function seedEntries() {
    store.dispatch(
      cloudMachinesLoaded({
        supported: true,
        entries: true,
        providers: [E2B_PROVIDER, TEAM_ENTRY],
        machines: [...E2B_SANDBOXES, ...TEAM_SANDBOXES],
        readAt: 1,
      }),
    );
  }

  it('loads every entry with cloudMachineEntries: 1', async () => {
    entriesBackend();
    start();
    dispatch(remoteLoaded);
    await vi.waitFor(() => expect(store.state.cloudMachines.loaded).toBe(true));
    expect(store.state.cloudMachines.entries).toBe(true);
    expect(Object.keys(store.state.cloudMachines.providers)).toEqual(['e2b', TEAM_ENTRY.id]);
    expect(store.state.cloudMachines.machines[TEAM_SANDBOXES[0]!.id]?.cloud?.cloudMachineId).toBe(
      TEAM_ENTRY.id,
    );
  });

  it('keeps only the entry "e2b" without cloudMachineEntries', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.list', () => ({
      providers: [E2B_PROVIDER, TEAM_ENTRY],
      machines: [],
    }));
    start();
    dispatch(remoteLoaded);
    await vi.waitFor(() => expect(store.state.cloudMachines.loaded).toBe(true));
    expect(store.state.cloudMachines.entries).toBe(false);
    expect(Object.keys(store.state.cloudMachines.providers)).toEqual(['e2b']);
  });

  it('creates a named entry and stores it by the id the backend picked', async () => {
    const mock = entriesBackend();
    mock.onRequest('cloudMachines.configure', () => ({ provider: TEAM_ENTRY }));
    seedEntries();
    store.dispatch(cloudProviderRemoved(TEAM_ENTRY.id));
    start();
    dispatch(cloudMachinesConfigureRequested({ name: 'Team project', apiKey: SECRET }));
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'e2b',
      name: 'Team project',
      apiKey: SECRET,
    });
    expect(store.state.cloudMachines.providers[TEAM_ENTRY.id]).toEqual(TEAM_ENTRY);
    expect(JSON.stringify(store.state)).not.toContain(SECRET);
  });

  it('copies another entry key with apiKeyFrom and sends no key', async () => {
    const mock = entriesBackend();
    mock.onRequest('cloudMachines.configure', () => ({ provider: TEAM_ENTRY }));
    seedEntries();
    start();
    dispatch(cloudMachinesConfigureRequested({ name: 'Team project', apiKeyFrom: 'e2b' }, true));
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'e2b',
      name: 'Team project',
      apiKeyFrom: 'e2b',
      validateOnly: true,
    });
    expect(store.state.cloudMachines.validated[NEW_CLOUD_ENTRY]).toEqual(TEAM_ENTRY);
  });

  it('renames one entry by id and keeps the failure on that entry', async () => {
    const mock = entriesBackend();
    mock.onRequest('cloudMachines.configure', () => {
      throw new BackendError({ code: 'RPC_ERROR', rpcCode: -32602, message: 'name taken' });
    });
    seedEntries();
    start();
    dispatch(cloudMachinesConfigureRequested({ cloudMachineId: TEAM_ENTRY.id, name: 'E2B' }));
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'e2b',
      cloudMachineId: TEAM_ENTRY.id,
      name: 'E2B',
    });
    expect(store.state.cloudMachines.failures[cloudConfigureKey(TEAM_ENTRY.id)]?.message).toBe(
      'name taken',
    );
    expect(store.state.cloudMachines.failures[cloudConfigureKey(NEW_CLOUD_ENTRY)]).toBeUndefined();
  });

  it('never sends entry fields to a backend without cloudMachineEntries', async () => {
    const mock = backend();
    mock.onRequest('cloudMachines.configure', () => ({ provider: E2B_PROVIDER }));
    seedLoaded();
    start();
    dispatch(
      cloudMachinesConfigureRequested({ cloudMachineId: 'e2b', name: 'E2B', apiKeyFrom: 'x' }),
    );
    await settle();
    expect(requests().at(-1)?.params).toEqual({ provider: 'e2b' });
  });

  it('removes one entry and only its sandboxes', async () => {
    const mock = entriesBackend();
    mock.onRequest('cloudMachines.remove', () => ({ ok: true, unconfirmedStops: [] }));
    seedEntries();
    start();
    dispatch(cloudMachinesRemoveRequested(TEAM_ENTRY.id));
    await vi.waitFor(() =>
      expect(store.state.cloudMachines.providers[TEAM_ENTRY.id]).toBeUndefined(),
    );
    expect(requests().at(-1)?.params).toEqual({
      provider: 'e2b',
      cloudMachineId: TEAM_ENTRY.id,
      stopAgents: true,
    });
    expect(Object.keys(store.state.cloudMachines.machines)).toEqual(['sb-1', 'sb-2', 'sb-3']);
    expect(store.state.cloudMachines.providers.e2b).toEqual(E2B_PROVIDER);
  });
});

describe('cloud machines saga — Northflank', () => {
  const NF_CAPS = {
    remoteMachines: 1,
    cloudMachines: 1,
    cloudMachineEntries: 1,
    cloudMachineProviders: 1,
  };
  const TOKEN = 'nf_live_do-not-store-me';

  function seedProviders() {
    store.dispatch(
      cloudMachinesLoaded({
        supported: true,
        entries: true,
        providerKinds: ['e2b', 'northflank'],
        providers: [E2B_PROVIDER, NORTHFLANK_ENTRY],
        machines: [...E2B_SANDBOXES, ...NORTHFLANK_SANDBOXES],
        readAt: 1,
      }),
    );
  }

  it('reads which providers the backend offers', async () => {
    const mock = backend(NF_CAPS);
    mock.onRequest('cloudMachines.list', () => ({
      providers: [NORTHFLANK_ENTRY],
      machines: [],
      providerKinds: ['e2b', 'northflank', 'modal'],
    }));
    start();
    dispatch(remoteLoaded);
    await vi.waitFor(() => expect(store.state.cloudMachines.loaded).toBe(true));
    expect(store.state.cloudMachines.providerKinds).toEqual(['e2b', 'northflank']);
    expect(store.state.cloudMachines.providers[NORTHFLANK_ENTRY.id]).toEqual(NORTHFLANK_ENTRY);
  });

  it('offers only E2B without cloudMachineProviders, even if the list names more', async () => {
    const mock = backend({ remoteMachines: 1, cloudMachines: 1, cloudMachineEntries: 1 });
    mock.onRequest('cloudMachines.list', () => ({
      providers: [],
      machines: [],
      providerKinds: ['e2b', 'northflank'],
    }));
    start();
    dispatch(remoteLoaded);
    await vi.waitFor(() => expect(store.state.cloudMachines.loaded).toBe(true));
    expect(store.state.cloudMachines.providerKinds).toEqual(['e2b']);
  });

  it('creates a Northflank entry with its token and project, and keeps no token', async () => {
    const mock = backend(NF_CAPS);
    mock.onRequest('cloudMachines.configure', () => ({ provider: NORTHFLANK_ENTRY }));
    seedProviders();
    start();
    dispatch(
      cloudMachinesConfigureRequested({
        provider: 'northflank',
        name: 'Northflank',
        apiKey: TOKEN,
        projectId: 'intent-agents',
        size: '4x8',
      }),
    );
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'northflank',
      name: 'Northflank',
      apiKey: TOKEN,
      projectId: 'intent-agents',
      size: '4x8',
    });
    expect(JSON.stringify(store.state)).not.toContain(TOKEN);
  });

  it('copies another Northflank entry token with apiKeyFrom', async () => {
    const mock = backend(NF_CAPS);
    mock.onRequest('cloudMachines.configure', () => ({ provider: NORTHFLANK_ENTRY }));
    seedProviders();
    start();
    dispatch(
      cloudMachinesConfigureRequested(
        { provider: 'northflank', name: 'Second', apiKeyFrom: NORTHFLANK_ENTRY.id },
        true,
      ),
    );
    await settle();
    expect(requests().at(-1)?.params).toEqual({
      provider: 'northflank',
      name: 'Second',
      apiKeyFrom: NORTHFLANK_ENTRY.id,
      validateOnly: true,
    });
  });

  it('removes a Northflank entry with its own provider', async () => {
    const mock = backend(NF_CAPS);
    mock.onRequest('cloudMachines.remove', () => ({ ok: true, unconfirmedStops: [] }));
    seedProviders();
    start();
    dispatch(cloudMachinesRemoveRequested(NORTHFLANK_ENTRY.id));
    await vi.waitFor(() =>
      expect(store.state.cloudMachines.providers[NORTHFLANK_ENTRY.id]).toBeUndefined(),
    );
    expect(requests().at(-1)?.params).toEqual({
      provider: 'northflank',
      cloudMachineId: NORTHFLANK_ENTRY.id,
      stopAgents: true,
    });
  });
});
