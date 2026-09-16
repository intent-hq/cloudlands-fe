import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the `intent://invite` deep-link join flow
 * (features/deeplink/main/invite-deep-link.ts): dial `/invite` with the pin
 * (no fingerprint confirmation) → device code shown → credential stored as a GUEST session
 * (never a paired backend) → window opened; malformed links are rejected
 * fail-soft, the secret and the minted token never reach a log line, and a
 * redeem error maps onto a failure dialog instead of a crash.
 */

const showMessageBox = vi.fn();
const appIsReady = vi.fn(() => true);
const clipboardWriteText = vi.fn();
const openExternal = vi.fn();
/** `ipcMain.handle` registrations of the real `main/invite-consent.ts` (see the last describe). */
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
  };
});

const openBackendWindow = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  get openBackendWindow() {
    return openBackendWindow;
  },
}));

vi.mock('../../../backend/main/backend-connection', () => ({
  PinMismatchError: class PinMismatchError extends Error {},
}));

const redeemStart = vi.fn();
const redeemWait = vi.fn();
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
 * unavailable-renderer path — the flow falls back to the native device-code
 * box, which the pre-existing tests below exercise.
 */
const showInviteConsent = vi.fn();
vi.mock('../../../../main/invite-consent', () => ({
  get showInviteConsent() {
    return showInviteConsent;
  },
}));

function fakeConsent(decision: 'open' | 'cancel' | null) {
  let cancelWaiting!: () => void;
  const prompt = {
    decision: Promise.resolve(decision),
    cancelledWhileWaiting: new Promise<void>((resolve) => {
      cancelWaiting = resolve;
    }),
    dismiss: vi.fn(),
  };
  return { prompt, cancelWaiting };
}

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

import {
  GuestEncryptionUnavailableError,
  GuestStoreCorruptError,
} from '../../../backend/main/guest-sessions-store';
import {
  InviteRpcError,
  InviteTransportError,
  type InviteTransportCode,
} from '../../../backend/main/invite-connection';
import { handleInviteDeepLink, routeInviteLinkFromOs } from '../invite-deep-link';

const SECRET = 'invite-secret-value-xyz';
const TOKEN = 'minted-guest-token-value';
const BASE = 'intent://invite?v=1&host=192.168.1.10&port=8443&fp=AA:BB:CC';
const LINK = `${BASE}&inviteId=inv-1&secret=${SECRET}`;

const START = {
  flowId: 'flow-1',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
  workspaceId: 'ws-1',
  workspaceTitle: 'Shared workspace',
};
const CREDENTIAL = {
  status: 'authorized' as const,
  token: TOKEN,
  principalId: 'gh:42',
  login: 'octocat',
  workspaceId: 'ws-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  appIsReady.mockReturnValue(true);
  showMessageBox.mockResolvedValue({ response: 0 });
  openExternal.mockResolvedValue(undefined);
  openInviteConnection.mockResolvedValue({
    host: '192.168.1.10',
    via: 'direct',
    redeemStart,
    redeemWait,
    close,
  });
  redeemStart.mockResolvedValue(START);
  redeemWait.mockResolvedValue(CREDENTIAL);
  guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: true });
  openBackendWindow.mockResolvedValue({ id: 'guest-id' });
  showInviteConsent.mockImplementation(() => fakeConsent(null).prompt);
});

