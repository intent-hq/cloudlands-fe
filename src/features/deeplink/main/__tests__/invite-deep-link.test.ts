import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the `intent://invite` deep-link join flow
 * (features/deeplink/main/invite-deep-link.ts): dial `/invite` with the pin
 * (no fingerprint confirmation) → `invite.challenge` → consent → the guest's
 * own daemon publishes the nonce as a gist (`github.identityProof.create`) →
 * `invite.prove` → credential stored as a GUEST session (never a paired
 * backend) → gist deleted → window opened. A guest that is not signed in to
 * GitHub (or whose token lacks the `gist` scope) signs in through its own
 * `github.connect` device flow first. Malformed links are rejected fail-soft,
 * the secret and the minted token never reach a log line, and every refusal
 * maps onto a failure dialog instead of a crash.
 */

const showMessageBox = vi.fn();
const appIsReady = vi.fn(() => true);
const clipboardWriteText = vi.fn();
const openExternal = vi.fn();
/** `ipcMain.handle` registrations of the real `main/invite-consent.ts` (see the cancel-after-grant describe). */
type IpcInvokeHandler = (event: unknown, payload: unknown) => Promise<unknown>;
const registeredIpcHandlers = new Map<string, IpcInvokeHandler>();
vi.mock('electron', () => ({
  dialog: {
    get showMessageBox() {
      return showMessageBox;
    },
  },
  app: {
    get isReady() {
      return appIsReady;
    },
  },
  clipboard: {
    get writeText() {
      return clipboardWriteText;
    },
  },
  shell: {
    get openExternal() {
      return openExternal;
    },
  },
  ipcMain: {
    handle(channel: string, handler: IpcInvokeHandler) {
      registeredIpcHandlers.set(channel, handler);
    },
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
  },
}));

const guestAdd = vi.fn();
const guestFindMatching = vi.fn();
const guestGetDecryptedToken = vi.fn();
vi.mock('../../../backend/main/guest-sessions-store', async () => {
  const actual = await vi.importActual<typeof import('../../../backend/main/guest-sessions-store')>(
    '../../../backend/main/guest-sessions-store',
  );
  return {
    GuestStoreCorruptError: actual.GuestStoreCorruptError,
    GuestEncryptionUnavailableError: actual.GuestEncryptionUnavailableError,
    get add() {
      return guestAdd;
    },
    get findMatching() {
      return guestFindMatching;
    },
    get getDecryptedToken() {
      return guestGetDecryptedToken;
    },
  };
});

/**
 * The guest's OWN daemon (the local JSON-RPC client): `github.getUser`,
 * `github.identityProof.*`, and the `github.connect` device flow. Each method
 * is a handler in `localMethods`, replaced per test with `onLocal`.
 */
type LocalHandler = (params: unknown) => unknown;
const localMethods = new Map<string, LocalHandler>();
const localRequest = vi.fn(async (method: string, params?: unknown) => {
  const handler = localMethods.get(method);
  if (!handler) throw new Error(`unexpected local method ${method}`);
  return handler(params);
});
function onLocal(method: string, handler: LocalHandler): void {
  localMethods.set(method, handler);
}
function localCalls(method: string): unknown[][] {
  return localRequest.mock.calls.filter(([m]) => m === method);
}
/** `github:auth-changed` listeners attached through `onBackendNotification`. */
type NotificationHandler = (notification: { method: string; params?: unknown }) => void;
const notificationListeners = new Set<NotificationHandler>();
function emitAuthChanged(status: string): void {
  for (const listener of notificationListeners) {
    listener({
      method: 'events.event',
      params: { event: { type: 'github:auth-changed', data: { status } } },
    });
  }
}

const openBackendWindow = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  get openBackendWindow() {
    return openBackendWindow;
  },
  getBackendClient: () => ({ request: localRequest }),
  onBackendNotification: (handler: NotificationHandler) => {
    notificationListeners.add(handler);
    return () => notificationListeners.delete(handler);
  },
}));

vi.mock('../../../backend/main/backend-connection', async () => {
  const actual = await vi.importActual<typeof import('../../../backend/main/backend-connection')>(
    '../../../backend/main/backend-connection',
  );
  return {
    PinMismatchError: class PinMismatchError extends Error {},
    normalizeFingerprint: actual.normalizeFingerprint,
  };
});

const challenge = vi.fn();
const prove = vi.fn();
const inspect = vi.fn();
const accept = vi.fn();
const close = vi.fn();
const openInviteConnection = vi.fn();
vi.mock('../../../backend/main/invite-connection', async () => {
  const actual = await vi.importActual<typeof import('../../../backend/main/invite-connection')>(
    '../../../backend/main/invite-connection',
  );
  return {
    InviteRpcError: actual.InviteRpcError,
    InviteTransportError: actual.InviteTransportError,
    get openInviteConnection() {
      return openInviteConnection;
    },
  };
});

vi.mock('../../../../main/state', () => ({
  getMainWindow: () => null,
}));

/**
 * Renderer consent seam. `fakeConsent(null)` (the default) is the
 * unavailable-renderer path — the flow falls back to the native boxes, which
 * the first describe exercises.
 */
const showInviteConsent = vi.fn();
vi.mock('../../../../main/invite-consent', () => ({
  get showInviteConsent() {
    return showInviteConsent;
  },
}));

/**
 * A consent prompt whose first decision is settled (`open` / `cancel` / `null`)
 * or, with `'pending'`, left open until the test calls `decide(...)` — the
 * modal shown while the user has not yet clicked anything.
 */
function fakeConsent(decision: 'open' | 'cancel' | 'pending' | null) {
  let cancelWaiting!: () => void;
  let decide!: (decision: 'open' | 'cancel' | null) => void;
  const prompt = {
    decision:
      decision === 'pending'
        ? new Promise<'open' | 'cancel' | null>((resolve) => {
            decide = resolve;
          })
        : Promise.resolve(decision),
    cancelledWhileWaiting: new Promise<void>((resolve) => {
      cancelWaiting = resolve;
    }),
    dismiss: vi.fn(),
  };
  return { prompt, cancelWaiting, decide };
}

/**
 * Renderer progress seam (the `connecting` / `opening` dialog). The default
 * is the inert no-window handle: `cancelled` never settles, so the flow runs
 * exactly as it did without progress UI.
 */
const showInviteProgress = vi.fn();
vi.mock('../../../../main/invite-progress', () => ({
  get showInviteProgress() {
    return showInviteProgress;
  },
}));

/** A live progress handle whose Cancel the test presses with `cancel()`. */
function fakeProgress() {
  let cancel!: () => void;
  const handle = {
    update: vi.fn(),
    cancelled: new Promise<void>((resolve) => {
      cancel = resolve;
    }),
    dismiss: vi.fn(),
  };
  return { handle, cancel };
}

/** The `phase` of every `showInviteProgress` call, in order. */
function progressPhases(): string[] {
  return showInviteProgress.mock.calls.map(([payload]) => (payload as { phase: string }).phase);
}

/**
 * Renderer notice seam (failure + plaintext warning). Resolving `false` (the
 * default) is the unavailable-renderer path — the flow falls back to the
 * native box, which the pre-existing tests below exercise.
 */
const showInviteNotice = vi.fn();
vi.mock('../../../../main/invite-notice', () => ({
  get showInviteNotice() {
    return showInviteNotice;
  },
}));

const logLines: string[] = [];
vi.mock('$shared/logger', () => ({
  Logger: class {
    debug(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    info(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    warn(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
    error(...args: unknown[]) {
      logLines.push(JSON.stringify(args));
    }
  },
}));

import { PinMismatchError } from '../../../backend/main/backend-connection';
import {
  GuestEncryptionUnavailableError,
  GuestStoreCorruptError,
} from '../../../backend/main/guest-sessions-store';
import {
  InviteRpcError,
  InviteTransportError,
  type InviteTransportCode,
} from '../../../backend/main/invite-connection';
import { JsonRpcError } from '../../../backend/main/json-rpc-errors';
import { TC_ADDRESS } from '../../../../test/fixtures/tc-address.fixture';
import { handleInviteDeepLink, routeInviteLinkFromOs } from '../invite-deep-link';

const SECRET = 'invite-secret-value-xyz';
const TOKEN = 'minted-guest-token-value';
const BASE = 'intent://invite?v=1&host=192.168.1.10&port=8443&fp=AA:BB:CC';
const LINK = `${BASE}&inviteId=inv-1&secret=${SECRET}`;

/** `invite.challenge` result (PROTOCOL §5.44): the preview plus the single-use nonce. */
const CHALLENGE = {
  workspaceId: 'ws-1',
  workspaceTitle: 'Shared workspace',
  nonce: 'nonce-value-1',
  nonceExpiresAt: '2026-09-17T12:00:00Z',
};
const CREDENTIAL = {
  token: TOKEN,
  principalId: 'gh:42',
  login: 'octocat',
  workspaceId: 'ws-1',
};
/** `github.connect` result (PROTOCOL §5.27): the guest's own device flow. */
const CONNECT = {
  ok: true,
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
};
const PROOF = { gistId: 'gist0123abc', login: 'octocat' };

/** A local daemon refusal with a bounded `error.data.code` (PROTOCOL §9). */
function localRefusal(code: string): JsonRpcError {
  return new JsonRpcError({ code: -32603, message: `refused: secret=${SECRET}`, data: { code } });
}

/** A fresh connection mock carrying every method the flow may call. */
function fakeConnection(overrides: Record<string, unknown> = {}) {
  return {
    host: '192.168.1.10',
    via: 'direct',
    challenge,
    prove,
    inspect,
    accept,
    close,
    ...overrides,
  };
}

/** The signed-in guest daemon: every local method answers as the protocol documents. */
function signedInDaemon(): void {
  localMethods.clear();
  onLocal('github.getUser', () => ({ user: { login: 'octocat' } }));
  onLocal('github.identityProof.create', () => PROOF);
  onLocal('github.identityProof.delete', () => ({ ok: true }));
  onLocal('github.connect', () => CONNECT);
  onLocal('github.cancelAuth', () => ({ ok: true, cancelled: true }));
  onLocal('github.authStatus', () => ({ isConfigured: false, deviceFlow: { status: 'pending' } }));
}

/**
 * A guest daemon that is NOT signed in until `github:auth-changed`
 * (`authorized`) — or the poll — reports the device flow's end.
 */
function signedOutDaemon(): void {
  signedInDaemon();
  let signedIn = false;
  onLocal('github.getUser', () => ({ user: signedIn ? { login: 'octocat' } : null }));
  onLocal('github.identityProof.create', () => {
    if (!signedIn) throw localRefusal('github-not-connected');
    return PROOF;
  });
  onLocal('github.connect', () => CONNECT);
  notificationListeners.clear();
  const listener: NotificationHandler = (n) => {
    const event = (n.params as { event?: { type?: string; data?: { status?: string } } }).event;
    if (event?.type === 'github:auth-changed' && event.data?.status === 'authorized')
      signedIn = true;
  };
  // Runs before the flow's own listener (Set iteration order is insertion order).
  notificationListeners.add(listener);
}

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  notificationListeners.clear();
  signedInDaemon();
  appIsReady.mockReturnValue(true);
  showMessageBox.mockResolvedValue({ response: 0 });
  openExternal.mockResolvedValue(undefined);
  openInviteConnection.mockResolvedValue(fakeConnection());
  challenge.mockResolvedValue(CHALLENGE);
  prove.mockResolvedValue(CREDENTIAL);
  // Default: a first join on this host — no stored session.
  guestFindMatching.mockResolvedValue(null);
  guestGetDecryptedToken.mockResolvedValue(null);
  guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: true });
  openBackendWindow.mockResolvedValue({ id: 'guest-id' });
  showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);
  showInviteNotice.mockResolvedValue(false);
  showInviteProgress.mockImplementation(() => fakeProgress().handle);
});

