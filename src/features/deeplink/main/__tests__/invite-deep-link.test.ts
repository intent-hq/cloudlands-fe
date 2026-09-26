import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the `intent://invite` deep-link join flow
 * (features/deeplink/main/invite-deep-link.ts): dial `/invite` with the pin
 * (no fingerprint confirmation) → `invite.challenge` → consent → the guest's
 * own daemon publishes the nonce as a gist (`github.identityProof.create`) →
 * `invite.prove` → credential stored as a GUEST session (never a paired
 * backend) → gist deleted → window opened. New sign-in uses the local
 * collaboration-only identity continuation; old daemons need an upgrade. Malformed links are rejected fail-soft,
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
/**
 * The local sidecar's `client.hello` protocolVersion, read through
 * `getConnectedDaemonProtocolVersion('local')`. Defaults to a daemon that
 * serves the identity seam; a test sets an older one to exercise the gate.
 */
const localProtocolVersion = vi.fn<() => string | null>(() => '10.8'); // protocol-version-ok: fixture hello

const openBackendWindow = vi.fn();
const captureIdentity = vi.fn(() => ({ supported: false }));
const prepareIdentity = vi.fn();
vi.mock('../../../collaboration-auth/main/collaboration-auth.ipc', () => ({
  prepareCollaborationIdentity: (...args: unknown[]) => prepareIdentity(...args),
}));
vi.mock('../../../backend/main/backend.ipc', () => ({
  get openBackendWindow() {
    return openBackendWindow;
  },
  getBackendClient: () => ({ request: localRequest }),
  captureLocalIdentityConnection: () => captureIdentity(),
  getConnectedDaemonProtocolVersion: (connectionId: string) =>
    connectionId === 'local' ? localProtocolVersion() : null,
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

/** Legacy host challenge omitting the newer host labels and pin metadata. */
const CHALLENGE = {
  workspaceId: 'ws-1',
  workspaceTitle: 'Shared workspace',
  nonce: 'nonce-value-1',
  nonceExpiresAt: '2026-09-17T12:00:00Z',
};
const CURRENT_CHALLENGE = {
  ...CHALLENGE,
  hostname: '192.168.1.10',
  prettyHostname: null,
  pinIdentity: null,
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
  flowId: 'flow-1',
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
  onLocal('github.getUser', () => ({ user: { id: 42, login: 'octocat' } }));
  onLocal('github.identityProof.create', () => PROOF);
  onLocal('github.identityProof.delete', () => ({ ok: true }));
}

function signedOutDaemon(): void {
  signedInDaemon();
  onLocal('github.getUser', () => ({ user: null }));
  onLocal('github.identityProof.create', () => {
    throw localRefusal('github-not-connected');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captureIdentity.mockReturnValue({ supported: false });
  prepareIdentity.mockReset();
  logLines.length = 0;
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
      expect(logLines.join('\n')).toContain('Could not delete the identity proof'),
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
      identity: { provider: 'github', host: 'github.com' },
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

describe('handleInviteDeepLink — older local daemon recovery', () => {
  it('missing credentials offers an upgrade and never starts repository authorization', async () => {
    signedOutDaemon();
    showInviteNotice.mockResolvedValue(true);
    await handleInviteDeepLink(LINK);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'collaboration-upgrade-required' }),
    );
    expect(localCalls('github.connect')).toEqual([]);
    expect(localCalls('sourceControl.connect')).toEqual([]);
    expect(guestAdd).not.toHaveBeenCalled();
  });
  it('insufficient proof scope offers the same upgrade without changing repository credentials', async () => {
    onLocal('github.identityProof.create', () => {
      throw localRefusal('github-scope-missing');
    });
    showInviteNotice.mockResolvedValue(true);
    await handleInviteDeepLink(LINK);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'collaboration-upgrade-required' }),
    );
    expect(localCalls('github.connect')).toEqual([]);
    expect(guestAdd).not.toHaveBeenCalled();
  });
});

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
      'the guest daemon is rate limited by GitHub at the probe',
      () =>
        onLocal('github.getUser', () => {
          throw localRefusal('rate-limited');
        }),
      'github-rate-limited',
    ],
    [
      'the guest daemon is rate limited by GitHub at the proof',
      () =>
        onLocal('github.identityProof.create', () => {
          throw localRefusal('rate-limited');
        }),
      'github-rate-limited',
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
});

/**
 * A guest whose only forge connection is GitLab: the identity comes from
 * `sourceControl.authStatus { provider: "gitlab" }`, the proof is a snippet
 * (`sourceControl.identityProof.create / .delete { provider: "gitlab", host }`)
 * and `invite.prove` names it by `provider` / `host` / `proofId`. The GitHub
 * path above stays byte-identical (it never sends `provider` / `proofId`).
 */
