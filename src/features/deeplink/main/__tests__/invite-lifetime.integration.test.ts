/** @vitest-environment jsdom */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLABORATION_AUTH } from '../../../collaboration-auth/types';
import { INVITE_PROGRESS_CHANNELS as PROGRESS } from '../../../../shared/ipc/channels';

// Actual policy IPC, attempt capture, main progress and renderer progress service interact here.
// Only Electron transport, the local daemon, remote sockets and credential persistence are fixtures.
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, input?: any) => any>(),
  listeners: new Map<string, (input: any) => void>(),
  parent: null as any,
  focused: null as any,
  api: null as any,
  dial: vi.fn(),
  request: vi.fn(),
  add: vi.fn(),
  open: vi.fn(),
  find: vi.fn(),
  token: vi.fn(),
  remoteIdentity: vi.fn(),
  consent: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isReady: () => true },
  BrowserWindow: {
    getFocusedWindow: () => state.focused,
    fromWebContents: () => state.parent,
  },
  ipcMain: { handle: (key: string, fn: any) => state.handlers.set(key, fn) },
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('../../../../main/state', () => ({ getMainWindow: () => state.parent }));
vi.mock('$lib/client/live/backend-transport', () => ({ electronAPI: () => state.api }));
vi.mock('../../../backend/main/backend.ipc', () => ({
  captureLocalIdentityConnection: () => ({
    supported: false,
    current: () => true,
    request: state.request,
  }),
  onBackendStatus: () => () => {},
  getConnectedDaemonProtocolVersion: () => '10.8', // protocol-version-ok: controlled legacy fixture
  openBackendWindow: (...args: unknown[]) => state.open(...args),
}));
vi.mock('../../../backend/main/guest-sessions-store', () => ({
  findAllMatching: (...args: unknown[]) => state.find(...args),
  getDecryptedToken: (...args: unknown[]) => state.token(...args),
  add: (...args: unknown[]) => state.add(...args),
  GuestStoreCorruptError: class extends Error {},
  GuestEncryptionUnavailableError: class extends Error {},
}));
vi.mock('../../../backend/main/invited-principal', () => ({
  inspectPersonalCredential: (...args: unknown[]) => state.remoteIdentity(...args),
  invitedRole: () => 'guest',
}));
vi.mock('../../../backend/main/invite-connection', async (actual) => ({
  ...(await actual<object>()),
  openInviteConnection: (...args: unknown[]) => state.dial(...args),
}));
vi.mock('../../../../main/invite-consent', () => ({
  showInviteConsent: (...args: unknown[]) => state.consent(...args),
}));
vi.mock('../../../../main/invite-notice', () => ({ showInviteNotice: vi.fn() }));

const pin = 'ab'.repeat(32);
const uri = (id: string) =>
  `intent://invite?v=1&host=host.test&port=8443&fp=${pin}&inviteId=${id}&secret=private-invite-secret`;
const credential = {
  status: 'authorized',
  token: 'personal-bearer',
  principalId: 'gh:42',
  login: 'octocat',
  workspaceId: 'ws-1',
};
const challenge = {
  workspaceId: 'ws-1',
  workspaceTitle: 'Shared workspace',
  nonce: 'nonce-1',
  nonceExpiresAt: '2026-09-27T00:00:00Z',
};
const never = new Promise<never>(() => {});
let dispose: (() => void) | undefined;
let modal: any;
function windowFixture(id: number) {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    isDestroyed: () => false,
    send: vi.fn((channel: string, payload: unknown) => state.listeners.get(channel)?.(payload)),
  });
  return { webContents, isDestroyed: () => false };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