describe('handleInviteDeepLink', () => {
  it('happy path: dial with pin → challenge → prove box → gist → prove → store GUEST session → delete gist → open window', async () => {
    await handleInviteDeepLink(`${LINK}&tc=ts.example:443`);

    expect(openInviteConnection).toHaveBeenCalledWith({
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'ts.example:443',
    });
    expect(challenge).toHaveBeenCalledWith('inv-1', SECRET);
    // The proof is made by the guest's OWN daemon with the host's nonce and label.
    expect(localCalls('github.identityProof.create')).toEqual([
      ['github.identityProof.create', { nonce: CHALLENGE.nonce, hostLabel: '192.168.1.10' }],
    ]);
    expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: PROOF.gistId,
      login: PROOF.login,
    });
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
    // No device flow of any kind: the guest was already signed in.
    expect(localCalls('github.connect')).toEqual([]);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    // Prove box only: no fingerprint confirmation, no failure dialog.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'question',
      message: expect.stringContaining(CHALLENGE.workspaceTitle),
    });
    expect((showMessageBox.mock.calls[0][0] as { message: string }).message).toContain('@octocat');

    expect(guestAdd).toHaveBeenCalledWith({
      label: '192.168.1.10',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'ts.example:443',
      principalId: 'gh:42',
      login: 'octocat',
      token: TOKEN,
      workspace: { id: 'ws-1', title: 'Shared workspace' },
    });
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('no dialog is shown before the prove box (the single consent point), and no gist before consent', async () => {
    const order: string[] = [];
    openInviteConnection.mockImplementation(async () => {
      order.push('dial');
      return fakeConnection();
    });
    challenge.mockImplementation(async () => {
      order.push('challenge');
      return CHALLENGE;
    });
    showMessageBox.mockImplementation(async () => {
      order.push('dialog');
      return { response: 0 };
    });
    onLocal('github.identityProof.create', () => {
      order.push('gist');
      return PROOF;
    });
    await handleInviteDeepLink(LINK);
    expect(order).toEqual(['dial', 'challenge', 'dialog', 'gist']);
  });

  it('cancelling the prove box aborts: no gist, nothing minted, connection closed', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 });
    await handleInviteDeepLink(LINK);
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not an invite uri', 'https://example.com/'],
    ['a pair uri', `intent://pair?v=1&host=h&port=8443&fp=AA:BB:CC&token=${TOKEN}`],
    ['missing secret', `${BASE}&inviteId=inv-1`],
    ['missing inviteId', `${BASE}&secret=${SECRET}`],
    [
      'neither host nor tunnel',
      `intent://invite?v=1&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}`,
    ],
    ['missing port', `intent://invite?v=1&host=h&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}`],
    ['missing fingerprint', `intent://invite?v=1&host=h&port=8443&inviteId=inv-1&secret=${SECRET}`],
  ])('rejects link with %s without dialing, storing, or crashing', async (_name, url) => {
    await expect(handleInviteDeepLink(url)).resolves.toBeUndefined();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(openInviteConnection).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('tunnel-only envelope (hosts=[] + tc, the daemon default) dials and stores by tc address', async () => {
    openInviteConnection.mockResolvedValue(fakeConnection({ host: 'tc-key-abc', via: 'tunnel' }));
    await handleInviteDeepLink(
      `intent://invite?v=1&host=&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}&tc=tc-key-abc`,
    );
    expect(openInviteConnection).toHaveBeenCalledWith({
      hosts: [],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'tc-key-abc',
    });
    expect(guestAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'tc-key-abc',
        hosts: [],
        tcAddress: 'tc-key-abc',
        token: TOKEN,
      }),
    );
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  // The daemon's tunnel-only invite omits `host` entirely (no empty `host=`):
  // the link must still parse to `hosts: []` and dial the tunnel.
  it('link with no host parameter (tunnel-only, tc mandatory) dials the tunnel and stores by tc address', async () => {
    openInviteConnection.mockResolvedValue(fakeConnection({ host: 'tc-key-abc', via: 'tunnel' }));
    await handleInviteDeepLink(
      `intent://invite?v=1&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}&tc=tc-key-abc`,
    );
    expect(openInviteConnection).toHaveBeenCalledWith({
      hosts: [],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'tc-key-abc',
    });
    expect(guestAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'tc-key-abc',
        hosts: [],
        tcAddress: 'tc-key-abc',
        token: TOKEN,
      }),
    );
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('warns when the credential had to be stored in plaintext, then still opens the window', async () => {
    guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: false });
    await handleInviteDeepLink(LINK);
    // Prove box + plaintext warning.
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'warning' });
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it.each([
    ['encryption unavailable (would downgrade)', new GuestEncryptionUnavailableError()],
    ['corrupt registry', new GuestStoreCorruptError()],
  ])(
    'store refusal — %s: failure dialog, bounded code logged, gist still deleted, no window',
    async (_name, error) => {
      guestAdd.mockRejectedValue(error);
      await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
      expect(openBackendWindow).not.toHaveBeenCalled();
      expect(showMessageBox.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
      expect(localCalls('github.identityProof.delete')).toHaveLength(1);
      const allLogs = logLines.join('\n');
      expect(allLogs).toContain(error.code);
      expect(allLogs).not.toContain(TOKEN);
    },
  );

  it('drops server-authored error text and unknown codes: only documented codes reach a log', async () => {
    challenge.mockRejectedValue(
      new InviteRpcError(-32602, { code: SECRET, detail: `secret=${SECRET} token=${TOKEN}` }),
    );
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(SECRET);
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).toContain('"inviteCode":null');
  });

  it('challenge refusal: shows a failure dialog, no gist, stores nothing, fails soft', async () => {
    challenge.mockRejectedValue(new InviteRpcError(-32001, { code: 'invite-expired' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    // Failure dialog only.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(logLines.join('\n')).toContain('invite-expired');
  });

  // Multiplayer guest caps (intent-hq/intentd#1917): the guest cap is spent
  // at join time — on `invite.prove`, after the gist is verified — so the
  // daemon refuses it with `-32602` / `workspace-full`. It is a documented
  // code — logged and given its own sentence, not the generic one.
  it('workspace-full prove refusal: distinct failure dialog, code logged, gist deleted, nothing stored', async () => {
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(challenge).toHaveBeenCalled();
    expect(prove).toHaveBeenCalledTimes(1);
    const fullDialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(fullDialog).toMatchObject({ type: 'error' });
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('workspace-full');

    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const genericDialog = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    expect(genericDialog.message).not.toBe(fullDialog.message);
  });

  // Same GitHub account on host and guest (intentd #1986): the host refuses
  // the proof with `owner-self-join` instead of minting the primary principal
  // a guest credential. A documented code — its own sentence, not the
  // generic one; no retry offer; nothing stored, no window.
  it('owner-self-join prove refusal: distinct failure dialog, code logged, gist deleted, nothing stored', async () => {
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'owner-self-join' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(challenge).toHaveBeenCalled();
    expect(prove).toHaveBeenCalledTimes(1);
    const selfDialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(selfDialog).toMatchObject({ type: 'error' });
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('"inviteCode":"owner-self-join"');

    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const genericDialog = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    expect(genericDialog.message).not.toBe(selfDialog.message);
  });

  // The host's own proof refusals (intentd #1967): each documented code gets
  // its own sentence, none of them the generic one, and the gist is deleted.
  it.each(['proof-invalid', 'proof-expired', 'github-unreachable'])(
    'host refuses the proof with %s: distinct failure dialog, code logged, gist deleted',
    async (code) => {
      prove.mockRejectedValue(new InviteRpcError(-32602, { code }));
      // `proof-expired` / `proof-invalid` offer one retry; decline it so the failure surfaces.
      showMessageBox.mockResolvedValue({ response: 1 });
      showMessageBox.mockResolvedValueOnce({ response: 0 });
      await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
      const dialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
      expect(localCalls('github.identityProof.delete')).toEqual([
        ['github.identityProof.delete', { gistId: PROOF.gistId }],
      ]);
      expect(guestAdd).not.toHaveBeenCalled();
      expect(openBackendWindow).not.toHaveBeenCalled();
      if (code === 'proof-expired' || code === 'proof-invalid') {
        // Declining the retry ends the flow quietly: the retry box was the last dialog.
        expect(dialog.type).toBe('question');
        expect(logLines.join('\n')).toContain('declined to retry');
        expect(logLines.join('\n')).toContain(`"code":"${code}"`);
        return;
      }
      expect(dialog.type).toBe('error');
      expect(logLines.join('\n')).toContain(`"inviteCode":"${code}"`);
      prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
      showMessageBox.mockResolvedValue({ response: 0 });
      await handleInviteDeepLink(LINK);
      const generic = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
      expect(dialog.message).not.toBe(generic.message);
    },
  );

  // The guest daemon's own refusals to publish the gist: bounded codes only,
  // never the daemon's message text (it could echo a token), each its own
  // sentence; nothing reaches the host.
  it.each(['github-unreachable', null])(
    'the guest daemon cannot publish the proof (code %s): failure dialog, nothing sent to the host',
    async (code) => {
      onLocal('github.identityProof.create', () => {
        throw code === null ? new Error(`boom token=${TOKEN}`) : localRefusal(code);
      });
      await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
      expect(prove).not.toHaveBeenCalled();
      expect(localCalls('github.identityProof.delete')).toEqual([]);
      expect(guestAdd).not.toHaveBeenCalled();
      const dialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
      expect(dialog.type).toBe('error');
      const allLogs = logLines.join('\n');
      expect(allLogs).toContain(`"proofCode":${JSON.stringify(code)}`);
      expect(allLogs).not.toContain(TOKEN);
      expect(allLogs).not.toContain(SECRET);
      expect(allLogs).not.toContain('boom');

      prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
      signedInDaemon();
      await handleInviteDeepLink(LINK);
      const generic = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
      expect(dialog.message).not.toBe(generic.message);
    },
  );

  it('a gist delete failure never fails the join and logs its bounded code only', async () => {
    onLocal('github.identityProof.delete', () => {
      throw localRefusal('github-unreachable');
    });
    await handleInviteDeepLink(LINK);
    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(logLines.join('\n')).toContain('Could not delete the identity proof gist'),
    );
    expect(logLines.join('\n')).toContain('"code":"github-unreachable"');
    expect(logLines.join('\n')).not.toContain(SECRET);
  });

  // Transport failures (spec "Round-4 field test"): each bounded code gets
  // its own sentence and reaches the log as the code, never as the socket
  // library's text.
  const TRANSPORT_CODES: InviteTransportCode[] = [
    'tailcat-unavailable',
    'tunnel-failed',
    'host-unreachable',
    'host-refused',
    'connection-closed',
  ];

  it.each(TRANSPORT_CODES)(
    'transport failure %s while dialing: failure dialog, code logged, nothing stored',
    async (code) => {
      openInviteConnection.mockRejectedValue(new InviteTransportError(code));
      await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
      // Failure dialog only — the dial failed before any consent point.
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
      expect(challenge).not.toHaveBeenCalled();
      expect(localCalls('github.identityProof.create')).toEqual([]);
      expect(guestAdd).not.toHaveBeenCalled();
      expect(openBackendWindow).not.toHaveBeenCalled();
      const allLogs = logLines.join('\n');
      expect(allLogs).toContain(`"transportCode":"${code}"`);
      expect(allLogs).not.toContain(SECRET);
    },
  );

  it('every transport code gets a distinct sentence, none of them the generic one', async () => {
    const messages = new Map<string, string>();
    for (const code of TRANSPORT_CODES) {
      openInviteConnection.mockRejectedValue(new InviteTransportError(code));
      await handleInviteDeepLink(LINK);
      const dialog = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
      messages.set(code, dialog.message);
    }
    // An unknown host refusal still gets the generic sentence.
    openInviteConnection.mockResolvedValue(fakeConnection());
    challenge.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await handleInviteDeepLink(LINK);
    const generic = (showMessageBox.mock.calls.at(-1)?.[0] as { message: string }).message;

    expect(new Set(messages.values()).size).toBe(TRANSPORT_CODES.length);
    for (const message of messages.values()) expect(message).not.toBe(generic);
  });

  it('a connection lost mid-prove surfaces as connection-closed, not as the generic sentence', async () => {
    prove.mockRejectedValue(new InviteTransportError('connection-closed'));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toHaveLength(1);
    expect(showMessageBox.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('"transportCode":"connection-closed"');
  });

  it('never logs the secret or the minted token, including when a step throws', async () => {
    guestAdd.mockRejectedValue(
      new Error(`persist failed: secret=${SECRET} token=${TOKEN} host=192.168.1.10`),
    );
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(SECRET);
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).not.toContain('persist failed');
    expect(allLogs).toContain('Invite deep link handling failed');
  });

  it('drops a concurrent invite link while one is in flight (single dialog)', async () => {
    let resolveDialog!: (v: { response: number }) => void;
    showMessageBox.mockReturnValueOnce(new Promise((resolve) => (resolveDialog = resolve)));
    const first = handleInviteDeepLink(LINK);
    const second = handleInviteDeepLink(LINK);
    await second;
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    expect(openInviteConnection).toHaveBeenCalledTimes(1);
    resolveDialog({ response: 0 });
    await first;
    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledTimes(1);
  });

  it('handles a subsequent link after the previous one settles', async () => {
    await handleInviteDeepLink(LINK);
    await handleInviteDeepLink(LINK);
    expect(guestAdd).toHaveBeenCalledTimes(2);
  });
});

