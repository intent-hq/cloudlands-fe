import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
const env = vi.hoisted(() => ({ electron: true, confirm: vi.fn(async () => true) }));
vi.mock('$lib/utils/platform-capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/utils/platform-capabilities')>()),
  isElectronPlatform: () => env.electron,
}));
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: env.confirm }));
import {
  BackendError,
  buildErrorPayload,
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../test/mocks/backend-transport.mock';
import { store } from '$store/renderer/store';
import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { setLabsLocalPairingEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import type { ConnectionRecord } from '$shared/types/connections';
import { localPairingSaga } from './local-pairing-saga';
import { readLocalPairingCodeText } from './local-pairing-code-text';
import { localPairingVisible } from './local-pairing-selectors';
import {
  localPairingCancelRequested,
  localPairingCloseRequested,
  localPairingCodeChanged,
  localPairingCodeRequested,
  localPairingCredentialChanged,
  localPairingListenerConfirmed,
  localPairingRefreshRequested,
  localPairingRemoveRequested,
} from './local-pairing-slice';
import type { LocalPairingCode } from './local-pairing-types';

const LOCAL = { localMachine: true };
const CODE: LocalPairingCode = {
  codeId: 'code-1',
  state: 'active',
  createdAt: '2026-11-12T10:00:00Z',
  expiresAt: '2099-11-12T10:10:00Z',
  attemptsRemaining: 5,
};
const CREDENTIAL = {
  credentialId: 'cred-1',
  appName: 'Intent Alpha',
  createdAt: '2026-11-12T10:01:00Z',
  lastUsedAt: null,
  connected: true,
};
const CONNECTIONS: ConnectionRecord[] = [
  {
    id: 'local',
    label: 'This machine',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
    status: 'connected',
  },
  {
    id: 'build-box',
    label: 'Build box',
    host: '192.0.2.10',
    port: 5179,
    fingerprint: 'BB:01',
    isLocal: false,
    status: 'connected',
  },
];

let task: Task;
let channel: ReturnType<typeof stdChannel>;
let mock: MockBackendHandle;

function dispatch(action: { type: string }) {
  store.dispatch(action as Parameters<typeof store.dispatch>[0]);
  channel.put(action);
}

function bindWindow(windowBackendId: string) {
  dispatch(
    connectionsListReceived({
      connections: CONNECTIONS,
      activeId: windowBackendId,
      windowBackendId,
    }),
  );
}

const rpc = (rpcCode: number, data?: unknown) =>
  new BackendError(buildErrorPayload('RPC', 'refused', { rpcCode, ...(data ? { data } : {}) }));

function daemon(capabilities: Record<string, unknown> = { localCodePairing: 1 }) {
  mock = installMockBackend();
  mock.onRequest('system.capabilities', () => capabilities);
  mock.onRequest('pairing.listLocalCredentials', () => ({ credentials: [CREDENTIAL] }));
  mock.onRequest('pairing.createLocalCode', () => ({ code: 'KTP-82M', localCode: CODE }));
  mock.onRequest('pairing.cancelLocalCode', () => ({ cancelled: true }));
  mock.onRequest('pairing.revokeLocalCredential', () => ({ revoked: true }));
  return mock;
}

const requests = (method: string) => mock.requests.filter((request) => request.method === method);

async function loaded() {
  dispatch(localPairingRefreshRequested());
  await vi.waitFor(() => expect(store.state.localPairing.support).toBe('supported'));
}

beforeEach(() => {
  env.electron = true;
  env.confirm.mockResolvedValue(true);
  store.init();
  store.dispatch(backendReconnected());
  channel = stdChannel();
  task = runSaga(
    { channel, getState: () => store.state, dispatch: (action) => store.dispatch(action) },
    localPairingSaga,
  );
  dispatch(setLabsLocalPairingEnabled(true));
  bindWindow('local');
});

afterEach(() => {
  task?.cancel();
  resetMockBackend();
  vi.clearAllMocks();
});

describe('local pairing — support', () => {
  it('loads the credentials from this desktop daemon when it advertises the capability', async () => {
    daemon();
    await loaded();
    expect(store.state.localPairing.credentials).toEqual([CREDENTIAL]);
    expect(requests('system.capabilities')[0]?.options).toEqual(LOCAL);
    expect(requests('pairing.listLocalCredentials')[0]?.options).toEqual(LOCAL);
  });

  it('is unsupported without the exact capability value', async () => {
    daemon({ localCodePairing: true });
    dispatch(localPairingRefreshRequested());
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('unsupported'));
    expect(requests('pairing.listLocalCredentials')).toHaveLength(0);
  });

  it('is unsupported when the local link refuses local-only methods (TCP/WSS, not UDS)', async () => {
    daemon().onRequest('pairing.listLocalCredentials', () => {
      throw rpc(-32001);
    });
    dispatch(localPairingRefreshRequested());
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('unsupported'));
  });

  it('stays supported with an unreadable list after a transient failure', async () => {
    daemon().onRequest('pairing.listLocalCredentials', () => {
      throw new Error('socket closed');
    });
    await loaded();
    expect(store.state.localPairing.credentials).toBeNull();
  });

  it('asks nothing in a window bound to a remote machine, outside the desktop app, or with Labs off', async () => {
    daemon();
    bindWindow('build-box');
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('unsupported'));
    bindWindow('local');
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('supported'));
    env.electron = false;
    dispatch(localPairingRefreshRequested());
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('unsupported'));
    env.electron = true;
    dispatch(setLabsLocalPairingEnabled(false));
    await vi.waitFor(() => expect(store.state.localPairing.support).toBe('unknown'));
    expect(requests('system.capabilities')).toHaveLength(1);
  });
});