describe('handleInviteDeepLink', () => {
  it('happy path: dial with pin → redeem → store GUEST session → open window', async () => {
    await handleInviteDeepLink(`${LINK}&tc=ts.example:443`);

    expect(openInviteConnection).toHaveBeenCalledWith({
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: 'AA:BB:CC',
      tcAddress: 'ts.example:443',
    });
    expect(redeemStart).toHaveBeenCalledWith('inv-1', SECRET);
    expect(redeemWait).toHaveBeenCalledWith('flow-1', expect.any(Number));
    expect(redeemWait.mock.calls[0][1]).toBeGreaterThanOrEqual(START.expiresIn * 1000);

    expect(clipboardWriteText).toHaveBeenCalledWith(START.userCode);
    expect(openExternal).toHaveBeenCalledWith(START.verificationUri);
    // Device-code dialog only: no fingerprint confirmation, no failure dialog.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'info',
      message: expect.stringContaining(START.workspaceTitle),
    });

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

  it('no dialog is shown before the device-code dialog (the single consent point)', async () => {
    const order: string[] = [];
    openInviteConnection.mockImplementation(async () => {
      order.push('dial');
      return { host: '192.168.1.10', via: 'direct', redeemStart, redeemWait, close };
    });
    showMessageBox.mockImplementation(async () => {
      order.push('dialog');
      return { response: 0 };
    });
    await handleInviteDeepLink(LINK);
    expect(order).toEqual(['dial', 'dialog']);
  });

  it('cancelling the device-code dialog aborts: no credential minted, connection closed', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 });
    redeemWait.mockReturnValue(new Promise(() => {}));
    await handleInviteDeepLink(LINK);
    expect(redeemStart).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
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
    openInviteConnection.mockResolvedValue({
      host: 'tc-key-abc',
      via: 'tunnel',
      redeemStart,
      redeemWait,
      close,
    });
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

  it.each([
    ['a non-https scheme', 'http://github.com/login/device'],
    ['a file URL', 'file:///tmp/evil'],
    ['a foreign host', 'https://github.com.evil.example/login/device'],
    ['a lookalike host', 'https://notgithub.com/login/device'],
    ['embedded credentials', 'https://user:pw@github.com/login/device'],
    ['a non-default port', 'https://github.com:8443/login/device'],
    ['a path other than the device flow', 'https://github.com/settings/tokens'],
    ['a path that only starts like the device flow', 'https://github.com/login/device-evil'],
    ['unparseable text', 'not a url'],
  ])(
    'refuses to show or open a verification URL with %s (bounded failure, nothing stored)',
    async (_name, verificationUri) => {
      redeemStart.mockResolvedValue({ ...START, verificationUri });
      await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
      expect(openExternal).not.toHaveBeenCalled();
      expect(redeemWait).not.toHaveBeenCalled();
      expect(guestAdd).not.toHaveBeenCalled();
      // Failure dialog only — the device-code dialog never showed the URL.
      expect(showMessageBox).toHaveBeenCalledTimes(1);
      expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
      const allLogs = logLines.join('\n');
      expect(allLogs).toContain('invalid-verification-uri');
      expect(allLogs).not.toContain(verificationUri);
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts a GitHub subdomain verification URL', async () => {
    redeemStart.mockResolvedValue({
      ...START,
      verificationUri: 'https://enterprise.github.com/login/device',
    });
    await handleInviteDeepLink(LINK);
    expect(openExternal).toHaveBeenCalledWith('https://enterprise.github.com/login/device');
    expect(guestAdd).toHaveBeenCalledTimes(1);
  });

  it('warns when the credential had to be stored in plaintext, then still opens the window', async () => {
    guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: false });
    await handleInviteDeepLink(LINK);
    // Device code + plaintext warning.
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'warning' });
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it.each([
    ['encryption unavailable (would downgrade)', new GuestEncryptionUnavailableError()],
    ['corrupt registry', new GuestStoreCorruptError()],
  ])('store refusal — %s: failure dialog, bounded code logged, no window', async (_name, error) => {
    guestAdd.mockRejectedValue(error);
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
    const allLogs = logLines.join('\n');
    expect(allLogs).toContain(error.code);
    expect(allLogs).not.toContain(TOKEN);
  });

  it('drops server-authored error text and unknown codes: only documented codes reach a log', async () => {
    redeemStart.mockRejectedValue(
      new InviteRpcError(-32602, { code: SECRET, detail: `secret=${SECRET} token=${TOKEN}` }),
    );
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(SECRET);
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).toContain('"inviteCode":null');
  });

  it('redeem error: shows a failure dialog, stores nothing, fails soft', async () => {
    redeemStart.mockRejectedValue(new InviteRpcError(-32001, { code: 'invite-expired' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    // Failure dialog only.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(logLines.join('\n')).toContain('invite-expired');
  });

  // Multiplayer guest caps (intent-hq/intentd#1917): the guest cap is spent
  // at join time — after the GitHub verification, on the phase-2 wait — so the
  // daemon refuses `invite.redeem` wait with `-32602` / `workspace-full`. It
  // is a documented code — logged and given its own sentence, not the
  // generic one.
  it('workspace-full redeem refusal: distinct failure dialog, code logged, nothing stored', async () => {
    redeemWait.mockRejectedValue(new InviteRpcError(-32602, { code: 'workspace-full' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(redeemStart).toHaveBeenCalled();
    expect(redeemWait).toHaveBeenCalledWith('flow-1', expect.any(Number));
    const fullDialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(fullDialog).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('workspace-full');

    redeemWait.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const genericDialog = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    expect(genericDialog.message).not.toBe(fullDialog.message);
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
      expect(redeemStart).not.toHaveBeenCalled();
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
    // An unknown redeem refusal still gets the generic sentence.
    openInviteConnection.mockResolvedValue({
      host: '192.168.1.10',
      via: 'direct',
      redeemStart,
      redeemWait,
      close,
    });
    redeemStart.mockRejectedValue(new InviteRpcError(-32602, { code: 'some-unknown-code' }));
    await handleInviteDeepLink(LINK);
    const generic = (showMessageBox.mock.calls.at(-1)?.[0] as { message: string }).message;

    expect(new Set(messages.values()).size).toBe(TRANSPORT_CODES.length);
    for (const message of messages.values()) expect(message).not.toBe(generic);
  });

  it('a connection lost mid-redeem surfaces as connection-closed, not as the generic sentence', async () => {
    redeemWait.mockRejectedValue(new InviteTransportError('connection-closed'));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
    expect(logLines.join('\n')).toContain('"transportCode":"connection-closed"');
  });

  it('phase-2 rejection (denied) after opening GitHub: failure dialog, nothing stored', async () => {
    redeemWait.mockRejectedValue(new InviteRpcError(-32002, { code: 'invite-flow-denied' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });
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

// The in-app consent modal (spec "In-app invite consent dialog"): the device
// code is shown in the renderer; the native box is only the no-window/no-ack
// fallback. The secret and the minted token never enter the show payload.
describe('handleInviteDeepLink — renderer consent modal', () => {
  it('renderer happy path: show → open → grant → dismiss joined, no native box', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);

    await handleInviteDeepLink(`${LINK}&tc=ts.example:443`);

    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    const payload = showInviteConsent.mock.calls[0][0];
    expect(payload).toEqual({
      requestId: expect.any(String),
      userCode: START.userCode,
      verificationUri: START.verificationUri,
      workspaceTitle: START.workspaceTitle,
      hostLabel: '192.168.1.10',
      expiresInMs: START.expiresIn * 1000,
    });
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(clipboardWriteText).toHaveBeenCalledWith(START.userCode);
    expect(openExternal).toHaveBeenCalledWith(START.verificationUri);
    expect(guestAdd).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(prompt.dismiss).toHaveBeenCalledWith('joined');
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('dismisses joined before the plaintext warning and the window open', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    guestAdd.mockResolvedValue({ id: 'guest-id', tokenEncrypted: false });
    const order: string[] = [];
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
    expect(order).toEqual(['dismiss:joined', 'warning', 'window']);
  });

  it('cancel before open: dismiss cancelled, nothing opened or stored, connection closed', async () => {
    const { prompt } = fakeConsent('cancel');
    showInviteConsent.mockReturnValue(prompt);
    redeemWait.mockReturnValue(new Promise(() => {}));

    await handleInviteDeepLink(LINK);

    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(prompt.dismiss).toHaveBeenCalledWith('cancelled');
    expect(openExternal).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel during the grant wait: aborts without storing a credential or opening a window', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    redeemWait.mockReturnValue(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    cancelWaiting();
    await pending;

    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(prompt.dismiss).toHaveBeenCalledWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a grant that only arrives after cancel is dropped (no late credential)', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    let grantCredential!: (value: typeof CREDENTIAL) => void;
    redeemWait.mockReturnValue(new Promise((resolve) => (grantCredential = resolve)));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    cancelWaiting();
    await pending;
    grantCredential(CREDENTIAL);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('cancel while the browser launch is still pending: a grant that settles first is still not stored', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    let finishLaunch!: () => void;
    openExternal.mockReturnValue(new Promise<void>((resolve) => (finishLaunch = resolve)));
    let grantCredential!: (value: typeof CREDENTIAL) => void;
    redeemWait.mockReturnValue(new Promise((resolve) => (grantCredential = resolve)));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    cancelWaiting();
    grantCredential(CREDENTIAL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishLaunch();
    await pending;

    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(prompt.dismiss).toHaveBeenCalledWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('cancel while a browser launch never settles: aborts and closes the connection', async () => {
    const { prompt, cancelWaiting } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    openExternal.mockReturnValue(new Promise<void>(() => {}));
    redeemWait.mockReturnValue(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    cancelWaiting();
    await pending;

    expect(prompt.dismiss).toHaveBeenCalledWith('cancelled');
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('no renderer (null decision): the native device-code box is the fallback and the join completes', async () => {
    showInviteConsent.mockReturnValue(fakeConsent(null).prompt);

    await handleInviteDeepLink(LINK);

    expect(showInviteConsent).toHaveBeenCalledTimes(1);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'info',
      message: expect.stringContaining(START.userCode),
    });
    expect(openExternal).toHaveBeenCalledWith(START.verificationUri);
    expect(openBackendWindow).toHaveBeenCalledWith('guest-id');
  });

  it('launch failure after open: dismiss failed, then the failure box; nothing stored', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    openExternal.mockRejectedValue(new Error('no browser'));
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showMessageBox.mockImplementation(async () => {
      order.push('failure-box');
      return { response: 0 };
    });

    await handleInviteDeepLink(LINK);

    expect(order).toEqual(['dismiss:failed', 'failure-box']);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('verification-launch-failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('grant refusal during the wait: dismiss failed before the failure box', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    redeemWait.mockRejectedValue(new InviteRpcError(-32002, { code: 'invite-flow-denied' }));

    await handleInviteDeepLink(LINK);

    expect(prompt.dismiss).toHaveBeenCalledTimes(1);
    expect(prompt.dismiss).toHaveBeenCalledWith('failed');
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
  });

  it('a refused verification URL never reaches the modal', async () => {
    redeemStart.mockResolvedValue({ ...START, verificationUri: 'http://github.com/login/device' });
    await handleInviteDeepLink(LINK);
    expect(showInviteConsent).not.toHaveBeenCalled();
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
  });

  it('store refusal after the grant: the modal was already dismissed joined, the failure box follows', async () => {
    const { prompt } = fakeConsent('open');
    showInviteConsent.mockReturnValue(prompt);
    guestAdd.mockRejectedValue(new GuestStoreCorruptError());
    const order: string[] = [];
    prompt.dismiss.mockImplementation((outcome: string) => order.push(`dismiss:${outcome}`));
    showMessageBox.mockImplementation(async () => {
      order.push('failure-box');
      return { response: 0 };
    });

    await handleInviteDeepLink(LINK);

    expect(order[0]).toBe('dismiss:joined');
    expect(order).not.toContain('dismiss:cancelled');
    expect(order.at(-1)).toBe('failure-box');
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({ type: 'error' });
    expect(openBackendWindow).not.toHaveBeenCalled();
  });
});

// The grant is the point of no return (PR #2513 review): once it resolves the
// host has minted the credential and consumed a seat, so a Cancel that lands
// while the guest-session write is still pending must not be honoured — and
// must not be reported to the UI as a cancellation either. Drives the REAL
// `main/invite-consent.ts` response handler so the path is the renderer's.
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

  it('hold the store write → ack → open → cancel → release: stored, opened, dismissed joined once', async () => {
    let releaseStore!: () => void;
    guestAdd.mockReturnValue(
      new Promise((resolve) => {
        releaseStore = () => resolve({ id: 'guest-id', tokenEncrypted: true });
      }),
    );

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('invite-consent:show', expect.anything()),
    );
    const { requestId } = send.mock.calls[0][1] as { requestId: string };
    const ack = registeredIpcHandlers.get('invite-consent:ack')!;
    const response = registeredIpcHandlers.get('invite-consent:response')!;
    await ack({}, { requestId });
    await response({}, { requestId, action: 'open' });
    await vi.waitFor(() => expect(guestAdd).toHaveBeenCalledTimes(1));
    // The grant resolved and the store write is in flight: the modal must
    // already be out of its waiting state before the user can cancel.
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

  it('a cancel before the grant still aborts through the real response handler', async () => {
    redeemWait.mockReturnValue(new Promise(() => {}));

    const pending = handleInviteDeepLink(LINK);
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('invite-consent:show', expect.anything()),
    );
    const { requestId } = send.mock.calls[0][1] as { requestId: string };
    await registeredIpcHandlers.get('invite-consent:ack')!({}, { requestId });
    const response = registeredIpcHandlers.get('invite-consent:response')!;
    await response({}, { requestId, action: 'open' });
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    await response({}, { requestId, action: 'cancel' });
    await pending;

    expect(dismissesSent()).toEqual([{ requestId, outcome: 'cancelled' }]);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).not.toContain('cancel-after-grant');
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