describe('handleInviteDeepLink — renderer consent modal (prove)', () => {
  it('renderer happy path: show prove → join → gist → prove → dismiss joined, no native box, no code', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(`${LINK}&tc=ts.example:443`);

    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    const payload = showInviteConsent.mock.calls[0][0];
    expect(payload).toEqual({
      requestId: expect.any(String),
      mode: 'prove',
      login: 'octocat',
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(localCalls('github.connect')).toEqual([]);
    expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: PROOF.gistId,
      login: PROOF.login,
    });
    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a proof made under another account than consented to: gist deleted, consent asked again for that account, then proven', async () => {
    const first = fakeConsent('open');
    const second = fakeConsent('open');
    showInviteConsent.mockReturnValueOnce(first.prompt).mockReturnValueOnce(second.prompt);
    const otherProof = { gistId: 'gist-other', login: 'hubot' };
    onLocal('github.identityProof.create', () => otherProof);

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent).toHaveBeenCalledTimes(2);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'prove', login: 'octocat' });
    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ mode: 'prove', login: 'hubot' });
    expect(first.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
    // Nothing is proven to the host before the second consent.
    expect(prove).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: 'gist-other',
      login: 'hubot',
    });
    expect(localCalls('github.identityProof.create')).toHaveLength(2);
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: 'gist-other' }],
      ['github.identityProof.delete', { gistId: 'gist-other' }],
    ]);
    expect(second.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(guestAdd).toHaveBeenCalledTimes(1);
  });

  it('a proof made under another account, declined at the second prompt: nothing proven or stored', async () => {
    const first = fakeConsent('open');
    const second = fakeConsent('cancel');
    showInviteConsent.mockReturnValueOnce(first.prompt).mockReturnValueOnce(second.prompt);
    onLocal('github.identityProof.create', () => ({ gistId: 'gist-other', login: 'hubot' }));

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ mode: 'prove', login: 'hubot' });
    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: 'gist-other' }],
    ]);
    expect(second.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('dismisses joined before the store write, the plaintext warning and the window open', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    const order: string[] = [];
    guestAdd.mockImplementation(async () => {
      order.push('store');
      return { id: 'guest-id', tokenEncrypted: false };
    });
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showMessageBox.mockImplementation(async () => {
      order.push('warning');
      return { response: 0 };
    });
    openBackendWindow.mockImplementation(async () => {
      order.push('window');
      return { id: 'guest-id' };
    });
    await handleInviteDeepLink(LINK);
    expect(order).toEqual(['dismiss:joined', 'store', 'warning', 'window']);
  });

  it('cancel before join: dismiss cancelled, no gist, nothing stored, connection closed', async () => {
    const { prompt } = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(LINK);

    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel while the gist is being made: the gist is deleted, nothing is sent to the host', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    let releaseGist!: () => void;
    onLocal(
      'github.identityProof.create',
      () => new Promise((resolve) => (releaseGist = () => resolve(PROOF))),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(localCalls('github.identityProof.create')).toHaveLength(1));
    cancelWaiting();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseGist();
    await pending;

    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a cancel that lands while invite.prove is in flight is ignored: the prove answer is the point of no return', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    let releaseProve!: () => void;
    prove.mockReturnValue(new Promise((resolve) => (releaseProve = () => resolve(CREDENTIAL))));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(prove).toHaveBeenCalledTimes(1));
    cancelWaiting();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseProve();
    await pending;

    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
  });

  it('no renderer (null decision): the native prove box is the fallback and the join completes', async () => {
    showInviteConsent.mockReturnValue(fakeConsent(null).prompt);

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const box = showMessageBox.mock.calls[0][0] as { type: string; message: string };
    expect(box.type).toBe('question');
    expect(box.message).toContain('@octocat');
    expect(box.message).toContain(CHALLENGE.workspaceTitle);
    expect(box.message).not.toContain(CONNECT.userCode);
    expect(openExternal).not.toHaveBeenCalled();
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('prove refusal after join: dismiss failed before the failure box, gist deleted', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'github-unreachable' }));
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showMessageBox.mockImplementation(async () => {
      order.push('failure-box');
      return { response: 0 };
    });

    await handleInviteDeepLink(LINK);

    expect(order).toEqual(['dismiss:failed', 'failure-box']);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(localCalls('github.identityProof.delete')).toHaveLength(1);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  // Both host refusals restart the challenge: a nonce purged by a later
  // challenge surfaces as `proof-invalid`, not `proof-expired`.
  it.each(['proof-expired', 'proof-invalid'])(
    '%s once: the prove prompt is dismissed failed, Retry re-challenges without a second consent and joins',
    async (code) => {
      const { prompt } = fakeConsent('open');
      showInviteConsent.mockReturnValue(prompt);
      prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code }));
      challenge.mockResolvedValueOnce(CHALLENGE).mockResolvedValueOnce({
        ...CHALLENGE,
        nonce: 'nonce-value-2',
      });

      await handleInviteDeepLink(LINK);

      expect(showInviteConsent).toHaveBeenCalledTimes(1);
      expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
      // The retry box is the only native dialog.
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'question' });
      expect(challenge).toHaveBeenCalledTimes(2);
      expect(localCalls('github.identityProof.create').map(([, params]) => params)).toEqual([
        { nonce: 'nonce-value-1', hostLabel: '192.168.1.10' },
        { nonce: 'nonce-value-2', hostLabel: '192.168.1.10' },
      ]);
      expect(prove).toHaveBeenLastCalledWith('inv-1', SECRET, {
        nonce: 'nonce-value-2',
        gistId: PROOF.gistId,
        login: PROOF.login,
      });
      // Both gists are deleted: the refused one and the accepted one.
      expect(localCalls('github.identityProof.delete')).toHaveLength(2);
      expect(guestAdd).toHaveBeenCalledTimes(1);
      expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    },
  );

  it('the retry box names the refusal: expired and invalid read differently', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    showMessageBox.mockResolvedValue({ response: 1 });
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'proof-expired' }));
    await handleInviteDeepLink(LINK);
    const expired = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'proof-invalid' }));
    await handleInviteDeepLink(LINK);
    const invalid = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(expired.message).not.toBe(invalid.message);
  });

  it.each(['proof-expired', 'proof-invalid'])(
    '%s twice: the second refusal is a failure, not another retry box',
    async (code) => {
      showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
      prove.mockRejectedValue(new InviteRpcError(-32602, { code }));

      await handleInviteDeepLink(LINK);

      expect(challenge).toHaveBeenCalledTimes(2);
      expect(prove).toHaveBeenCalledTimes(2);
      // Retry box, then the failure box.
      expect(showMessageBox).toHaveBeenCalledTimes(2);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'question' });
      expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });
      expect(guestAdd).not.toHaveBeenCalled();
      expect(logLines.join('\n')).toContain(`"inviteCode":"${code}"`);
    },
  );

  // A mixed pair is still one retry: the bound is per join, not per code.
  it('proof-expired then proof-invalid: one retry box, then the failure', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    prove
      .mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-expired' }))
      .mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-invalid' }));

    await handleInviteDeepLink(LINK);

    expect(challenge).toHaveBeenCalledTimes(2);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('"inviteCode":"proof-invalid"');
    expect(guestAdd).not.toHaveBeenCalled();
  });
});

