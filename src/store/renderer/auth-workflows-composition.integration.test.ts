import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
import { navigateToSettings } from '$lib/utils/workspace-navigation';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { CONNECTIONS_CHANGED_EVENT } from '$shared/types/connections';
import {
  GUEST_SESSIONS_CHANGED_EVENT,
  type GuestSessionRecord,
} from '$shared/types/guest-sessions';
import { startAppStoreLifecycle, type AppStoreHmrData } from './app-store-lifecycle';
import { startRootStoreLifecycle } from './root-store-lifecycle';
import { store as appStore } from './store';
import {
  connectionWorkflowCleared,
  connectionWorkflowRequested,
  openConnectionRequested,
} from './slices/connections/connections-slice';
import { selectConnectionWorkflow } from './slices/connections/connections-selectors';
import { leaveGuestSessionRequested } from './slices/guest-sessions/guest-sessions-slice';
import { connectLinear, consumeLinearAuth } from './slices/linear-auth/linear-auth-slice';
import { selectLinearAuthConsumerOperation } from './slices/linear-auth/linear-auth-selectors';
import { connectSentry } from './slices/sentry-auth/sentry-auth-slice';
import {
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  githubAuthChanged,
  startGitHubAuth,
} from './slices/github-auth/github-auth-slice';

// Keep unrelated startup reads pending at the transport boundary. The full
// production registry, Store middleware, reducers and workflow sagas still run.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(() => new Promise(() => {})),
  backendSubscribe: vi.fn(() => new Promise(() => {})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/electron-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/electron-bridge')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const guest: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: 'studio.local',
  hosts: ['studio.local'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'principal-1',
  login: 'octocat',
  tokenEncrypted: true,
  workspaces: [],
  updatedAt: 1,
};
const C = IPC_CHANNELS.CONNECTIONS;
const G = IPC_CHANNELS.GUEST_SESSIONS;
let stopRoot: (() => void) | undefined;
let stopApp: (() => void) | undefined;
let hmr: AppStoreHmrData;
let invoke: ReturnType<typeof vi.fn>;
let on: ReturnType<typeof vi.spyOn>;
let off: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetMockIpcRouter();
  hmr = {};
  registerMockIpcHandler(C.LIST, () => ({
    connections: [],
    activeId: 'local',
    windowBackendId: 'local',
  }));
  registerMockIpcHandler(G.LIST, () => ({ sessions: [guest], openIds: [], connectedIds: [] }));
  registerMockIpcHandler('agent:get-active-streams', () => new Promise(() => {}));
  registerMockIpcHandler('workspace:list', () => new Promise(() => {}));
  invoke = vi.fn((channel: string, ...args: unknown[]) =>
    channel.startsWith('connections:') || channel.startsWith('guest-sessions:')
      ? mockInvoke(channel, ...args)
      : new Promise(() => {}),
  );
  vi.spyOn(window.electronAPI!, 'invoke').mockImplementation(invoke);
  on = vi.spyOn(window.electronAPI!, 'on');
  off = vi.spyOn(window.electronAPI!, 'offById');
  vi.spyOn(appClient.settings, 'update').mockResolvedValue([]);
  vi.spyOn(linearAuthClient, 'getAuthState').mockResolvedValue({
    isAuthenticated: true,
    requiresDaemonAuth: false,
  });
  vi.spyOn(sentryAuthClient, 'saveConfig').mockResolvedValue({ success: true });
  vi.spyOn(sentryAuthClient, 'fetchProjects').mockResolvedValue([]);
  vi.spyOn(githubAuthClient, 'startAuth').mockResolvedValue({
    success: true,
    userCode: 'TEST-CODE',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 900,
    interval: 5,
  });
  vi.spyOn(githubAuthClient, 'checkAuthComplete').mockImplementation(() => new Promise(() => {}));
  vi.spyOn(githubAuthClient, 'cancelAuth').mockResolvedValue({ success: true });
  vi.spyOn(githubAuthClient, 'getUser').mockResolvedValue(null);
  stopRoot = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  stopApp = startAppStoreLifecycle(appStore, hmr);
});

afterEach(() => {
  stopApp?.();
  stopRoot?.();
  stopApp = stopRoot = undefined;
  vi.restoreAllMocks();
  resetMockIpcRouter();
});