describe('handleInviteDeepLink — GitLab identity', () => {
  const GITLAB_HOST = 'gitlab.example.com';
  const GITLAB_PROOF = {
    proofId: '77',
    login: 'gl-user',
    provider: 'gitlab',
    host: GITLAB_HOST,
    externalUserId: '4711',
    avatarUrl: null,
  };

  /** A guest daemon with no GitHub connection and a configured GitLab one. */
  function gitlabOnlyDaemon(): void {
    localMethods.clear();
    onLocal('github.getUser', () => ({ user: null }));
    onLocal('sourceControl.authStatus', (params) => {
      expect(params).toEqual({ provider: 'gitlab' });
      return {
        provider: 'gitlab',
        host: GITLAB_HOST,
        isConfigured: true,
        user: { id: '4711', login: 'gl-user' },
      };
    });
    onLocal('sourceControl.identityProof.create', () => GITLAB_PROOF);
    onLocal('sourceControl.identityProof.delete', () => ({ ok: true }));
  }

  function noticePayload() {
    return showInviteNotice.mock.calls[0][0] as Record<string, unknown>;
  }

  beforeEach(() => {
    gitlabOnlyDaemon();
    localProtocolVersion.mockReturnValue('10.8'); // protocol-version-ok: fixture hello
    prove.mockResolvedValue({ ...CREDENTIAL, principalId: 'gl:4711', login: 'gl-user' });
  });

  it('an old local daemon offers upgrade without probing GitLab or starting repository auth', async () => {
    localProtocolVersion.mockReturnValue('10.7'); // protocol-version-ok: pre-seam fixture hello
    onLocal('github.connect', () => CONNECT);
    onLocal('github.cancelAuth', () => ({ ok: true }));
    const { prompt } = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(LINK);

    expect(localCalls('sourceControl.authStatus')).toEqual([]);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(localCalls('github.connect')).toEqual([]);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'collaboration-upgrade-required' }),
    );
    expect(prove).not.toHaveBeenCalled();
  });

  it('joins with a snippet proof: consent names GitLab, prove carries provider/host/proofId, snippet deleted', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent.mock.calls[0][0]).toEqual({
      requestId: expect.any(String),
      mode: 'prove',
      login: 'gl-user',
      identity: { provider: 'gitlab', host: GITLAB_HOST },
      workspaceTitle: CHALLENGE.workspaceTitle,
      hostLabel: '192.168.1.10',
    });
    expect(localCalls('sourceControl.identityProof.create')).toEqual([
      [
        'sourceControl.identityProof.create',
        {
          provider: 'gitlab',
          host: GITLAB_HOST,
          nonce: CHALLENGE.nonce,
          hostLabel: '192.168.1.10',
        },
      ],
    ]);
    expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      provider: 'gitlab',
      host: GITLAB_HOST,
      proofId: '77',
      login: 'gl-user',
    });
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(localCalls('github.connect')).toEqual([]);
    expect(localCalls('sourceControl.identityProof.delete')).toEqual([
      [
        'sourceControl.identityProof.delete',
        { provider: 'gitlab', host: GITLAB_HOST, proofId: '77' },
      ],
    ]);
    expect(guestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'gl:4711', login: 'gl-user', token: TOKEN }),
    );
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('joined');
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('legacy missing pin metadata keeps GitHub first when both forges are connected', async () => {
    onLocal('github.getUser', () => ({ user: { id: 42, login: 'octocat' } }));
    onLocal('github.identityProof.create', () => PROOF);
    onLocal('github.identityProof.delete', () => ({ ok: true }));
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);
    await handleInviteDeepLink(LINK);
    expect(localCalls('sourceControl.authStatus')).toEqual([]);
    expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: PROOF.gistId,
      login: PROOF.login,
    });
  });

  it('a GitLab pin selects GitLab with both forges connected and cleans up its proof', async () => {
    challenge.mockResolvedValue({
      ...CURRENT_CHALLENGE,
      pinIdentity: { provider: 'gitlab', host: GITLAB_HOST, externalUserId: '4711' },
    });
    onLocal('github.getUser', () => ({ user: { id: 42, login: 'octocat' } }));
    onLocal('github.identityProof.create', () => PROOF);
    onLocal('github.identityProof.delete', () => ({ ok: true }));
    onLocal('sourceControl.authStatus', (params) => {
      expect(params).toEqual({ provider: 'gitlab', host: GITLAB_HOST });
      return {
        provider: 'gitlab',
        host: GITLAB_HOST,
        isConfigured: true,
        user: { id: '4711', login: 'gl-user' },
      };
    });
    showInviteConsent.mockReturnValue(fakeConsent('open').prompt);

    await handleInviteDeepLink(LINK);

    expect(challenge).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([
      [
        'sourceControl.identityProof.create',
        {
          provider: 'gitlab',
          host: GITLAB_HOST,
          nonce: CHALLENGE.nonce,
          hostLabel: '192.168.1.10',
        },
      ],
    ]);
    expect(prove).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      provider: 'gitlab',
      host: GITLAB_HOST,
      proofId: '77',
      login: 'gl-user',
    });
    expect(localCalls('sourceControl.identityProof.delete')).toEqual([
      [
        'sourceControl.identityProof.delete',
        { provider: 'gitlab', host: GITLAB_HOST, proofId: '77' },
      ],
    ]);
    expect(localCalls('github.identityProof.create')).toEqual([]);
    for (const method of ['settings.set', 'sourceControl.revoke', 'github.disconnect']) {
      expect(localCalls(method)).toEqual([]);
    }
    expect(guestAdd).toHaveBeenCalledOnce();
  });

  it('a GitLab connection without a resolved user or a daemon without sourceControl.* reads as not connected', async () => {
    onLocal('sourceControl.authStatus', () => ({
      isConfigured: true,
      host: GITLAB_HOST,
      user: null,
    }));
    onLocal('github.connect', () => CONNECT);
    onLocal('github.cancelAuth', () => ({ ok: true }));
    const { prompt } = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(prompt);
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(localCalls('github.connect')).toEqual([]);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'collaboration-upgrade-required' }),
    );
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
  });

  // The GitLab probe follows the GitHub one: a rate limit is not "not
  // connected", so no connect-forge prompt and no GitHub sign-in — the join
  // fails with its own reason, which names GitLab, not GitHub
  // (intent-hq/intent#5627).
  it('a rate-limited sourceControl.authStatus probe: the GitLab rate-limit failure, no connect-forge or sign-in prompt, no device flow', async () => {
    showInviteNotice.mockResolvedValue(true);
    onLocal('sourceControl.authStatus', () => {
      throw localRefusal('rate-limited');
    });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(localCalls('github.connect')).toEqual([]);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    expect(showInviteNotice).toHaveBeenCalledTimes(1);
    expect(noticePayload()).toMatchObject({ kind: 'failed', reason: 'gitlab-rate-limited' });
    expect(logLines.join('\n')).toContain('"proofCode":"rate-limited"');
  });

  it('a rate-limited snippet proof: the GitLab rate-limit failure, and the native box names GitLab, not GitHub', async () => {
    onLocal('sourceControl.identityProof.create', () => {
      throw localRefusal('rate-limited');
    });
    showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);
    await handleInviteDeepLink(LINK);
    expect(localCalls('github.connect')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    const failure = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(failure.type).toBe('error');
    expect(failure.message).toContain('GitLab');
    expect(failure.message).not.toContain('GitHub');
    expect(logLines.join('\n')).toContain('"proofCode":"rate-limited"');
  });

  it('identity-unverifiable: the notice names the GitLab instance, the snippet is deleted, nothing minted', async () => {
    prove.mockRejectedValue(
      new InviteRpcError(-32603, { code: 'identity-unverifiable', host: GITLAB_HOST }),
    );
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    showInviteNotice.mockResolvedValue(true);

    await handleInviteDeepLink(LINK);

    expect(showInviteNotice).toHaveBeenCalledTimes(1);
    expect(noticePayload()).toMatchObject({
      kind: 'failed',
      reason: 'identity-unverifiable',
      identityHost: GITLAB_HOST,
      hostLabel: '192.168.1.10',
    });
    expect(prompt.dismiss).toHaveBeenCalledExactlyOnceWith('failed');
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('a native failure box for identity-unverifiable reads the same sentence, host included', async () => {
    prove.mockRejectedValue(
      new InviteRpcError(-32603, { code: 'identity-unverifiable', host: GITLAB_HOST }),
    );
    await handleInviteDeepLink(LINK);
    const failure = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(failure.type).toBe('error');
    expect(failure.message).toContain(GITLAB_HOST);
    expect(failure.message.toLowerCase()).not.toContain('timed out');
  });

  it.each([
    ['gitlab-not-connected', 'proof-gitlab-not-connected'],
    ['gitlab-scope-missing', 'proof-gitlab-scope-missing'],
    ['gitlab-unreachable', 'proof-gitlab-unreachable'],
  ])(
    'a %s refusal from the guest daemon is a failure (no GitHub device flow), reason %s',
    async (code, reason) => {
      onLocal('sourceControl.identityProof.create', () => {
        throw localRefusal(code);
      });
      showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);
      showInviteNotice.mockResolvedValue(true);
      await handleInviteDeepLink(LINK);
      expect(noticePayload()).toMatchObject({ kind: 'failed', reason });
      expect(localCalls('github.connect')).toEqual([]);
      expect(prove).not.toHaveBeenCalled();
    },
  );

  it('cancel on the connecting dialog while the GitLab identity is probed: no snippet, no prompt, no notice, connection closed', async () => {
    const connecting = fakeProgress();
    showInviteProgress.mockReturnValueOnce(connecting.handle);
    let releaseProbe!: () => void;
    onLocal(
      'sourceControl.authStatus',
      () =>
        new Promise((resolve) => {
          releaseProbe = () =>
            resolve({ provider: 'gitlab', host: GITLAB_HOST, isConfigured: true });
        }),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(localCalls('sourceControl.authStatus')).toHaveLength(1));
    connecting.cancel();
    await pending;
    releaseProbe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(close).toHaveBeenCalledTimes(1);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(localCalls('github.connect')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(prove).not.toHaveBeenCalled();
    expect(connecting.handle.dismiss).toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('User cancelled the invite while connecting');
    expect(logLines.join('\n')).not.toContain('Invite deep link handling failed');
  });
});