// The guest's own sign-in (intentd #1967): when the guest daemon is not
// connected to GitHub — or its token lacks the `gist` scope — the modal's
// `sign-in-required` state runs the guest's OWN `github.connect` device flow;
// the join's `prove` prompt follows once the daemon is signed in.
describe('handleInviteDeepLink — sign-in required', () => {
  beforeEach(() => {
    signedOutDaemon();
  });

  it('not connected: connect → sign-in modal → open → authorized → prove modal (supersedes) → join', async () => {
    const signIn = fakeConsent('open');
    const prove2 = fakeConsent('open');
    showInviteConsent.mockReturnValueOnce(signIn.prompt).mockReturnValueOnce(prove2.prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(localCalls('github.identityProof.create')).toEqual([]);
    emitAuthChanged('authorized');
    await pending;

    expect(localCalls('github.connect')).toHaveLength(1);
    expect(showInviteConsent).toHaveBeenCalledTimes(2);
    expect(showInviteConsent.mock.calls[0][0]).toEqual({
      requestId: expect.any(String),
      mode: 'sign-in-required',
      reason: 'not-connected',
      userCode: CONNECT.userCode,
      verificationUri: CONNECT.verificationUri,
      expiresInMs: CONNECT.expiresIn * 1000,
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(JSON.stringify(showInviteConsent.mock.calls[0][0])).not.toContain(SECRET);
    expect(clipboardWriteText).toHaveBeenCalledWith(CONNECT.userCode);
    expect(openExternal).toHaveBeenCalledWith(CONNECT.verificationUri);
    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ mode: 'prove', login: 'octocat' });
    // The sign-in prompt is ended as superseded once the prove prompt is up.
    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(prove2.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(prove).toHaveBeenCalledTimes(1);
    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(localCalls('github.cancelAuth')).toEqual([]);
  });

  it('the poll settles the wait when the event is missed', async () => {
    let flow = 'pending';
    let signedIn = false;
    onLocal('github.authStatus', () => ({ isConfigured: signedIn, deviceFlow: { status: flow } }));
    onLocal('github.getUser', () => ({ user: signedIn ? { login: 'octocat' } : null }));
    onLocal('github.identityProof.create', () => {
      if (!signedIn) throw localRefusal('github-not-connected');
      return PROOF;
    });
    showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    signedIn = true;
    flow = 'authorized';
    await pending;

    expect(localCalls('github.authStatus').length).toBeGreaterThanOrEqual(1);
    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  }, 15_000);

  it('scope missing: a signed-in guest whose token lacks gist → sign-in modal names the reason → re-prove after', async () => {
    signedInDaemon();
    let scoped = false;
    onLocal('github.identityProof.create', () => {
      if (!scoped) throw localRefusal('github-scope-missing');
      return PROOF;
    });
    notificationListeners.add((n) => {
      const event = (n.params as { event?: { data?: { status?: string } } }).event;
      if (event?.data?.status === 'authorized') scoped = true;
    });
    const prove1 = fakeConsent('open');
    const signIn = fakeConsent('open');
    const prove2 = fakeConsent('open');
    showInviteConsent
      .mockReturnValueOnce(prove1.prompt)
      .mockReturnValueOnce(signIn.prompt)
      .mockReturnValueOnce(prove2.prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await pending;

    expect(showInviteConsent).toHaveBeenCalledTimes(3);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'prove' });
    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({
      mode: 'sign-in-required',
      reason: 'scope-missing',
    });
    expect(showInviteConsent.mock.calls[2][0]).toMatchObject({ mode: 'prove', login: 'octocat' });
    expect(prove1.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(prove2.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(localCalls('github.identityProof.create')).toHaveLength(2);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it.each([
    ['denied', 'sign-in-denied', 0],
    ['expired', 'sign-in-expired', 1],
    ['error', 'sign-in-failed', 0],
  ] as const)(
    'device flow ends %s: dismiss failed, failure box, no gist, nothing stored',
    async (status, flowCode, cancelAuthCalls) => {
      const signIn = fakeConsent('open');
      showInviteConsent.mockReturnValue(signIn.prompt);

      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
      emitAuthChanged(status);
      await pending;

      expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
      expect(localCalls('github.identityProof.create')).toEqual([]);
      expect(prove).not.toHaveBeenCalled();
      expect(guestAdd).not.toHaveBeenCalled();
      expect(localCalls('github.cancelAuth')).toHaveLength(cancelAuthCalls);
      expect(logLines.join('\n')).toContain(`"flowCode":"${flowCode}"`);
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it('every sign-in failure gets a distinct sentence, none of them the generic one', async () => {
    const messages = new Map<string, string>();
    for (const status of ['denied', 'expired', 'error'] as const) {
      showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(openExternal).toHaveBeenCalled());
      openExternal.mockClear();
      emitAuthChanged(status);
      await pending;
      messages.set(status, (showMessageBox.mock.calls.at(-1)?.[0] as { message: string }).message);
    }
    signedInDaemon();
    challenge.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await handleInviteDeepLink(LINK);
    const generic = (showMessageBox.mock.calls.at(-1)?.[0] as { message: string }).message;
    expect(new Set(messages.values()).size).toBe(3);
    for (const message of messages.values()) expect(message).not.toBe(generic);
  });

  it('cancel before "Open GitHub": dismiss cancelled, the device flow is cancelled, nothing opened', async () => {
    const signIn = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(signIn.prompt);

    await handleInviteDeepLink(LINK);

    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(localCalls('github.cancelAuth')).toHaveLength(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel while waiting for GitHub: aborts, cancels the device flow, a late authorized is dropped', async () => {
    const signIn = fakeConsent('open');
    showInviteConsent.mockReturnValue(signIn.prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    signIn.cancelWaiting();
    await pending;
    emitAuthChanged('authorized');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(localCalls('github.cancelAuth')).toHaveLength(1);
    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel while the browser launch never settles: aborts and closes the connection', async () => {
    const signIn = fakeConsent('open');
    showInviteConsent.mockReturnValue(signIn.prompt);
    openExternal.mockReturnValue(new Promise<void>(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    signIn.cancelWaiting();
    await pending;

    expect(signIn.prompt.dismiss).toHaveBeenCalledWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('launch failure after open: dismiss failed, the failure box, the device flow cancelled', async () => {
    const signIn = fakeConsent('open');
    showInviteConsent.mockReturnValue(signIn.prompt);
    openExternal.mockRejectedValue(new Error('no browser'));

    await handleInviteDeepLink(LINK);

    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(localCalls('github.cancelAuth')).toHaveLength(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('verification-launch-failed');
  });

  it('no renderer: the native device-code box, then the native prove box, and the join completes', async () => {
    showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await pending;

    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'info',
      message: expect.stringContaining(CONNECT.userCode),
    });
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({
      type: 'question',
      message: expect.stringContaining('@octocat'),
    });
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('cancelling the native device-code box cancels the device flow and aborts', async () => {
    showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);
    showMessageBox.mockResolvedValueOnce({ response: 1 });

    await handleInviteDeepLink(LINK);

    expect(openExternal).not.toHaveBeenCalled();
    expect(localCalls('github.cancelAuth')).toHaveLength(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  // The device flow is awaited from the moment the code is shown, not from
  // "Open GitHub": a user who types the code on another device never has to
  // click the button — the flow's end settles the prompt on its own.
  describe('the wait starts when the code is shown', () => {
    it('modal: authorized (event) while no button was clicked → prove prompt, browser never opened', async () => {
      const signIn = fakeConsent('pending');
      const prove2 = fakeConsent('open');
      showInviteConsent.mockReturnValueOnce(signIn.prompt).mockReturnValueOnce(prove2.prompt);

      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(showInviteConsent).toHaveBeenCalledTimes(1));
      expect(clipboardWriteText).toHaveBeenCalledWith(CONNECT.userCode);
      emitAuthChanged('authorized');
      await pending;

      expect(openExternal).not.toHaveBeenCalled();
      expect(showInviteConsent).toHaveBeenCalledTimes(2);
      expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'sign-in-required' });
      expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ mode: 'prove', login: 'octocat' });
      expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
      expect(prove2.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
      expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
      expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
      expect(localCalls('github.cancelAuth')).toEqual([]);
      expect(showMessageBox).not.toHaveBeenCalled();
    });

    it('modal: authorized via the poll (no event) while no button was clicked → same result', async () => {
      // The daemon reports the flow's end only to the poll — no event is emitted.
      let signedIn = false;
      onLocal('github.authStatus', () => {
        signedIn = true;
        return { isConfigured: true, deviceFlow: { status: 'authorized' } };
      });
      onLocal('github.getUser', () => ({ user: signedIn ? { login: 'octocat' } : null }));
      onLocal('github.identityProof.create', () => {
        if (!signedIn) throw localRefusal('github-not-connected');
        return PROOF;
      });
      const signIn = fakeConsent('pending');
      const prove2 = fakeConsent('open');
      showInviteConsent.mockReturnValueOnce(signIn.prompt).mockReturnValueOnce(prove2.prompt);

      await handleInviteDeepLink(LINK);

      expect(localCalls('github.authStatus').length).toBeGreaterThanOrEqual(1);
      expect(openExternal).not.toHaveBeenCalled();
      expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
      expect(prove2.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
      expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
      expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    }, 15_000);

    it('modal: denied while no button was clicked → sign-in-denied failure, browser never opened', async () => {
      const signIn = fakeConsent('pending');
      showInviteConsent.mockReturnValue(signIn.prompt);

      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(showInviteConsent).toHaveBeenCalledTimes(1));
      emitAuthChanged('denied');
      await pending;

      expect(openExternal).not.toHaveBeenCalled();
      expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
      expect(localCalls('github.identityProof.create')).toEqual([]);
      expect(guestAdd).not.toHaveBeenCalled();
      expect(logLines.join('\n')).toContain('"flowCode":"sign-in-denied"');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('modal: cancel while no button was clicked → the device flow is cancelled and the listener and poll stop', async () => {
      vi.useFakeTimers();
      try {
        const baselineListeners = notificationListeners.size;
        const signIn = fakeConsent('pending');
        let shown!: () => void;
        const consentShown = new Promise<void>((resolve) => {
          shown = resolve;
        });
        showInviteConsent.mockImplementation(() => {
          shown();
          return signIn.prompt;
        });

        const pending = handleInviteDeepLink(LINK);
        await consentShown;
        // The flow's own `github:auth-changed` listener is attached at show time.
        expect(notificationListeners.size).toBe(baselineListeners + 1);

        signIn.decide('cancel');
        await pending;

        expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
        expect(localCalls('github.cancelAuth')).toHaveLength(1);
        expect(notificationListeners.size).toBe(baselineListeners);
        expect(openExternal).not.toHaveBeenCalled();

        // Neither a late event nor the poll revives the flow.
        emitAuthChanged('authorized');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(localCalls('github.authStatus')).toEqual([]);
        expect(localCalls('github.identityProof.create')).toEqual([]);
        expect(guestAdd).not.toHaveBeenCalled();
        expect(showMessageBox).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('native box: authorized while the box is open closes it through its abort signal and the join proceeds', async () => {
      showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);
      // The mock box resolves only through its abort signal. A missing
      // abort-driven close would not hang the flow (`settled` still wins the
      // race); the `order` assertion below is what proves the box was closed
      // before the prove prompt and `guest.add`.
      const order: string[] = [];
      showMessageBox.mockImplementationOnce(
        (options: { cancelId: number; signal?: AbortSignal }) =>
          new Promise<{ response: number }>((resolve) => {
            options.signal?.addEventListener('abort', () => {
              order.push('device-code-box-closed');
              resolve({ response: options.cancelId });
            });
          }),
      );
      showMessageBox.mockImplementationOnce(async () => {
        order.push('prove-box');
        return { response: 0 };
      });
      guestAdd.mockImplementation(async () => {
        order.push('guest.add');
        return { id: 'guest-id', tokenEncrypted: true };
      });

      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({
        type: 'info',
        message: expect.stringContaining(CONNECT.userCode),
      });
      expect(order).toEqual([]);
      emitAuthChanged('authorized');
      await pending;

      expect(order).toEqual(['device-code-box-closed', 'prove-box', 'guest.add']);
      expect(openExternal).not.toHaveBeenCalled();
      expect(showMessageBox).toHaveBeenCalledTimes(2);
      expect(showMessageBox.mock.calls[1][0]).toMatchObject({
        type: 'question',
        message: expect.stringContaining('@octocat'),
      });
      expect(localCalls('github.cancelAuth')).toEqual([]);
      expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
      expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    });

    it('native box: a rejected box before the flow ends releases the listener and poll, and a failure is shown', async () => {
      vi.useFakeTimers();
      try {
        const baselineListeners = notificationListeners.size;
        showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);
        showMessageBox.mockImplementationOnce(() => Promise.reject(new Error('dialog closed')));

        await handleInviteDeepLink(LINK);

        expect(notificationListeners.size).toBe(baselineListeners);
        expect(openExternal).not.toHaveBeenCalled();
        expect(showMessageBox).toHaveBeenCalledTimes(2);
        expect(showMessageBox.mock.calls[0][0]).toMatchObject({
          type: 'info',
          message: expect.stringContaining(CONNECT.userCode),
        });
        expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });

        // Neither a late event nor the poll revives the flow.
        emitAuthChanged('authorized');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(localCalls('github.authStatus')).toEqual([]);
        expect(localCalls('github.identityProof.create')).toEqual([]);
        expect(guestAdd).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('a refused verification URL never reaches the modal or the browser', async () => {
    onLocal('github.connect', () => ({
      ...CONNECT,
      verificationUri: 'http://github.com/login/device',
    }));
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('invalid-verification-uri');
  });

  it('github.connect refused by the guest daemon: sign-in-failed, its text never logged', async () => {
    onLocal('github.connect', () => {
      throw localRefusal('github-unreachable');
    });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    const allLogs = logLines.join('\n');
    expect(allLogs).toContain('"flowCode":"sign-in-failed"');
    expect(allLogs).not.toContain(SECRET);
  });

  it('still refused after a completed sign-in: failure with the bounded proof code, no second sign-in prompt', async () => {
    onLocal('github.identityProof.create', () => {
      throw localRefusal('github-not-connected');
    });
    const signIn = fakeConsent('open');
    const prove2 = fakeConsent('open');
    showInviteConsent.mockReturnValueOnce(signIn.prompt).mockReturnValueOnce(prove2.prompt);

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await pending;

    expect(showInviteConsent).toHaveBeenCalledTimes(2);
    expect(localCalls('github.connect')).toHaveLength(1);
    expect(prove2.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(prove).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('"proofCode":"github-not-connected"');
  });
});

// The prompt reads `Join “<title>” on <host>`: the host is the daemon's pretty
// name when the challenge carries one (an older daemon omits both name fields
// → the dialed address), and a blank title reads "Untitled" — while the
// stored guest session keeps the raw title (its settings row applies the same
// fallback). The same label is the gist's `hostLabel`.
describe('handleInviteDeepLink — consent prompt labels', () => {
  it('names the host by its pretty name when the challenge carries one, in the modal and the gist', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    challenge.mockResolvedValue({
      ...CHALLENGE,
      hostname: 'clements-mbp.local',
      prettyHostname: 'Clement’s MacBook Pro',
    });

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({
      hostLabel: 'Clement’s MacBook Pro',
      workspaceTitle: CHALLENGE.workspaceTitle,
    });
    expect(localCalls('github.identityProof.create')[0][1]).toMatchObject({
      hostLabel: 'Clement’s MacBook Pro',
    });
  });

  it('falls back to the plain hostname, then the dialed address, when the pretty name is blank or absent', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    challenge.mockResolvedValue({
      ...CHALLENGE,
      hostname: 'clements-mbp.local',
      prettyHostname: '  ',
    });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ hostLabel: 'clements-mbp.local' });

    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    challenge.mockResolvedValue(CHALLENGE);
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ hostLabel: '192.168.1.10' });
  });

  it('reads "Unknown host" when the only address is an opaque tc address (modal and gist), and stores the tc address raw', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    openInviteConnection.mockResolvedValue(fakeConnection({ host: TC_ADDRESS, via: 'tunnel' }));

    await handleInviteDeepLink(
      `intent://invite?v=1&host=&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}&tc=${TC_ADDRESS}`,
    );

    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ hostLabel: 'Unknown host' });
    expect(localCalls('github.identityProof.create')[0][1]).toMatchObject({
      hostLabel: 'Unknown host',
    });
    expect(guestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ label: TC_ADDRESS, host: TC_ADDRESS, tcAddress: TC_ADDRESS }),
    );
  });

  it('a blank workspace title reads "Untitled" in the modal and the native box, but is stored raw', async () => {
    showInviteConsent.mockReturnValue(fakeConsent(null).prompt);
    challenge.mockResolvedValue({ ...CHALLENGE, workspaceTitle: '   ' });

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ workspaceTitle: 'Untitled' });
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'question',
      message: expect.stringContaining('“Untitled”'),
    });
    expect(guestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: { id: 'ws-1', title: '   ' } }),
    );
  });
});

// The prove answer is the point of no return (PR #2513 review): once it
// resolves the host has minted the credential and consumed a seat, so a
// Cancel that lands while the guest-session write is still pending must not
// be honoured — and must not be reported to the UI as a cancellation either.
// Drives the REAL `main/invite-consent.ts` response handler so the path is
// the renderer's.
describe('handleInviteDeepLink — cancel after the grant is a no-op', () => {
  let realConsent: typeof import('../../../../main/invite-consent');
  const send = vi.fn();
  const rendererWindow = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send, once: vi.fn(), removeListener: vi.fn() },
  };

  function dismissesSent(): unknown[] {
    return send.mock.calls
      .filter(([channel]) => channel === 'invite-consent:dismiss')
      .map(([, payload]) => payload);
  }

  beforeAll(async () => {
    realConsent = await vi.importActual('../../../../main/invite-consent');
  });

  beforeEach(() => {
    realConsent.resetInviteConsentStateForTests();
    showInviteConsent.mockImplementation((payload) =>
      realConsent.showInviteConsent(payload, { getParentWindow: () => rendererWindow as never }),
    );
  });

  async function showAndAck(): Promise<{
    requestId: string;
    response: IpcInvokeHandler;
  }> {
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('invite-consent:show', expect.anything()),
    );
    const { requestId } = send.mock.calls[0][1] as { requestId: string };
    await registeredIpcHandlers.get('invite-consent:ack')!({}, { requestId });
    return { requestId, response: registeredIpcHandlers.get('invite-consent:response')! };
  }

  it('hold the store write → ack → join → cancel → release: stored, opened, dismissed joined once', async () => {
    let releaseStore!: () => void;
    guestAdd.mockReturnValue(
      new Promise((resolve) => {
        releaseStore = () => resolve({ id: 'guest-id', tokenEncrypted: true });
      }),
    );

    const pending = handleInviteDeepLink(LINK);
    const { requestId, response } = await showAndAck();
    expect(send.mock.calls[0][1]).toMatchObject({ mode: 'prove', login: 'octocat' });
    await response({}, { requestId, action: 'open' });
    await vi.waitFor(() => expect(guestAdd).toHaveBeenCalledTimes(1));
    // The prove answer resolved and the store write is in flight: the modal
    // must already be out of its waiting state before the user can cancel.
    expect(dismissesSent()).toEqual([{ requestId, outcome: 'joined' }]);

    await response({}, { requestId, action: 'cancel' });
    releaseStore();
    await pending;

    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(dismissesSent()).toEqual([{ requestId, outcome: 'joined' }]);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    const allLogs = logLines.join('\n');
    expect(allLogs).toContain('cancel-after-grant');
    expect(allLogs).not.toContain('User cancelled');
  });

  it('a cancel while the gist is being made still aborts through the real response handler', async () => {
    let releaseGist!: () => void;
    onLocal(
      'github.identityProof.create',
      () => new Promise((resolve) => (releaseGist = () => resolve(PROOF))),
    );

    const pending = handleInviteDeepLink(LINK);
    const { requestId, response } = await showAndAck();
    await response({}, { requestId, action: 'open' });
    await vi.waitFor(() => expect(localCalls('github.identityProof.create')).toHaveLength(1));
    await response({}, { requestId, action: 'cancel' });
    releaseGist();
    await pending;

    expect(dismissesSent()).toEqual([{ requestId, outcome: 'cancelled' }]);
    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toHaveLength(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).not.toContain('cancel-after-grant');
  });

  it('prove resolves while a cancel is in flight: dismissed joined at once, the cancel is a no-op', async () => {
    let releaseProve!: () => void;
    prove.mockReturnValue(new Promise((resolve) => (releaseProve = () => resolve(CREDENTIAL))));

    const pending = handleInviteDeepLink(LINK);
    const { requestId, response } = await showAndAck();
    await response({}, { requestId, action: 'open' });
    await vi.waitFor(() => expect(prove).toHaveBeenCalledTimes(1));
    releaseProve();
    await vi.waitFor(() => expect(dismissesSent()).toEqual([{ requestId, outcome: 'joined' }]));
    await response({}, { requestId, action: 'cancel' });
    await pending;

    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(dismissesSent()).toEqual([{ requestId, outcome: 'joined' }]);
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('cancel-after-grant');
  });

  it('sign-in then prove: the sign-in request is dismissed superseded only after the prove request is shown', async () => {
    signedOutDaemon();

    const pending = handleInviteDeepLink(LINK);
    const { requestId: signInId, response } = await showAndAck();
    expect(send.mock.calls[0][1]).toMatchObject({ mode: 'sign-in-required' });
    await response({}, { requestId: signInId, action: 'open' });
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await vi.waitFor(() =>
      expect(send.mock.calls.filter(([c]) => c === 'invite-consent:show')).toHaveLength(2),
    );
    const shows = send.mock.calls.filter(([c]) => c === 'invite-consent:show');
    const { requestId: proveId } = shows[1][1] as { requestId: string };
    expect(shows[1][1]).toMatchObject({ mode: 'prove', login: 'octocat' });
    const showIndex = send.mock.calls.findIndex(
      ([c, p]) => c === 'invite-consent:show' && p === shows[1][1],
    );
    const supersededIndex = send.mock.calls.findIndex(
      ([c, p]) =>
        c === 'invite-consent:dismiss' && (p as { requestId: string }).requestId === signInId,
    );
    expect(supersededIndex).toBeGreaterThan(showIndex);
    expect(send.mock.calls[supersededIndex][1]).toEqual({
      requestId: signInId,
      outcome: 'superseded',
    });

    await registeredIpcHandlers.get('invite-consent:ack')!({}, { requestId: proveId });
    await response({}, { requestId: proveId, action: 'open' });
    await pending;

    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(dismissesSent().at(-1)).toEqual({ requestId: proveId, outcome: 'joined' });
  });
});