async function invoke(channel: string, input: unknown, sender = state.parent.webContents) {
  return state.handlers.get(channel)?.({ sender }, input);
}
async function policy(multiplayer: boolean, sender = state.parent.webContents) {
  return invoke(COLLABORATION_AUTH.POLICY, { multiplayer, gitlab: false }, sender);
}
function connection() {
  return {
    host: 'host.test',
    via: 'direct',
    close: vi.fn(),
    challenge: vi.fn(async () => challenge),
    inspect: vi.fn(async () => challenge),
    prove: vi.fn(async () => credential),
    accept: vi.fn(async () => credential),
  };
}
async function load() {
  const auth = await import('../../../collaboration-auth/main/collaboration-auth.ipc');
  auth.registerCollaborationAuthHandlers();
  const renderer = await import('../../../invite-progress/invite-progress-service');
  dispose = renderer.installInviteProgressService({
    onShow: (p) => {
      modal = p;
    },
    onUpdate: (p) => {
      modal = p;
    },
    onDismiss: () => {
      modal = null;
    },
  });
  return { ...renderer, ...(await import('../invite-deep-link')) };
}
beforeEach(() => {
  vi.resetModules();
  state.handlers.clear();
  state.listeners.clear();
  state.parent = windowFixture(41);
  state.focused = state.parent;
  modal = null;
  state.api = {
    on: (channel: string, handler: any) => {
      state.listeners.set(channel, handler);
      return channel;
    },
    offById: (channel: string) => state.listeners.delete(channel),
    invoke: (channel: string, payload: unknown) => invoke(channel, payload),
  };
  state.dial.mockReset();
  state.add.mockReset().mockResolvedValue({ id: 'saved-A', tokenEncrypted: true });
  state.open.mockReset().mockResolvedValue(undefined);
  state.find.mockReset().mockResolvedValue([]);
  state.token.mockReset().mockResolvedValue(credential.token);
  state.remoteIdentity.mockReset().mockResolvedValue({
    principal: { id: credential.principalId, login: 'octocat', isAdministrator: false },
  });
  state.consent.mockReset().mockImplementation(() => ({
    decision: Promise.resolve('open'),
    cancelledWhileWaiting: never,
    dismiss: vi.fn(),
  }));
  state.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'github.getUser') return { user: { id: 42, login: 'octocat' } };
    if (method === 'github.identityProof.create') return { gistId: 'gist-1', login: 'octocat' };
    if (method === 'github.identityProof.delete') return { ok: true };
    throw new Error('unexpected fixture RPC');
  });
});
afterEach(async () => {
  state.parent.webContents.emit('destroyed');
  await flush();
  dispose?.();
});