// The progress dialog (`main/invite-progress.ts`) covers the two silent
// phases: `connecting` from the parsed link to the first consent prompt, and
// `opening` from the point of no return to the window. Cancel while
// connecting aborts the join quietly; Cancel while opening only skips the
// window — the credential is stored and the membership stands.

describe('handleInviteDeepLink — invitation identity requirements', () => {
  const GITLAB_PIN = {
    provider: 'gitlab',
    host: 'gitlab.example.com:8443',
    externalUserId: '4711',
  };
  const GITHUB_PIN = { provider: 'github', host: 'github.com', externalUserId: '42' };
  const snippet = {
    ...GITLAB_PIN,
    proofId: '101',
    login: 'gl-user',
    avatarUrl: null,
  };
  const status = {
    provider: 'gitlab',
    host: GITLAB_PIN.host,
    isConfigured: true,
    oauthUrl: '',
    configuredButNeedsUpdate: false,
    updatedScopes: '',
    deviceFlow: null,
    method: 'pat',
    deviceGrantSupported: false,
    user: { id: '4711', login: 'gl-user' },
  };

  function setPrincipal(identity: unknown): void {
    onLocal('principal.me', (params) => {
      expect(params).toEqual({});
      return {
        id: 'primary',
        login: 'gl-user',
        displayName: null,
        avatarUrl: null,
        isAdministrator: true,
        identity,
      };
    });
  }

  function expectNoProof(): void {
    expect(localCalls('github.identityProof.create')).toEqual([]);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(prove).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    localProtocolVersion.mockReturnValue('10.8'); // protocol-version-ok: fixture hello
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN });
    onLocal('github.getUser', () => ({ user: { id: 42, login: 'octocat' } }));
    onLocal('sourceControl.authStatus', (params) => {
      expect(params).toEqual({ provider: 'gitlab', host: GITLAB_PIN.host });
      return status;
    });
    onLocal('sourceControl.identityProof.create', () => snippet);
    onLocal('sourceControl.identityProof.delete', () => ({ ok: true }));
    setPrincipal(GITHUB_PIN);
    showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);
    showInviteNotice.mockResolvedValue(true);
  });

  it('a GitLab pin never probes a rate-limited irrelevant GitHub account', async () => {
    onLocal('github.getUser', () => {
      throw localRefusal('rate-limited');
    });
    await handleInviteDeepLink(LINK);
    expect(localCalls('github.getUser')).toEqual([]);
    expect(localCalls('principal.me')).toEqual([]);
    expect(localCalls('sourceControl.authStatus')).toEqual(
      Array(3).fill(['sourceControl.authStatus', { provider: 'gitlab', host: GITLAB_PIN.host }]),
    );
    expect(prove).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      provider: 'gitlab',
      host: GITLAB_PIN.host,
      proofId: snippet.proofId,
      login: 'gl-user',
    });
    expect(localCalls('sourceControl.identityProof.delete')).toEqual([
      [
        'sourceControl.identityProof.delete',
        { provider: 'gitlab', host: GITLAB_PIN.host, proofId: snippet.proofId },
      ],
    ]);
  });

  it('a GitHub pin overrides selected GitLab and never probes rate-limited GitLab', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: GITHUB_PIN });
    setPrincipal(GITLAB_PIN);
    onLocal('sourceControl.authStatus', () => {
      throw localRefusal('rate-limited');
    });
    await handleInviteDeepLink(LINK);
    expect(localCalls('sourceControl.authStatus')).toEqual([]);
    expect(localCalls('principal.me')).toEqual([]);
    expect(prove).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: PROOF.gistId,
      login: 'octocat',
    });
    expect(localCalls('github.identityProof.delete')).toEqual([
      ['github.identityProof.delete', { gistId: PROOF.gistId }],
    ]);
  });

  it.each(['gitlab.com', 'gitlab.acme.internal:9443', '[::1]:8443'])(
    'uses the canonical pinned instance %s in probe, proof and cleanup',
    async (host) => {
      challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: { ...GITLAB_PIN, host } });
      onLocal('sourceControl.authStatus', (params) => {
        expect(params).toEqual({ provider: 'gitlab', host });
        return { ...status, host };
      });
      onLocal('sourceControl.identityProof.create', () => ({ ...snippet, host }));
      await handleInviteDeepLink(LINK);
      expect(localCalls('sourceControl.identityProof.create')).toEqual([
        [
          'sourceControl.identityProof.create',
          { provider: 'gitlab', host, nonce: CHALLENGE.nonce, hostLabel: '192.168.1.10' },
        ],
      ]);
      expect(prove).toHaveBeenCalledWith('inv-1', SECRET, {
        nonce: CHALLENGE.nonce,
        provider: 'gitlab',
        host,
        proofId: snippet.proofId,
        login: 'gl-user',
      });
      expect(localCalls('sourceControl.identityProof.delete')).toEqual([
        [
          'sourceControl.identityProof.delete',
          { provider: 'gitlab', host, proofId: snippet.proofId },
        ],
      ]);
    },
  );

  it.each(
    [GITHUB_PIN, GITLAB_PIN].flatMap((identity) =>
      [false, true].map((pinned) => ({ identity, pinned })),
    ),
  )(
    'carries only the required provider in account recovery for $identity.provider (pinned=$pinned)',
    async ({ identity, pinned }) => {
      challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: pinned ? identity : null });
      setPrincipal(identity);
      onLocal('github.getUser', () => ({ user: { id: 999, login: 'other' } }));
      onLocal('sourceControl.authStatus', () => ({ ...status, isConfigured: false, user: null }));
      await handleInviteDeepLink(LINK);
      expectNoProof();
      expect(showInviteNotice).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: pinned ? 'pin-mismatch' : 'identity-unavailable',
          accountProvider: identity.provider,
        }),
      );
      expect(localCalls('settings.set')).toEqual([]);
      expect(localCalls('sourceControl.revoke')).toEqual([]);
      expect(localCalls('github.connect')).toEqual([]);
    },
  );

  it.each([
    ['wrong provider', { provider: 'github' }],
    ['wrong instance', { host: 'another.gitlab.example.com:8443' }],
    ['same hostname, different port', { host: 'gitlab.example.com' }],
    ['same login, different stable ID', { user: { id: '9000', login: 'gl-user' } }],
    ['missing stable ID', { user: { login: 'gl-user' } }],
    ['numeric instead of string ID', { user: { id: 4711, login: 'gl-user' } }],
    ['invented externalUserId field', { user: { externalUserId: '4711', login: 'gl-user' } }],
    ['no connection', { isConfigured: false, user: null }],
    ['no resolved user', { user: null }],
    ['missing login', { user: { id: '4711' } }],
  ])('a GitLab pin refuses %s before publishing any proof', async (_label, patch) => {
    onLocal('sourceControl.authStatus', () => ({ ...status, ...patch }));
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(localCalls('github.connect')).toEqual([]);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'pin-mismatch' }),
    );
  });

  it.each([
    undefined,
    false,
    [],
    {},
    '',
    { ...GITLAB_PIN, provider: 'other' },
    { ...GITLAB_PIN, host: '' },
    { ...GITLAB_PIN, host: 'https://gitlab.example.com' },
    { ...GITLAB_PIN, host: 'GitLab.example.com' },
    { ...GITLAB_PIN, host: 'gitlab.example.com/path' },
    { ...GITLAB_PIN, host: 'u@github.com' },
    { ...GITLAB_PIN, host: 'gitlab.com?secret=hidden' },
    { ...GITLAB_PIN, externalUserId: '' },
    { ...GITLAB_PIN, externalUserId: ' 4711' },
    { ...GITLAB_PIN, externalUserId: 4711 },
    { ...GITHUB_PIN, host: 'github.enterprise.test' },
  ])('malformed non-null pin metadata fails closed: %j', async (pinIdentity) => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity });
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localRequest).not.toHaveBeenCalled();
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'pin-mismatch' }),
    );
    expect(showInviteNotice.mock.calls.at(-1)?.[0].accountProvider).toBeUndefined();
  });

  it.each([GITHUB_PIN, GITLAB_PIN])(
    'explicitly unpinned uses principal.me identity $provider',
    async (identity) => {
      challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
      setPrincipal(identity);
      if (identity.provider === 'gitlab') {
        onLocal('github.getUser', () => {
          throw localRefusal('rate-limited');
        });
      } else {
        onLocal('sourceControl.authStatus', () => {
          throw localRefusal('rate-limited');
        });
      }
      await handleInviteDeepLink(LINK);
      expect(localCalls('principal.me')).toEqual(Array(3).fill(['principal.me', {}]));
      expect(showInviteConsent.mock.calls[0][0]).toMatchObject({
        mode: 'prove',
        identity: {
          provider: identity.provider,
          host: identity.host,
        },
      });
      expect(
        localCalls(identity.provider === 'gitlab' ? 'github.getUser' : 'sourceControl.authStatus'),
      ).toEqual([]);
      expect(guestAdd).toHaveBeenCalledOnce();
      for (const [method] of localRequest.mock.calls) {
        expect([
          'principal.me',
          'github.getUser',
          'sourceControl.authStatus',
          'github.identityProof.create',
          'github.identityProof.delete',
          'sourceControl.identityProof.create',
          'sourceControl.identityProof.delete',
        ]).toContain(method);
      }
    },
  );

  it('a malformed chosen identity never falls back to connected GitHub', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
    setPrincipal({ ...GITLAB_PIN, externalUserId: null });
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'identity-unavailable' }),
    );
  });

  it('an unavailable selected GitLab account never falls back to connected GitHub', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
    setPrincipal(GITLAB_PIN);
    onLocal('sourceControl.authStatus', () => ({ ...status, isConfigured: false, user: null }));
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'identity-unavailable' }),
    );
  });

  it('explicit null on an old sidecar keeps the documented GitHub legacy path', async () => {
    localProtocolVersion.mockReturnValue('10.7'); // protocol-version-ok: old-sidecar fixture
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
    setPrincipal(GITLAB_PIN);
    await handleInviteDeepLink(LINK);
    expect(localCalls('principal.me')).toEqual([]);
    expect(localCalls('sourceControl.authStatus')).toEqual([]);
    expect(localCalls('github.identityProof.create')).toHaveLength(1);
    expect(guestAdd).toHaveBeenCalledOnce();
  });

  it('an old sidecar cannot bypass a GitLab pin through GitHub', async () => {
    localProtocolVersion.mockReturnValue('10.7'); // protocol-version-ok: old-sidecar fixture
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localRequest).not.toHaveBeenCalled();
    expect(showInviteNotice.mock.calls.at(-1)?.[0].accountProvider).toBeUndefined();
  });

  it.each([42, 9000])(
    'an old sidecar still enforces a GitHub pin against numeric ID %s',
    async (id) => {
      localProtocolVersion.mockReturnValue('10.7'); // protocol-version-ok: old-sidecar fixture
      challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: GITHUB_PIN });
      onLocal('github.getUser', () => ({ user: { id, login: 'octocat' } }));
      await handleInviteDeepLink(LINK);
      if (id === 42) expect(guestAdd).toHaveBeenCalledOnce();
      else expectNoProof();
      expect(localCalls('sourceControl.authStatus')).toEqual([]);
    },
  );

  it('a pinned account change during consent is rejected before proof creation', async () => {
    const consent = fakeConsent('pending');
    showInviteConsent.mockReturnValueOnce(consent.prompt);
    const join = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(showInviteConsent).toHaveBeenCalledOnce());
    onLocal('sourceControl.authStatus', () => ({
      ...status,
      user: { id: '9000', login: 'gl-user' },
    }));
    consent.decide('open');
    await join;
    expectNoProof();
    expect(consent.prompt.dismiss).toHaveBeenCalledWith('failed');
  });

  it('an unpinned chosen provider change during consent requests consent for the new account', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
    setPrincipal(GITLAB_PIN);
    const first = fakeConsent('pending');
    showInviteConsent.mockReturnValueOnce(first.prompt);
    const join = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(showInviteConsent).toHaveBeenCalledOnce());
    setPrincipal(GITHUB_PIN);
    first.decide('open');
    await join;
    expect(showInviteConsent.mock.calls.map(([p]) => p.identity.provider)).toEqual([
      'gitlab',
      'github',
    ]);
    expect(localCalls('sourceControl.identityProof.create')).toEqual([]);
    expect(localCalls('github.identityProof.create')).toHaveLength(1);
    expect(first.prompt.dismiss).toHaveBeenCalledWith('superseded');
  });

  it.each([
    { externalUserId: '9000' },
    { externalUserId: null },
    { provider: 'github' },
    { host: 'other.gitlab.example.com:8443' },
  ])('a changed proof identity %j is deleted without being sent to the host', async (patch) => {
    onLocal('sourceControl.identityProof.create', () => ({ ...snippet, ...patch }));
    await handleInviteDeepLink(LINK);
    expect(prove).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(localCalls('sourceControl.identityProof.delete')).toEqual([
      [
        'sourceControl.identityProof.delete',
        { provider: 'gitlab', host: GITLAB_PIN.host, proofId: snippet.proofId },
      ],
    ]);
  });

  it('same-login GitHub account swap during proof creation is deleted and never proven', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: GITHUB_PIN });
    onLocal('github.identityProof.create', () => {
      onLocal('github.getUser', () => ({ user: { id: 9000, login: 'octocat' } }));
      return PROOF;
    });
    await handleInviteDeepLink(LINK);
    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('github.identityProof.delete')).toHaveLength(1);
  });

  it('a changed pin on refreshed challenge is checked before another proof', async () => {
    prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-expired' }));
    challenge
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN })
      .mockResolvedValueOnce({
        ...CURRENT_CHALLENGE,
        nonce: 'nonce-2',
        pinIdentity: { ...GITLAB_PIN, externalUserId: '9000' },
      });
    await handleInviteDeepLink(LINK);
    expect(challenge).toHaveBeenCalledTimes(2);
    expect(localCalls('sourceControl.identityProof.create')).toHaveLength(1);
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(1);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  it('a refreshed pin selecting another connected forge needs fresh consent', async () => {
    prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-invalid' }));
    challenge
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN })
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, nonce: 'nonce-2', pinIdentity: GITHUB_PIN });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent.mock.calls.map(([p]) => p.identity.provider)).toEqual([
      'gitlab',
      'github',
    ]);
    expect(prove).toHaveBeenLastCalledWith('inv-1', SECRET, {
      nonce: 'nonce-2',
      gistId: PROOF.gistId,
      login: PROOF.login,
    });
    expect(guestAdd).toHaveBeenCalledOnce();
  });

  it('a pinned relevant probe rate limit stays a rate limit with no fallback', async () => {
    onLocal('sourceControl.authStatus', () => {
      throw localRefusal('rate-limited');
    });
    await handleInviteDeepLink(LINK);
    expectNoProof();
    expect(localCalls('github.getUser')).toEqual([]);
    expect(showInviteNotice).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'gitlab-rate-limited' }),
    );
  });

  it.each([2, 3])(
    'cancel during account revalidation probe %s ends quietly and cleans any proof',
    async (blockedProbe) => {
      const consent = fakeConsent('open');
      showInviteConsent.mockReturnValueOnce(consent.prompt);
      let release!: (result: unknown) => void;
      let probes = 0;
      onLocal('sourceControl.authStatus', () => {
        if (++probes === blockedProbe)
          return new Promise((resolve) => {
            release = resolve;
          });
        return status;
      });
      const join = handleInviteDeepLink(LINK);
      await vi.waitFor(() => expect(probes).toBe(blockedProbe));
      consent.cancelWaiting();
      await join;
      release(status);
      await Promise.resolve();
      expect(prove).not.toHaveBeenCalled();
      expect(guestAdd).not.toHaveBeenCalled();
      expect(showInviteNotice).not.toHaveBeenCalled();
      expect(localCalls('sourceControl.identityProof.create')).toHaveLength(
        blockedProbe === 3 ? 1 : 0,
      );
      expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(
        blockedProbe === 3 ? 1 : 0,
      );
      expect(consent.prompt.dismiss).toHaveBeenCalledWith('cancelled');
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('a refreshed challenge cannot drop known pin metadata and use a legacy fallback', async () => {
    prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-expired' }));
    challenge
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN })
      .mockResolvedValueOnce(CHALLENGE);
    await handleInviteDeepLink(LINK);
    expect(localCalls('github.getUser')).toEqual([]);
    expect(localCalls('sourceControl.identityProof.create')).toHaveLength(1);
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(1);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
  });

  it('unchanged pin on refreshed challenge reuses consent and publishes only the new nonce', async () => {
    prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-expired' }));
    challenge
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN })
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: GITLAB_PIN, nonce: 'nonce-2' });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).toHaveBeenCalledOnce();
    expect(localCalls('sourceControl.identityProof.create')[1]).toEqual([
      'sourceControl.identityProof.create',
      { provider: 'gitlab', host: GITLAB_PIN.host, nonce: 'nonce-2', hostLabel: '192.168.1.10' },
    ]);
    expect(guestAdd).toHaveBeenCalledOnce();
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(2);
  });

  it('a changed chosen account during proof creation is deleted before fresh consent', async () => {
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: null });
    setPrincipal(GITLAB_PIN);
    onLocal('sourceControl.identityProof.create', () => {
      setPrincipal(GITHUB_PIN);
      return snippet;
    });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent.mock.calls.map(([p]) => p.identity.provider)).toEqual([
      'gitlab',
      'github',
    ]);
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(1);
    expect(prove).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET, {
      nonce: CHALLENGE.nonce,
      gistId: PROOF.gistId,
      login: PROOF.login,
    });
  });
});

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