// Returning guest (spec "Returning guest: per-host reuse"): a stored
// credential for the host skips the identity proof — `invite.inspect`
// previews the invite, a confirm-only prompt replaces the prove prompt, and
// `invite.accept` joins with the stored token. Every miss (no session, no
// token, undecryptable token, credential refused) falls through to the
// identity proof without an extra prompt; a workspace already listed on the
// session just opens.
describe('handleInviteDeepLink — returning guest', () => {
  const STORED_TOKEN = 'stored-guest-token-value';
  const SESSION = {
    id: 'guest-id',
    label: '192.168.1.10',
    host: '192.168.1.10',
    hosts: ['192.168.1.10'],
    port: 8443,
    fingerprint: 'AA:BB:CC',
    tcAddress: null,
    hostname: null,
    principalId: 'gh:42',
    login: 'octocat',
    tokenEncrypted: true,
    workspaces: [{ id: 'ws-0', title: 'First workspace' }],
    updatedAt: 1,
  };
  const INSPECTION = {
    workspaceId: 'ws-1',
    workspaceTitle: 'Shared workspace',
    hostname: 'studio.local',
    prettyHostname: 'Studio',
  };
  const ACCEPTED = { ...CREDENTIAL, token: 'fresh-guest-token-value' };

  beforeEach(() => {
    guestFindMatching.mockResolvedValue(SESSION);
    guestGetDecryptedToken.mockResolvedValue(STORED_TOKEN);
    inspect.mockResolvedValue(INSPECTION);
    accept.mockResolvedValue(ACCEPTED);
  });

  /** No identity proof of any kind ran. */
  function expectNoProof(): void {
    expect(challenge).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('github.connect')).toEqual([]);
  }

  it('renderer happy path: inspect → confirm prompt → accept → store over the old record → open', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(`${LINK}&tc=ts.example:443`);

    expect(guestFindMatching).toHaveBeenCalledWith({
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
    });
    expect(guestGetDecryptedToken).toHaveBeenCalledWith('guest-id');
    expect(inspect).toHaveBeenCalledWith('inv-1', SECRET);
    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    const payload = showInviteConsent.mock.calls[0][0];
    expect(payload).toEqual({
      requestId: expect.any(String),
      mode: 'confirm',
      login: 'octocat',
      workspaceTitle: 'Shared workspace',
      hostLabel: 'Studio',
    });
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain(STORED_TOKEN);
    expect(accept).toHaveBeenCalledWith('inv-1', SECRET, STORED_TOKEN);
    expectNoProof();
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    // The store's same-daemon upsert takes the fresh token and appends the workspace.
    expect(guestAdd).toHaveBeenCalledWith({
      label: '192.168.1.10',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'ts.example:443',
      principalId: 'gh:42',
      login: 'octocat',
      token: 'fresh-guest-token-value',
      workspace: { id: 'ws-1', title: 'Shared workspace' },
    });
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('same host:port, different pinned fingerprint: the stored token is never decrypted or sent; the proof runs', async () => {
    // The store's host:port fallback hands back the record pinned to the
    // previous cert at this address; the link is pinned to a different daemon.
    guestFindMatching.mockResolvedValue({ ...SESSION, fingerprint: 'DD:EE:FF' });
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(LINK);

    expect(guestFindMatching).toHaveBeenCalledWith({
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
    });
    expect(guestGetDecryptedToken).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(challenge).toHaveBeenCalledWith('inv-1', SECRET);
    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'prove' });
    expect(guestAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: TOKEN }));
    expect(logLines.join('\n')).toContain('"reason":"fingerprint-mismatch"');
    expect(logLines.join('\n')).not.toContain(STORED_TOKEN);
  });

  it('a stored record without a fingerprint never has its token reused', async () => {
    guestFindMatching.mockResolvedValue({ ...SESSION, fingerprint: '' });
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);

    await handleInviteDeepLink(LINK);

    expect(guestGetDecryptedToken).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(challenge).toHaveBeenCalledWith('inv-1', SECRET);
    expect(logLines.join('\n')).toContain('"reason":"fingerprint-mismatch"');
  });

  it('same fingerprint at a new address (spelled differently): still the confirm-only path', async () => {
    guestFindMatching.mockResolvedValue({
      ...SESSION,
      host: '10.0.0.5',
      hosts: ['10.0.0.5'],
      fingerprint: 'aabbcc',
    });
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);

    await handleInviteDeepLink(LINK);

    expect(guestGetDecryptedToken).toHaveBeenCalledWith('guest-id');
    expect(inspect).toHaveBeenCalledWith('inv-1', SECRET);
    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'confirm', login: 'octocat' });
    expect(accept).toHaveBeenCalledWith('inv-1', SECRET, STORED_TOKEN);
    expectNoProof();
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('a tunnel-only link matches the session keyed on the tc address', async () => {
    openInviteConnection.mockResolvedValue(fakeConnection({ host: 'tc-key-abc', via: 'tunnel' }));
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);

    await handleInviteDeepLink(
      `intent://invite?v=1&host=&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}&tc=tc-key-abc`,
    );

    expect(guestFindMatching).toHaveBeenCalledWith({
      hosts: ['tc-key-abc'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
    });
    expect(accept).toHaveBeenCalledWith('inv-1', SECRET, STORED_TOKEN);
    expectNoProof();
  });

  it('already a member of the invited workspace: no prompt, no accept, the window opens', async () => {
    inspect.mockResolvedValue({ ...INSPECTION, workspaceId: 'ws-0' });

    await handleInviteDeepLink(LINK);

    expect(inspect).toHaveBeenCalledWith('inv-1', SECRET);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel on the confirm prompt: dismiss cancelled, nothing accepted, stored, or opened', async () => {
    const { prompt } = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(LINK);

    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(accept).not.toHaveBeenCalled();
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel while the accept is pending: dismiss cancelled, nothing stored or opened', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    let settleAccept!: (value: typeof ACCEPTED) => void;
    accept.mockReturnValue(new Promise((resolve) => (settleAccept = resolve)));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    cancelWaiting();
    await pending;
    settleAccept(ACCEPTED);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expectNoProof();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('an older daemon on a tunnel: the confirm prompt reads "Unknown host", never the tc address', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    openInviteConnection.mockResolvedValue(fakeConnection({ host: TC_ADDRESS, via: 'tunnel' }));
    inspect.mockResolvedValue({ workspaceId: 'ws-1', workspaceTitle: 'Shared workspace' });

    await handleInviteDeepLink(
      `intent://invite?v=1&host=&port=8443&fp=AA:BB:CC&inviteId=inv-1&secret=${SECRET}&tc=${TC_ADDRESS}`,
    );

    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({
      mode: 'confirm',
      hostLabel: 'Unknown host',
    });
    expect(JSON.stringify(showInviteConsent.mock.calls[0][0])).not.toContain(TC_ADDRESS);
    expect(accept).toHaveBeenCalledWith('inv-1', SECRET, STORED_TOKEN);
  });

  it('no renderer: the native confirm box (no device code) is the fallback and the join completes', async () => {
    showInviteConsent.mockReturnValue(fakeConsent(null).prompt);

    await handleInviteDeepLink(LINK);

    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const box = showMessageBox.mock.calls[0][0] as { type: string; message: string };
    expect(box.type).toBe('question');
    expect(box.message).toContain('@octocat');
    expect(box.message).toContain('Shared workspace');
    expect(box.message).not.toContain(CONNECT.userCode);
    expect(accept).toHaveBeenCalledWith('inv-1', SECRET, STORED_TOKEN);
    expectNoProof();
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('cancelling the native confirm box aborts without accepting', async () => {
    showInviteConsent.mockReturnValue(fakeConsent(null).prompt);
    showMessageBox.mockResolvedValueOnce({ response: 1 });

    await handleInviteDeepLink(LINK);

    expect(accept).not.toHaveBeenCalled();
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('credential-invalid on accept: the confirm prompt is dismissed and the proof runs, no extra prompt', async () => {
    const confirmPrompt = fakeConsent('open').prompt;
    const provePrompt = fakeConsent('open').prompt;
    showInviteConsent.mockReturnValueOnce(confirmPrompt).mockReturnValueOnce(provePrompt);
    accept.mockRejectedValue(new InviteRpcError(-32602, { code: 'credential-invalid' }));

    await handleInviteDeepLink(LINK);

    expect(accept).toHaveBeenCalledTimes(1);
    expect(confirmPrompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(challenge).toHaveBeenCalledWith('inv-1', SECRET);
    expect(showInviteConsent).toHaveBeenCalledTimes(2);
    expect(showInviteConsent.mock.calls[1][0]).toMatchObject({ mode: 'prove', login: 'octocat' });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(prove).toHaveBeenCalledTimes(1);
    expect(guestAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: TOKEN }));
    expect(provePrompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(logLines.join('\n')).toContain('"reason":"credential-invalid"');
  });

  // The stored credential resolves to the host owner's own principal
  // (intentd #1986): `owner-self-join` is a refusal, not a fallback — the
  // proof would be refused just the same, so the confirm prompt is dismissed
  // as failed, no proof runs, and the failure dialog names the cause.
  it('owner-self-join on accept: the confirm prompt fails, no proof runs, distinct failure dialog', async () => {
    const confirmPrompt = fakeConsent('open').prompt;
    showInviteConsent.mockReturnValueOnce(confirmPrompt);
    accept.mockRejectedValue(new InviteRpcError(-32602, { code: 'owner-self-join' }));

    await handleInviteDeepLink(LINK);

    expect(accept).toHaveBeenCalledTimes(1);
    expect(confirmPrompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(challenge).not.toHaveBeenCalled();
    expect(prove).not.toHaveBeenCalled();
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    const dialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(dialog).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('"inviteCode":"owner-self-join"');
  });

  it.each([
    ['no stored session', () => guestFindMatching.mockResolvedValue(null), 'no-session'],
    ['no token for the session', () => guestGetDecryptedToken.mockResolvedValue(null), 'no-token'],
    [
      'an undecryptable token',
      () => guestGetDecryptedToken.mockRejectedValue(new Error('keyring changed')),
      'token-unavailable',
    ],
  ])(
    '%s: falls through to the proof with no inspect and no extra prompt',
    async (_name, arrange, reason) => {
      arrange();
      const { prompt } = fakeConsent('open');
      showInviteConsent.mockReturnValue(prompt);

      await handleInviteDeepLink(LINK);

      expect(inspect).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
      expect(challenge).toHaveBeenCalledWith('inv-1', SECRET);
      expect(showInviteConsent).toHaveBeenCalledTimes(1);
      expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'prove' });
      expect(guestAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: TOKEN }));
      expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
      expect(logLines.join('\n')).toContain(`"reason":"${reason}"`);
    },
  );

  it('an inspect refusal (invite expired) fails the flow like the proof would', async () => {
    inspect.mockRejectedValue(new InviteRpcError(-32001, { code: 'invite-expired' }));

    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();

    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('invite-expired');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('an accept refusal other than credential-invalid: dismiss failed, failure box, no proof', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    accept.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' }));

    await handleInviteDeepLink(LINK);

    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expectNoProof();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('workspace-full');
  });

  it('never logs the stored or the fresh token', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    guestAdd.mockRejectedValue(new Error(`persist failed: token=${ACCEPTED.token}`));

    await handleInviteDeepLink(LINK);

    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(STORED_TOKEN);
    expect(allLogs).not.toContain(ACCEPTED.token);
    expect(allLogs).not.toContain(SECRET);
  });
});