describe('authentication workflow production composition', () => {
  it('runs each owner once, joins guest requests and preserves independent public callers', async () => {
    const opening = Promise.withResolvers<{ status: 'opened'; id: string }>();
    const leaving = Promise.withResolvers<{ id: string; revoked: boolean }>();
    registerMockIpcHandler(C.OPEN, () => opening.promise);
    registerMockIpcHandler(G.LEAVE, () => leaving.promise);
    const legacyOpen = openConnectionRequested('remote-1');
    const leave = leaveGuestSessionRequested(guest.id);
    const joinedLeave = leaveGuestSessionRequested(guest.id);
    appStore.dispatch(legacyOpen);
    appStore.dispatch(leave);
    appStore.dispatch(joinedLeave);
    // Existing no-request-metadata caller remains valid.
    appStore.dispatch(connectLinear(' fixture-key '));
    appStore.dispatch(connectSentry('acme', 'fixture-token'));
    appStore.dispatch(startGitHubAuth());
    await vi.waitFor(() => {
      expect(appStore.state.linearAuth.isAuthenticated).toBe(true);
      expect(appStore.state.sentryAuth.operation?.status).toBe('succeeded');
      expect(githubAuthClient.checkAuthComplete).toHaveBeenCalledOnce();
    });
    expect(appStore.state.connections.openingIds).toEqual(['remote-1']);
    expect(appClient.settings.update).toHaveBeenCalledExactlyOnceWith([
      { path: 'linear.token', value: 'fixture-key' },
    ]);
    expect(linearAuthClient.getAuthState).toHaveBeenCalledExactlyOnceWith(true);
    expect(sentryAuthClient.saveConfig).toHaveBeenCalledExactlyOnceWith('acme', 'fixture-token');
    expect(sentryAuthClient.fetchProjects).toHaveBeenCalledOnce();
    expect(githubAuthClient.startAuth).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('focus'));
    appStore.dispatch(checkGitHubAuthStatus());
    expect(githubAuthClient.checkAuthComplete).toHaveBeenCalledOnce();
    expect(invoke.mock.calls.filter(([channel]) => channel === C.OPEN)).toEqual([
      [C.OPEN, { id: 'remote-1' }],
    ]);
    expect(invoke.mock.calls.filter(([channel]) => channel === G.LEAVE)).toEqual([
      [G.LEAVE, { id: guest.id }],
    ]);
    for (const channel of [C.LIST, G.LIST])
      expect(invoke.mock.calls.filter(([name]) => name === channel)).toEqual([[channel]]);
    for (const channel of [CONNECTIONS_CHANGED_EVENT, GUEST_SESSIONS_CHANGED_EVENT])
      expect(on.mock.calls.filter(([name]) => name === channel)).toHaveLength(1);
    opening.resolve({ status: 'opened', id: 'remote-1' });
    leaving.resolve({ id: guest.id, revoked: false });
    await expect(legacyOpen.promise).resolves.toEqual({ status: 'opened', id: 'remote-1' });
    await expect(Promise.all([leave.promise, joinedLeave.promise])).resolves.toEqual([
      { id: guest.id, revoked: false },
      { id: guest.id, revoked: false },
    ]);
    appStore.dispatch(cancelGitHubAuth());
    await vi.waitFor(() => expect(appStore.state.githubAuth.isAuthenticating).toBe(false));
    appStore.dispatch(githubAuthChanged('authorized'));
    expect(githubAuthClient.getUser).not.toHaveBeenCalled();
  });

  it('orders compatibility opens with workflow opens and suppresses stale guest recovery', async () => {
    const opening = Promise.withResolvers<{ status: 'secret-unavailable' }>();
    const open = vi
      .fn()
      .mockReturnValueOnce(opening.promise)
      .mockResolvedValue({ status: 'secret-unavailable' });
    registerMockIpcHandler(C.OPEN, open);
    const request = () =>
      connectionWorkflowRequested('indicator', {
        kind: 'open',
        id: guest.id,
        recovery: 'settings',
      });
    appStore.dispatch(request());
    const legacy = openConnectionRequested(guest.id);
    appStore.dispatch(legacy);
    expect(open).toHaveBeenCalledOnce();
    appStore.dispatch(connectionWorkflowCleared('indicator'));
    opening.resolve({ status: 'secret-unavailable' });
    await expect(legacy.promise).resolves.toEqual({ status: 'secret-unavailable' });
    expect(navigateToSettings).not.toHaveBeenCalled();
    expect(selectConnectionWorkflow.select(appStore.state, 'indicator')).toBeUndefined();
    appStore.dispatch(request());
    await vi.waitFor(() =>
      expect(navigateToSettings).toHaveBeenCalledExactlyOnceWith({
        tab: 'guest-sessions',
      }),
    );
    expect(selectConnectionWorkflow.select(appStore.state, 'indicator')?.outcome).toEqual({
      kind: 'secretUnavailable',
    });
    expect(open.mock.calls).toEqual([[{ id: guest.id }], [{ id: guest.id }], [{ id: guest.id }]]);
  });

  it('retains only the current consumer result while other workflow owners keep progressing', async () => {
    const firstWrite = Promise.withResolvers<[]>();
    vi.mocked(appClient.settings.update).mockReturnValueOnce(firstWrite.promise);
    appStore.dispatch(connectLinear('first', { requestId: 'first', consumerId: 'settings-a' }));
    appStore.dispatch(connectLinear('second', { requestId: 'second', consumerId: 'settings-b' }));
    appStore.dispatch(connectSentry('acme', 'fixture-token'));
    await vi.waitFor(() => expect(appStore.state.sentryAuth.operation?.status).toBe('succeeded'));
    expect(appClient.settings.update).toHaveBeenCalledTimes(1);
    firstWrite.resolve([]);
    await vi.waitFor(() =>
      expect(selectLinearAuthConsumerOperation.select(appStore.state, 'settings-b')).toMatchObject({
        requestId: 'second',
        status: 'succeeded',
      }),
    );
    expect(selectLinearAuthConsumerOperation.select(appStore.state, 'settings-a')).toBeNull();
    expect(linearAuthClient.getAuthState).toHaveBeenCalledOnce();
    expect(appClient.settings.update).toHaveBeenCalledTimes(2);
    appStore.dispatch(consumeLinearAuth('first'));
    expect(appStore.state.linearAuth.operation?.requestId).toBe('second');
    appStore.dispatch(consumeLinearAuth('second'));
    expect(appStore.state.linearAuth.operation).toBeNull();
  });

  it('settles active, queued and joined requests before replacing the app owner', async () => {
    const opening = Promise.withResolvers<{ status: 'opened'; id: string }>();
    const leaving = Promise.withResolvers<{ id: string; revoked: boolean }>();
    const authWrite = Promise.withResolvers<[]>();
    registerMockIpcHandler(C.OPEN, () => opening.promise);
    registerMockIpcHandler(G.LEAVE, () => leaving.promise);
    vi.mocked(appClient.settings.update).mockReturnValueOnce(authWrite.promise);
    const requests = [
      openConnectionRequested('remote-1'),
      openConnectionRequested('remote-1'),
      leaveGuestSessionRequested(guest.id),
      leaveGuestSessionRequested(guest.id),
    ];
    const outcomes = Promise.allSettled(requests.map((request) => request.promise));
    for (const request of requests) appStore.dispatch(request);
    appStore.dispatch(connectLinear('pending', { requestId: 'pending', consumerId: 'settings' }));
    const previousStop = stopApp!;
    stopApp = startAppStoreLifecycle(appStore, hmr);
    previousStop();
    const results = await outcomes;
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    for (const result of results)
      if (result.status === 'rejected') expect(result.reason.message).toMatch(/cancelled/i);
    expect(appStore.state.linearAuth.operation?.status).toBe('cancelled');
    expect(appStore.state.connections.openingIds).toEqual([]);
    opening.resolve({ status: 'opened', id: 'remote-1' });
    leaving.resolve({ id: guest.id, revoked: true });
    authWrite.resolve([]);
    await Promise.all([opening.promise, leaving.promise, authWrite.promise]);
    expect(linearAuthClient.getAuthState).not.toHaveBeenCalled();
    expect(invoke.mock.calls.filter(([channel]) => channel === C.OPEN)).toHaveLength(1);
    expect(invoke.mock.calls.filter(([channel]) => channel === G.LEAVE)).toHaveLength(1);
    registerMockIpcHandler(C.OPEN, () => ({ status: 'opened', id: 'remote-2' }));
    const afterRestart = openConnectionRequested('remote-2');
    appStore.dispatch(afterRestart);
    await expect(afterRestart.promise).resolves.toEqual({ status: 'opened', id: 'remote-2' });
    stopApp();
    stopApp();
    for (const channel of [CONNECTIONS_CHANGED_EVENT, GUEST_SESSIONS_CHANGED_EVENT]) {
      expect(on.mock.calls.filter(([name]) => name === channel)).toHaveLength(2);
      expect(off.mock.calls.filter(([name]) => name === channel)).toHaveLength(2);
    }
  });
});