describe('handleInviteDeepLink — collaboration-only continuation', () => {
  const identity = { provider: 'github' as const, host: 'github.com', externalUserId: '42' };
  let allowed = true;
  let current = true;
  let prepared: import('../../../collaboration-auth/main/collaboration-auth-flow').PreparedCollaborationIdentity;
  beforeEach(() => {
    allowed = true;
    current = true;
    captureIdentity.mockReturnValue({ supported: true });
    localMethods.clear();
    onLocal('identity.getUser', () => ({ user: { id: '42', login: 'octocat' } }));
    onLocal('sourceControl.identityProof.create', () => ({
      ...identity,
      proofId: PROOF.gistId,
      login: 'octocat',
    }));
    onLocal('sourceControl.identityProof.delete', () => ({ ok: true }));
    prepared = {
      attempt: { id: 'fixture', metadataRevision: 0, current: () => true },
      identity,
      login: 'octocat',
      invitation: { scope: 'workspace', pinIdentity: identity },
      local: {
        supported: true,
        gitlabSupported: true,
        current: () => current,
        request: localRequest as never,
      },
      allowed: () => allowed,
    };
    prepareIdentity.mockImplementation(async (_request, { attempt }) => ({
      kind: 'ready',
      prepared: { ...prepared, attempt },
    }));
    challenge.mockResolvedValue({ ...CURRENT_CHALLENGE, pinIdentity: identity });
    showInviteConsent.mockImplementation(() => fakeConsent('open').prompt);
  });
  it.each([undefined, null, identity])(
    'passes pin metadata %j unchanged and resumes using only local collaboration proof',
    async (pinIdentity) => {
      challenge.mockResolvedValue({
        ...CHALLENGE,
        ...(pinIdentity === undefined ? {} : { pinIdentity }),
      });
      await handleInviteDeepLink(LINK);
      expect(prepareIdentity).toHaveBeenCalledExactlyOnceWith(
        {
          scope: 'workspace',
          ...(pinIdentity === undefined ? {} : { pinIdentity }),
          hostLabel: '192.168.1.10',
          workspaceTitle: CHALLENGE.workspaceTitle,
        },
        { attempt: expect.objectContaining({ id: expect.any(String), metadataRevision: 0 }) },
      );
      expect(localCalls('sourceControl.identityProof.create')).toEqual([
        [
          'sourceControl.identityProof.create',
          {
            provider: 'github',
            purpose: 'collaboration',
            expectedIdentity: identity,
            nonce: CHALLENGE.nonce,
            hostLabel: '192.168.1.10',
          },
        ],
      ]);
      expect(prove).toHaveBeenCalledExactlyOnceWith('inv-1', SECRET, {
        nonce: CHALLENGE.nonce,
        gistId: PROOF.gistId,
        login: 'octocat',
      });
      expect(localCalls('sourceControl.identityProof.delete')).toEqual([
        [
          'sourceControl.identityProof.delete',
          { provider: 'github', purpose: 'collaboration', proofId: PROOF.gistId },
        ],
      ]);
      expect(
        localRequest.mock.calls.every(
          ([method]) =>
            method === 'identity.getUser' || method.startsWith('sourceControl.identityProof.'),
        ),
      ).toBe(true);
      expect(guestAdd).toHaveBeenCalledOnce();
    },
  );
  it('cancel keeps the invitation and never creates proof or redeems it', async () => {
    prepareIdentity.mockResolvedValue({ kind: 'cancelled', request: prepared.invitation });
    await handleInviteDeepLink(LINK);
    expect(localRequest).not.toHaveBeenCalled();
    expect(prove).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showInviteNotice).not.toHaveBeenCalled();
  });
  it('refuses a different pin on challenge retry instead of reusing account consent', async () => {
    prove.mockRejectedValueOnce(new InviteRpcError(-32602, { code: 'proof-expired' }));
    challenge
      .mockResolvedValueOnce({ ...CURRENT_CHALLENGE, pinIdentity: identity })
      .mockResolvedValueOnce({
        ...CURRENT_CHALLENGE,
        nonce: 'new-nonce',
        pinIdentity: { ...identity, externalUserId: '99' },
      });
    await handleInviteDeepLink(LINK);
    expect(prove).toHaveBeenCalledOnce();
    expect(localCalls('sourceControl.identityProof.create')).toHaveLength(1);
    expect(guestAdd).not.toHaveBeenCalled();
  });
  it.each(['flag', 'connection'] as const)(
    'a %s change while proof is pending prevents redemption and cleans up when possible',
    async (change) => {
      onLocal('sourceControl.identityProof.create', () => {
        if (change === 'flag') allowed = false;
        else current = false;
        return { ...identity, proofId: PROOF.gistId, login: 'octocat' };
      });
      await handleInviteDeepLink(LINK);
      expect(prove).not.toHaveBeenCalled();
      expect(guestAdd).not.toHaveBeenCalled();
      expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(
        change === 'flag' ? 1 : 0,
      );
    },
  );
  it('a flag change during final account validation cannot send the proof to the host', async () => {
    let reads = 0;
    onLocal('identity.getUser', () => {
      if (++reads === 2) allowed = false;
      return { user: { id: '42', login: 'octocat' } };
    });
    await handleInviteDeepLink(LINK);
    expect(prove).not.toHaveBeenCalled();
    expect(localCalls('sourceControl.identityProof.delete')).toHaveLength(1);
  });
});