// The in-app notice modal (spec "In-app invite failure and plaintext-warning
// modals"): both one-button boxes render in the renderer; the native box is
// only the no-window/no-ack fallback. The payload carries bounded codes only.
describe('handleInviteDeepLink — renderer notice modal', () => {
  const NOTICE_KEYS = ['requestId', 'kind', 'reason', 'workspaceTitle', 'hostLabel'];

  function noticePayload(index = 0) {
    return showInviteNotice.mock.calls[index][0] as Record<string, unknown>;
  }

  it('failure before any prompt (dial failed): notice modal, no native box, no labels yet', async () => {
    showInviteNotice.mockResolvedValue(true);
    openInviteConnection.mockRejectedValue(new InviteTransportError('host-unreachable'));

    await handleInviteDeepLink(LINK);

    expect(showInviteNotice).toHaveBeenCalledTimes(1);
    expect(noticePayload()).toEqual({
      requestId: expect.any(String),
      kind: 'failed',
      reason: 'host-unreachable',
    });
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('an expired link at the challenge: notice carries the dialed host and the bounded reason', async () => {
    showInviteNotice.mockResolvedValue(true);
    challenge.mockRejectedValue(new InviteRpcError(-32001, { code: 'invite-expired' }));

    await handleInviteDeepLink(LINK);

    expect(noticePayload()).toMatchObject({
      kind: 'failed',
      reason: 'expired',
      hostLabel: '192.168.1.10',
    });
    expect(noticePayload().workspaceTitle).toBeUndefined();
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prove refused while the joining modal is up: the notice is shown before the modal is dismissed (no gap)', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' }));
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showInviteNotice.mockImplementation(async () => {
      order.push('notice');
      return true;
    });

    await handleInviteDeepLink(LINK);

    expect(order).toEqual(['notice', 'dismiss:failed']);
    expect(noticePayload()).toEqual({
      requestId: expect.any(String),
      kind: 'failed',
      reason: 'workspace-full',
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  it('sign-in denied while the sign-in modal waits: notice before dismiss, the device flow is not left running', async () => {
    signedOutDaemon();
    const signIn = fakeConsent('open');
    showInviteConsent.mockReturnValue(signIn.prompt);
    const order: string[] = [];
    signIn.prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showInviteNotice.mockImplementation(async () => {
      order.push('notice');
      return true;
    });

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('denied');
    await pending;

    expect(order).toEqual(['notice', 'dismiss:failed']);
    expect(noticePayload()).toMatchObject({
      kind: 'failed',
      reason: 'denied',
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.create')).toEqual([]);
  });

  it('plaintext warning after the proof: shown after the joined dismiss, acknowledged before the window opens', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: false });
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    let acknowledge!: (value: boolean) => void;
    showInviteNotice.mockImplementation(() => {
      order.push('notice');
      return new Promise<boolean>((resolve) => (acknowledge = resolve));
    });
    openBackendWindow.mockImplementation(async () => {
      order.push('window');
      return { id: 'guest-id' };
    });

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(showInviteNotice).toHaveBeenCalledTimes(1));
    expect(openBackendWindow).not.toHaveBeenCalled();
    acknowledge(true);
    await pending;

    expect(order).toEqual(['dismiss:joined', 'notice', 'window']);
    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(noticePayload()).toEqual({
      requestId: expect.any(String),
      kind: 'plaintext',
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('plaintext warning on the returning-guest path: names the host as the confirm prompt did', async () => {
    guestFindMatching.mockResolvedValue({
      id: 'guest-id',
      label: '192.168.1.10',
      host: '192.168.1.10',
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: null,
      hostname: null,
      principalId: 'gh:42',
      login: 'octocat',
      tokenEncrypted: true,
      workspaces: [{ id: 'ws-0', title: 'First workspace' }],
      updatedAt: 1,
    });
    guestGetDecryptedToken.mockResolvedValue('stored-guest-token-value');
    inspect.mockResolvedValue({
      workspaceId: 'ws-1',
      workspaceTitle: 'Shared workspace',
      hostname: 'studio.local',
      prettyHostname: 'Studio',
    });
    accept.mockResolvedValue({ ...CREDENTIAL, token: 'fresh-guest-token-value' });
    guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: false });
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    showInviteNotice.mockResolvedValue(true);

    await handleInviteDeepLink(LINK);

    expect(challenge).not.toHaveBeenCalled();
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(noticePayload()).toEqual({
      requestId: expect.any(String),
      kind: 'plaintext',
      workspaceTitle: 'Shared workspace',
      hostLabel: 'Studio',
    });
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('an encrypted store sends no notice at all', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    await handleInviteDeepLink(LINK);
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(prompt.dismiss).toHaveBeenCalledWith('joined');
  });

  it('renderer unavailable: the native box is the fallback, after the consent modal is dismissed', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' }));
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showInviteNotice.mockImplementation(async () => {
      order.push('notice');
      return false;
    });
    showMessageBox.mockImplementation(async () => {
      order.push('native');
      return { response: 0 };
    });

    await handleInviteDeepLink(LINK);

    expect(order).toEqual(['notice', 'dismiss:failed', 'native']);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
  });

  it.each([
    [
      'server-authored rpc text',
      new InviteRpcError(-32602, { code: SECRET, detail: `token=${TOKEN}` }),
    ],
    [
      'a thrown Error with credentials in its text',
      new Error(`persist failed: secret=${SECRET} token=${TOKEN}`),
    ],
    ['a transport error', new InviteTransportError('tunnel-failed')],
    ['a store refusal', new GuestStoreCorruptError()],
  ])(
    'the notice payload carries bounded fields only — never a message or the credentials (%s)',
    async (_name, error) => {
      showInviteNotice.mockResolvedValue(true);
      challenge.mockRejectedValue(error);

      await handleInviteDeepLink(LINK);

      const payload = noticePayload();
      expect(Object.keys(payload).every((key) => NOTICE_KEYS.includes(key))).toBe(true);
      expect(payload).not.toHaveProperty('message');
      expect(payload).not.toHaveProperty('error');
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain('persist failed');
    },
  );

  /** Every failure class of the gist-proof flow lands on its own bounded reason. */
  it.each([
    [
      'pin mismatch',
      () => openInviteConnection.mockRejectedValue(new PinMismatchError()),
      'cert-mismatch',
    ],
    [
      'encryption unavailable',
      () => guestAdd.mockRejectedValue(new GuestEncryptionUnavailableError()),
      'encryption-unavailable',
    ],
    [
      'store corrupt',
      () => guestAdd.mockRejectedValue(new GuestStoreCorruptError()),
      'store-corrupt',
    ],
    [
      'browser launch failed during the sign-in',
      () => {
        signedOutDaemon();
        openExternal.mockRejectedValue(new Error('no browser'));
      },
      'launch-failed',
    ],
    [
      'github.connect refused by the guest daemon',
      () => {
        signedOutDaemon();
        onLocal('github.connect', () => {
          throw localRefusal('some-daemon-code');
        });
      },
      'sign-in-failed',
    ],
    [
      'a refused verification URL',
      () => {
        signedOutDaemon();
        onLocal('github.connect', () => ({ ...CONNECT, verificationUri: 'https://evil.example/' }));
      },
      'sign-in-failed',
    ],
    [
      'the guest daemon cannot reach GitHub for the proof',
      () =>
        onLocal('github.identityProof.create', () => {
          throw localRefusal('github-unreachable');
        }),
      'proof-github-unreachable',
    ],
    [
      'an undocumented proof error',
      () =>
        onLocal('github.identityProof.create', () => {
          throw new Error(`gist failed: secret=${SECRET}`);
        }),
      'proof-failed',
    ],
    [
      'workspace full',
      () => prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' })),
      'workspace-full',
    ],
    [
      'owner self-join',
      () => prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'owner-self-join' })),
      'owner-self-join',
    ],
    [
      'the host cannot reach GitHub to read the proof',
      () => prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'github-unreachable' })),
      'host-github-unreachable',
    ],
    [
      'proof expired twice (the retry box accepted once)',
      () => prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'proof-expired' })),
      'proof-expired',
    ],
    [
      'proof invalid twice (the retry box accepted once)',
      () => prove.mockRejectedValue(new InviteRpcError(-32602, { code: 'proof-invalid' })),
      'proof-invalid',
    ],
    [
      'unknown host code',
      () => challenge.mockRejectedValue(new InviteRpcError(-32602, { code: 'what' })),
      'generic',
    ],
  ])('maps %s onto its bounded reason', async (_name, arrange, reason) => {
    showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);
    showInviteNotice.mockResolvedValue(true);
    arrange();
    await handleInviteDeepLink(LINK);
    expect(showInviteNotice).toHaveBeenCalledTimes(1);
    expect(noticePayload()).toMatchObject({ kind: 'failed', reason });
  });

  it('the sign-in failure sentences and the proof failure sentences are distinct from the generic one', async () => {
    showInviteNotice.mockResolvedValue(true);
    const reasons: string[] = [];
    for (const status of ['denied', 'expired', 'error'] as const) {
      signedOutDaemon();
      showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
      const pending = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(openExternal).toHaveBeenCalled());
      openExternal.mockClear();
      emitAuthChanged(status);
      await pending;
      reasons.push(noticePayload(reasons.length).reason as string);
    }
    expect(reasons).toEqual(['denied', 'flow-expired', 'sign-in-failed']);
    expect(showMessageBox).not.toHaveBeenCalled();
  });
});