describe('invitation lifetime across the actual main and renderer modules', () => {
  it('replays admission after late renderer readiness with an unchanged policy, without auto-admitting', async () => {
    const flow = await load();
    dispose?.();
    const joining = flow.handleInviteDeepLink(uri('original'));
    await policy(true);
    expect(state.dial).not.toHaveBeenCalled();
    expect(modal).toBeNull();
    dispose = flow.installInviteProgressService({
      onShow: (p) => {
        modal = p;
      },
      onUpdate: (p) => {
        modal = p;
      },
      onDismiss: () => {
        modal = null;
      },
    });
    await policy(true); // same policy, now with the original renderer listeners installed
    expect(modal.phase).toBe('admission');
    expect(state.dial).not.toHaveBeenCalled();
    flow.cancelInviteProgress();
    await joining;
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'unpublished'] as const)(
    'retains an %s invite for deliberate same-window retry',
    async (mode) => {
      const flow = await load();
      if (mode === 'disabled') await policy(false);
      const pendingDial = Promise.withResolvers<any>();
      state.dial.mockReturnValue(pendingDial.promise);
      const joining = flow.handleInviteDeepLink(uri('original'));
      await flush();
      expect(modal?.phase).toBe('admission');
      expect(state.dial).not.toHaveBeenCalled();
      expect(state.request).not.toHaveBeenCalled();
      expect(JSON.stringify(state.parent.webContents.send.mock.calls)).not.toMatch(
        /private-invite-secret|personal-bearer|intent:\/\/|original/,
      );
      const requestId = modal.requestId;
      await policy(true);
      await flush();
      expect(state.dial).not.toHaveBeenCalled();
      await invoke(PROGRESS.RESPONSE, { requestId, action: 'retry' });
      await flush();
      expect(state.dial).toHaveBeenCalledOnce();
      const remote = connection();
      pendingDial.resolve(remote);
      await joining;
      expect(remote.prove).toHaveBeenCalledWith(
        'original',
        'private-invite-secret',
        expect.anything(),
      );
      expect(state.open).toHaveBeenCalledOnce();
    },
  );

  it('keeps recovery in the original window, ignores borrowed authority and retires a changed invite', async () => {
    const flow = await load();
    await policy(false);
    state.dial.mockReturnValue(never);
    const original = state.parent;
    const joiningA = flow.handleInviteDeepLink(uri('A'));
    await flush();
    const requestA = modal.requestId;
    await invoke(PROGRESS.RESPONSE, { requestId: requestA, action: 'retry' });
    expect(state.dial).not.toHaveBeenCalled();
    const other = windowFixture(99);
    state.focused = other;
    await policy(true, other.webContents);
    await invoke(PROGRESS.RESPONSE, { requestId: requestA, action: 'retry' }, other.webContents);
    expect(state.dial).not.toHaveBeenCalled();
    expect(other.webContents.send).not.toHaveBeenCalled();
    state.focused = original;
    const joiningB = flow.handleInviteDeepLink(uri('B'));
    await joiningA;
    await flush();
    expect(modal.requestId).not.toBe(requestA);
    await policy(true);
    await invoke(PROGRESS.RESPONSE, { requestId: requestA, action: 'retry' });
    expect(state.dial).not.toHaveBeenCalled();
    original.webContents.emit('destroyed');
    await joiningB;
    expect(state.request).not.toHaveBeenCalled();
    expect(state.add).not.toHaveBeenCalled();
  });

  it('expires recovery after five minutes without authenticating or opening', async () => {
    const flow = await load();
    vi.useFakeTimers();
    try {
      const joining = flow.handleInviteDeepLink(uri('A'));
      await flush();
      expect(modal.phase).toBe('admission');
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await joining;
      expect(modal).toBeNull();
      expect(state.dial).not.toHaveBeenCalled();
      expect(state.request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['flag', 'destroyed'] as const)(
    'saves a granted bearer without new UI after original %s cancellation',
    async (reason) => {
      const flow = await load();
      await policy(true);
      const grant = Promise.withResolvers<any>();
      const entered = Promise.withResolvers<void>();
      const remote = connection();
      remote.prove.mockImplementation(() => {
        entered.resolve();
        return grant.promise;
      });
      state.dial.mockResolvedValue(remote);
      const joining = flow.handleInviteDeepLink(uri('A'));
      await entered.promise;
      if (reason === 'flag') {
        await policy(false);
        await policy(true);
      } else state.parent.webContents.emit('destroyed');
      const before = state.parent.webContents.send.mock.calls.filter(
        ([channel]) => channel === PROGRESS.SHOW,
      ).length;
      grant.resolve(credential);
      await joining;
      expect(state.add).toHaveBeenCalledOnce();
      expect(state.open).not.toHaveBeenCalled();
      expect(
        state.parent.webContents.send.mock.calls.filter(([channel]) => channel === PROGRESS.SHOW),
      ).toHaveLength(before);
    },
  );

  it.each(['accept', 'prove'] as const)(
    'saves a late %s grant without replacing B or its renderer cancel',
    async (method) => {
      const flow = await load();
      await policy(true);
      const granted = Promise.withResolvers<any>();
      const entered = Promise.withResolvers<void>();
      const a = connection();
      a[method].mockImplementation(() => {
        entered.resolve();
        return granted.promise;
      });
      if (method === 'accept')
        state.find.mockResolvedValue([
          { id: 'stored', principalId: credential.principalId, fingerprint: pin },
        ]);
      const bDial = Promise.withResolvers<any>();
      state.dial.mockResolvedValueOnce(a).mockReturnValueOnce(bDial.promise);
      const joiningA = flow.handleInviteDeepLink(uri('A'));
      await entered.promise;
      const joiningB = flow.handleInviteDeepLink(uri('B'));
      await flush();
      expect(modal?.phase).toBe('connecting');
      const bRequest = modal.requestId;
      const showsBefore = state.parent.webContents.send.mock.calls.filter(
        ([channel]) => channel === PROGRESS.SHOW,
      ).length;
      state.focused = windowFixture(99);
      granted.resolve(credential);
      await joiningA;
      expect(state.add).toHaveBeenCalledWith(expect.objectContaining({ token: credential.token }));
      expect(state.open).not.toHaveBeenCalled();
      expect(state.focused.webContents.send).not.toHaveBeenCalled();
      expect(
        state.parent.webContents.send.mock.calls.filter(([channel]) => channel === PROGRESS.SHOW),
      ).toHaveLength(showsBefore);
      expect(modal?.requestId).toBe(bRequest);
      flow.cancelInviteProgress();
      await joiningB;
      const b = connection();
      bDial.resolve(b);
      await flush();
      expect(b.close).toHaveBeenCalledOnce();
      expect(b.challenge).not.toHaveBeenCalled();
      expect(state.add).toHaveBeenCalledOnce();
    },
  );
});