describe('local pairing — visibility', () => {
  it('needs Labs, the desktop app, the local window and a supporting daemon', () => {
    const shown = {
      labsEnabled: true,
      desktop: true,
      windowBackendId: 'local',
      support: 'supported' as const,
    };
    expect(localPairingVisible(shown)).toBe(true);
    expect(localPairingVisible({ ...shown, labsEnabled: false })).toBe(false);
    expect(localPairingVisible({ ...shown, desktop: false })).toBe(false);
    expect(localPairingVisible({ ...shown, windowBackendId: 'build-box' })).toBe(false);
    expect(localPairingVisible({ ...shown, support: 'unknown' })).toBe(false);
    expect(localPairingVisible({ ...shown, support: 'unsupported' })).toBe(false);
  });
});

describe('local pairing — code panel', () => {
  it('shows a new code and keeps its text out of Redux', async () => {
    daemon();
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.step).toBe('open'));
    expect(store.state.localPairing.code).toEqual(CODE);
    expect(readLocalPairingCodeText()).toEqual({ codeId: 'code-1', code: 'KTP-82M' });
    expect(JSON.stringify(store.state.localPairing)).not.toContain('KTP-82M');
    expect(requests('pairing.createLocalCode')[0]?.options).toEqual(LOCAL);
  });

  it('follows the daemon events to Connected and forgets the code text', async () => {
    daemon();
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(localPairingCodeChanged({ ...CODE, attemptsRemaining: 4 }));
    expect(store.state.localPairing.code?.attemptsRemaining).toBe(4);
    dispatch(
      localPairingCodeChanged({
        ...CODE,
        state: 'redeemed',
        appName: 'Intent Alpha',
        credentialId: 'cred-2',
      }),
    );
    expect(store.state.localPairing.code?.state).toBe('redeemed');
    expect(readLocalPairingCodeText()).toBeNull();
  });

  it('asks before turning on a loopback-only listener, then creates the code', async () => {
    const backend = daemon();
    let listening = false;
    backend.onRequest('pairing.createLocalCode', () => {
      if (!listening) throw rpc(-32603, { code: 'listener-down' });
      return { code: 'KTP-82M', localCode: CODE };
    });
    backend.onRequest('settings.list', () => ({
      settings: [
        { path: 'server.wsApi.enabled', value: false },
        { path: 'server.bindAddress', value: ['192.168.1.7'] },
        { path: 'server.tunnel.enabled', value: true },
      ],
    }));
    backend.onRequest('settings.update', () => {
      listening = true;
      return { applied: [] };
    });
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.step).toBe('confirm-listener'));
    expect(requests('settings.update')).toHaveLength(0);
    dispatch(localPairingListenerConfirmed());
    await vi.waitFor(() => expect(store.state.localPairing.code).toEqual(CODE));
    expect(requests('settings.update')[0]).toEqual({
      method: 'settings.update',
      params: {
        changes: [
          { path: 'server.bindAddress', value: '127.0.0.1' },
          { path: 'server.tunnel.enabled', value: false },
          { path: 'server.wsApi.enabled', value: true },
        ],
      },
      options: LOCAL,
    });
  });

  it('reports a listener that still does not come up', async () => {
    const backend = daemon();
    backend.onRequest('pairing.createLocalCode', () => {
      throw rpc(-32603, { code: 'listener-down' });
    });
    backend.onRequest('settings.list', () => ({ settings: [] }));
    backend.onRequest('settings.update', () => ({ applied: [] }));
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.step).toBe('confirm-listener'));
    dispatch(localPairingListenerConfirmed());
    await vi.waitFor(() => expect(store.state.localPairing.failure).toBe('listener-failed'));
  });

  it('reports a failed create', async () => {
    daemon().onRequest('pairing.createLocalCode', () => {
      throw rpc(-32603);
    });
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.failure).toBe('create-failed'));
  });

  it('cancels the shown code', async () => {
    daemon();
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(localPairingCancelRequested());
    await vi.waitFor(() =>
      expect(store.state.localPairing.code).toMatchObject({
        state: 'cancelled',
        cancelReason: 'user',
      }),
    );
    expect(requests('pairing.cancelLocalCode')[0]?.params).toEqual({ codeId: 'code-1' });
  });

  it('keeps the active code when cancelling fails', async () => {
    daemon().onRequest('pairing.cancelLocalCode', () => {
      throw new Error('socket closed');
    });
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(localPairingCancelRequested());
    await vi.waitFor(() => expect(store.state.localPairing.failure).toBe('cancel-failed'));
    expect(store.state.localPairing.code?.state).toBe('active');
  });

  it('cancels an active code when the panel closes or the lab is turned off', async () => {
    daemon();
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(localPairingCloseRequested());
    await vi.waitFor(() => expect(requests('pairing.cancelLocalCode')).toHaveLength(1));
    expect(store.state.localPairing.step).toBe('closed');
    expect(readLocalPairingCodeText()).toBeNull();

    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(setLabsLocalPairingEnabled(false));
    await vi.waitFor(() => expect(requests('pairing.cancelLocalCode')).toHaveLength(2));
    expect(store.state.localPairing.step).toBe('closed');
  });

  it('does not cancel a code that already ended when the panel closes', async () => {
    daemon();
    await loaded();
    dispatch(localPairingCodeRequested());
    await vi.waitFor(() => expect(store.state.localPairing.code).not.toBeNull());
    dispatch(localPairingCodeChanged({ ...CODE, state: 'expired' }));
    dispatch(localPairingCloseRequested());
    await vi.waitFor(() => expect(store.state.localPairing.step).toBe('closed'));
    expect(requests('pairing.cancelLocalCode')).toHaveLength(0);
  });
});