// The progress dialog (`main/invite-progress.ts`) covers the two silent
// phases: `connecting` from the parsed link to the first consent prompt, and
// `opening` from the point of no return to the window. Cancel while
// connecting aborts the join quietly; Cancel while opening only skips the
// window — the credential is stored and the membership stands.
describe('handleInviteDeepLink — progress dialog', () => {
  const RETURNING_SESSION = {
    id: 'guest-id',
    label: '192.168.1.10',
    host: '192.168.1.10',
    hosts: ['192.168.1.10'],
    port: 8443,
    fingerprint: 'AA:BB:CC',
    tcAddress: null,
    hostname: null,
    principalId: 'gh:42',
    login: 'octocat',
    tokenEncrypted: true,
    workspaces: [{ id: 'ws-0', title: 'First workspace' }],
    updatedAt: 1,
  };
  const INSPECTION = { workspaceId: 'ws-1', workspaceTitle: 'Shared workspace' };

  it('connecting: shown before the dial, updated with the host label once up, dismissed before the consent prompt', async () => {
    const connecting = fakeProgress();
    const order: string[] = [];
    showInviteProgress.mockImplementationOnce(() => {
      order.push('progress:connecting');
      return connecting.handle;
    });
    openInviteConnection.mockImplementation(async () => {
      order.push('dial');
      return fakeConnection();
    });
    connecting.handle.update.mockImplementation((phase: string, labels: { hostLabel?: string }) =>
      order.push(`update:${phase}:${labels.hostLabel}`),
    );
    connecting.handle.dismiss.mockImplementation(() => order.push('dismiss:connecting'));
    showInviteConsent.mockImplementation(() => {
      order.push('consent');
      return fakeConsent('open').prompt;
    });

    await handleInviteDeepLink(LINK);

    expect(order.slice(0, 5)).toEqual([
      'progress:connecting',
      'dial',
      'update:connecting:192.168.1.10',
      'dismiss:connecting',
      'consent',
    ]);
    const payload = showInviteProgress.mock.calls[0][0];
    expect(payload).toEqual({ requestId: expect.any(String), phase: 'connecting' });
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(connecting.handle.update).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('connecting is dismissed before the native prove box when no renderer shows the consent', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    const order: string[] = [];
    connecting.handle.dismiss.mockImplementation(() => order.push('dismiss:connecting'));
    showMessageBox.mockImplementation(async () => {
      order.push('native-box');
      return { response: 0 };
    });

    await handleInviteDeepLink(LINK);

    expect(order.slice(0, 2)).toEqual(['dismiss:connecting', 'native-box']);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('connecting is dismissed before the sign-in prompt of a signed-out guest', async () => {
    signedOutDaemon();
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    const order: string[] = [];
    connecting.handle.dismiss.mockImplementation(() => order.push('dismiss:connecting'));
    showInviteConsent.mockImplementation((payload: { mode: string }) => {
      order.push(`consent:${payload.mode}`);
      return fakeConsent('open').prompt;
    });

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await pending;

    expect(order.slice(0, 2)).toEqual(['dismiss:connecting', 'consent:sign-in-required']);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('connecting is dismissed before the failure notice when the dial fails', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    openInviteConnection.mockRejectedValue(new InviteTransportError('host-unreachable'));
    const order: string[] = [];
    connecting.handle.dismiss.mockImplementation(() => order.push('dismiss:connecting'));
    showInviteNotice.mockImplementation(async () => {
      order.push('notice');
      return true;
    });

    await handleInviteDeepLink(LINK);

    expect(order.slice(0, 2)).toEqual(['dismiss:connecting', 'notice']);
    expect(showInviteProgress).toHaveBeenCalledTimes(1);
  });

  it('cancel while dialing: the flow ends quietly, the late connection is closed, no notice, the next link is handled', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    let releaseDial!: () => void;
    openInviteConnection.mockReturnValueOnce(
      new Promise((resolve) => (releaseDial = () => resolve(fakeConnection()))),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openInviteConnection).toHaveBeenCalledTimes(1));
    connecting.cancel();
    await pending;

    expect(inspect).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(connecting.handle.dismiss).toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');

    // The dial that completes after the cancel is closed on arrival.
    releaseDial();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));

    // The in-flight guard was released.
    await handleInviteDeepLink(LINK);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('cancel while the challenge is in flight: connection closed, nothing proven, no notice', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    let releaseChallenge!: () => void;
    challenge.mockReturnValueOnce(
      new Promise((resolve) => (releaseChallenge = () => resolve(CHALLENGE))),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(challenge).toHaveBeenCalledTimes(1));
    connecting.cancel();
    await pending;
    releaseChallenge();

    expect(close).toHaveBeenCalledTimes(1);
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
  });

  it('cancel while a returning guest inspects the invite: connection closed, nothing accepted', async () => {
    guestFindMatching.mockResolvedValue(RETURNING_SESSION);
    guestGetDecryptedToken.mockResolvedValue('stored-guest-token-value');
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    inspect.mockReturnValue(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    connecting.cancel();
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('cancel while the local login is read (github.getUser): no prompt, no device flow, connection closed, next link handled', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    let releaseGetUser!: () => void;
    onLocal(
      'github.getUser',
      () => new Promise((resolve) => (releaseGetUser = () => resolve({ user: null }))),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(localCalls('github.getUser')).toHaveLength(1));
    connecting.cancel();
    await pending;
    releaseGetUser();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(close).toHaveBeenCalledTimes(1);
    expect(localCalls('github.connect')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(connecting.handle.dismiss).toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');

    // The in-flight guard was released.
    signedInDaemon();
    await handleInviteDeepLink(LINK);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('cancel while the device flow starts (github.connect): no sign-in prompt, the late flow is cancelled, connection closed', async () => {
    signedOutDaemon();
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    let releaseConnect!: () => void;
    onLocal(
      'github.connect',
      () => new Promise((resolve) => (releaseConnect = () => resolve(CONNECT))),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(localCalls('github.connect')).toHaveLength(1));
    connecting.cancel();
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(localCalls('github.cancelAuth')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');

    // A device flow that starts after the cancel is aborted on arrival.
    releaseConnect();
    await vi.waitFor(() => expect(localCalls('github.cancelAuth')).toHaveLength(1));
  });

  it('a device flow start cancelled during one invite does not abort the flow a later invite is showing', async () => {
    signedOutDaemon();
    const connectingA = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connectingA.handle);
    let releaseConnectA!: () => void;
    let connects = 0;
    onLocal('github.connect', () => {
      connects += 1;
      if (connects === 1) {
        return new Promise((resolve) => (releaseConnectA = () => resolve(CONNECT)));
      }
      return CONNECT;
    });
    const signIn = fakeConsent('pending');
    const prove = fakeConsent('open');
    showInviteConsent.mockReturnValueOnce(signIn.prompt).mockReturnValueOnce(prove.prompt);

    // Invite A is cancelled while its device-flow start is still pending.
    const pendingA = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(localCalls('github.connect')).toHaveLength(1));
    connectingA.cancel();
    await pendingA;
    expect(localCalls('github.cancelAuth')).toEqual([]);

    // Invite B starts its own flow and reaches the sign-in prompt.
    const pendingB = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(showInviteConsent).toHaveBeenCalledTimes(1));
    expect(localCalls('github.connect')).toHaveLength(2);
    expect(showInviteConsent.mock.calls[0][0]).toMatchObject({ mode: 'sign-in-required' });

    // A's start arrives late: B owns the live flow, so nothing is cancelled.
    releaseConnectA();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(localCalls('github.cancelAuth')).toEqual([]);
    expect(signIn.prompt.dismiss).not.toHaveBeenCalled();

    // B completes normally.
    signIn.decide('open');
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    emitAuthChanged('authorized');
    await pendingB;

    expect(signIn.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('superseded');
    expect(prove.prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(localCalls('github.cancelAuth')).toEqual([]);
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');
  });

  it('cancel while the stored session is looked up: nothing inspected or proven, connection closed', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    guestFindMatching.mockReturnValueOnce(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(guestFindMatching).toHaveBeenCalledTimes(1));
    connecting.cancel();
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
  });

  it('cancel while the stored token is decrypted: nothing inspected or proven, no token-unavailable fallback', async () => {
    guestFindMatching.mockResolvedValue(RETURNING_SESSION);
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    guestGetDecryptedToken.mockReturnValueOnce(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(guestGetDecryptedToken).toHaveBeenCalledTimes(1));
    connecting.cancel();
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(challenge).not.toHaveBeenCalled();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
    expect(logLines.join('\n')).not.toContain('token-unavailable');
  });

  it('opening (proof path): shown after the consent is dismissed joined, before the store, dismissed after the window opens', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    const order: string[] = [];
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) => {
      order.push(`progress:${payload.phase}`);
      return payload.phase === 'opening' ? opening.handle : fakeProgress().handle;
    });
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    guestAdd.mockImplementation(async () => {
      order.push('store');
      return { id: 'guest-id', tokenEncrypted: true };
    });
    openBackendWindow.mockImplementation(async () => {
      order.push('window');
      return { id: 'guest-id' };
    });
    opening.handle.dismiss.mockImplementation(() => order.push('dismiss:opening'));

    await handleInviteDeepLink(LINK);

    expect(order).toEqual([
      'progress:connecting',
      'dismiss:joined',
      'progress:opening',
      'store',
      'window',
      'dismiss:opening',
    ]);
    expect(showInviteProgress.mock.calls[1][0]).toEqual({
      requestId: expect.any(String),
      phase: 'opening',
      hostLabel: '192.168.1.10',
      workspaceTitle: CHALLENGE.workspaceTitle,
    });
    expect(JSON.stringify(showInviteProgress.mock.calls[1][0])).not.toContain(TOKEN);
  });

  it('opening (returning-guest path): shown after the confirm is dismissed joined, dismissed after the window opens', async () => {
    guestFindMatching.mockResolvedValue(RETURNING_SESSION);
    guestGetDecryptedToken.mockResolvedValue('stored-guest-token-value');
    inspect.mockResolvedValue(INSPECTION);
    accept.mockResolvedValue(CREDENTIAL);
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    const order: string[] = [];
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) => {
      order.push(`progress:${payload.phase}`);
      return payload.phase === 'opening' ? opening.handle : fakeProgress().handle;
    });
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    guestAdd.mockImplementation(async () => {
      order.push('store');
      return { id: 'guest-id', tokenEncrypted: true };
    });
    openBackendWindow.mockImplementation(async () => {
      order.push('window');
      return { id: 'guest-id' };
    });
    opening.handle.dismiss.mockImplementation(() => order.push('dismiss:opening'));

    await handleInviteDeepLink(LINK);

    expect(challenge).not.toHaveBeenCalled();
    expect(order).toEqual([
      'progress:connecting',
      'dismiss:joined',
      'progress:opening',
      'store',
      'window',
      'dismiss:opening',
    ]);
    expect(showInviteProgress.mock.calls[1][0]).toMatchObject({
      phase: 'opening',
      hostLabel: '192.168.1.10',
      workspaceTitle: 'Shared workspace',
    });
  });

  it('opening is dismissed when the store write fails, before the failure notice', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) =>
      payload.phase === 'opening' ? opening.handle : fakeProgress().handle,
    );
    guestAdd.mockRejectedValue(new GuestStoreCorruptError());
    const order: string[] = [];
    opening.handle.dismiss.mockImplementation(() => order.push('dismiss:opening'));
    showInviteNotice.mockImplementation(async () => {
      order.push('notice');
      return true;
    });

    await handleInviteDeepLink(LINK);

    expect(order).toEqual(['dismiss:opening', 'notice']);
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('cancel while opening: the credential is stored, the plaintext warning still shows, the window is not opened', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) =>
      payload.phase === 'opening' ? opening.handle : fakeProgress().handle,
    );
    let releaseStore!: () => void;
    guestAdd.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStore = () => resolve({ id: 'guest-id', tokenEncrypted: false });
      }),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(guestAdd).toHaveBeenCalledTimes(1));
    opening.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseStore();
    await pending;

    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    // Plaintext warning (native fallback) still shown; no failure notice.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'warning' });
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(opening.handle.dismiss).toHaveBeenCalled();
    expect(logLines.join('\n')).toContain(
      'User closed the join progress dialog; window not opened',
    );
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a cancel that lands after the window opened changes nothing', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) =>
      payload.phase === 'opening' ? opening.handle : fakeProgress().handle,
    );

    await handleInviteDeepLink(LINK);
    expect(opening.handle.dismiss).toHaveBeenCalledTimes(1);
    opening.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(openBackendWindow).toHaveBeenCalledTimes(1);
    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(logLines.join('\n')).not.toContain('window not opened');
  });

  it('cancel while the window is opening: the dialog closes at once, the window still opens', async () => {
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    const opening = fakeProgress();
    showInviteProgress.mockImplementation((payload: { phase: string }) =>
      payload.phase === 'opening' ? opening.handle : fakeProgress().handle,
    );
    let releaseOpen!: () => void;
    openBackendWindow.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseOpen = () => resolve({ id: 'guest-id' });
      }),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openBackendWindow).toHaveBeenCalledWith('guest-id'));
    expect(opening.handle.dismiss).not.toHaveBeenCalled();
    opening.cancel();
    await vi.waitFor(() => expect(opening.handle.dismiss).toHaveBeenCalled());
    releaseOpen();
    await pending;

    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(openBackendWindow).toHaveBeenCalledTimes(1);
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(logLines.join('\n')).not.toContain('window not opened');
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');
  });

  it('already a member: connecting is dismissed before the window opens, no opening phase', async () => {
    guestFindMatching.mockResolvedValue({
      ...RETURNING_SESSION,
      workspaces: [{ id: 'ws-1', title: 'Shared workspace' }],
    });
    guestGetDecryptedToken.mockResolvedValue('stored-guest-token-value');
    inspect.mockResolvedValue(INSPECTION);
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    const order: string[] = [];
    connecting.handle.dismiss.mockImplementation(() => order.push('dismiss:connecting'));
    openBackendWindow.mockImplementation(async () => {
      order.push('window');
      return { id: 'guest-id' };
    });

    await handleInviteDeepLink(LINK);

    expect(order.slice(0, 2)).toEqual(['dismiss:connecting', 'window']);
    expect(progressPhases()).toEqual(['connecting']);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  it('the inert no-window handle leaves the flow unchanged: joined and opened, nothing awaited on Cancel', async () => {
    showInviteProgress.mockReturnValue({
      update() {},
      cancelled: new Promise<void>(() => {}),
      dismiss() {},
    });
    await handleInviteDeepLink(LINK);
    expect(progressPhases()).toEqual(['connecting', 'opening']);
    expect(guestAdd).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });
});

describe('routeInviteLinkFromOs', () => {
  it('handles the link when the app is ready even with no window', async () => {
    const park = vi.fn();
    await routeInviteLinkFromOs(LINK, park);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(park).not.toHaveBeenCalled();
  });

  it('parks the link before the app is ready', async () => {
    appIsReady.mockReturnValue(false);
    const park = vi.fn().mockResolvedValue(undefined);
    await routeInviteLinkFromOs(LINK, park);
    expect(park).toHaveBeenCalledWith(LINK);
    expect(openInviteConnection).not.toHaveBeenCalled();
  });
});