describe('local pairing — Intents on this computer', () => {
  it('removes an Intent after confirmation', async () => {
    daemon();
    await loaded();
    dispatch(localPairingRemoveRequested('cred-1'));
    await vi.waitFor(() => expect(store.state.localPairing.credentials).toEqual([]));
    expect(env.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, title: 'Remove Intent Alpha?' }),
    );
    expect(requests('pairing.revokeLocalCredential')[0]).toEqual({
      method: 'pairing.revokeLocalCredential',
      params: { credentialId: 'cred-1' },
      options: LOCAL,
    });
  });

  it('keeps the Intent when the user declines', async () => {
    daemon();
    await loaded();
    env.confirm.mockResolvedValueOnce(false);
    dispatch(localPairingRemoveRequested('cred-1'));
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalled());
    expect(requests('pairing.revokeLocalCredential')).toHaveLength(0);
    expect(store.state.localPairing.credentials).toHaveLength(1);
  });

  it('marks a failed removal on the row', async () => {
    daemon().onRequest('pairing.revokeLocalCredential', () => {
      throw new Error('socket closed');
    });
    await loaded();
    dispatch(localPairingRemoveRequested('cred-1'));
    await vi.waitFor(() =>
      expect(store.state.localPairing.removeFailed).toEqual({ 'cred-1': true }),
    );
    expect(store.state.localPairing.removing).toEqual({});
    expect(store.state.localPairing.credentials).toHaveLength(1);
  });

  it('applies credential events in list order', async () => {
    daemon();
    await loaded();
    dispatch(
      localPairingCredentialChanged({
        ...CREDENTIAL,
        credentialId: 'cred-0',
        appName: 'Intent (dev build)',
        createdAt: '2026-11-12T09:00:00Z',
      }),
    );
    dispatch(localPairingCredentialChanged({ ...CREDENTIAL, connected: false }));
    expect(store.state.localPairing.credentials?.map((entry) => entry.credentialId)).toEqual([
      'cred-0',
      'cred-1',
    ]);
    expect(store.state.localPairing.credentials?.[1]?.connected).toBe(false);
  });
});
