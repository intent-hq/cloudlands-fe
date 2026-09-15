import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the `intent://invite` deep-link join flow
 * (features/deeplink/main/invite-deep-link.ts): confirm → dial `/invite`
 * with the pin → device code shown → credential stored as a GUEST session
 * (never a paired backend) → window opened; malformed links are rejected
 * fail-soft, the secret and the minted token never reach a log line, and a
 * redeem error maps onto a failure dialog instead of a crash.
 */

const showMessageBox = vi.fn();
const appIsReady = vi.fn(() => true);
const clipboardWriteText = vi.fn();
const openExternal = vi.fn();
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
    get openInviteConnection() {
      return openInviteConnection;
    },
  };
});

vi.mock('../../../../main/state', () => ({
  getMainWindow: () => null,
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

import {
  GuestEncryptionUnavailableError,
  GuestStoreCorruptError,
} from '../../../backend/main/guest-sessions-store';
import { InviteRpcError } from '../../../backend/main/invite-connection';
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
});

describe('handleInviteDeepLink', () => {
  it('happy path: confirm → dial with pin → redeem → store GUEST session → open window', async () => {
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
    // Confirm dialog + device-code dialog; no failure dialog.
    expect(showMessageBox).toHaveBeenCalledTimes(2);

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

  it('dialing happens only after the user confirms; cancel dials nothing', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 });
    await handleInviteDeepLink(LINK);
    expect(openInviteConnection).not.toHaveBeenCalled();
    expect(redeemStart).not.toHaveBeenCalled();
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('cancelling the device-code dialog stores nothing and closes the connection', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    redeemWait.mockReturnValue(new Promise(() => {}));
    await handleInviteDeepLink(LINK);
    expect(redeemStart).toHaveBeenCalledTimes(1);
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
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      message: expect.stringContaining('tc-key-abc:8443'),
    });
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
      // Confirm + failure dialog only — the device-code dialog never showed
      // the URL.
      expect(showMessageBox).toHaveBeenCalledTimes(2);
      expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });
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
    // Confirm + device code + plaintext warning.
    expect(showMessageBox).toHaveBeenCalledTimes(3);
    expect(showMessageBox.mock.calls[2][0]).toMatchObject({ type: 'warning' });
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
    // Confirm + failure dialog.
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1][0]).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(logLines.join('\n')).toContain('invite-expired');
  });

  // Multiplayer guest caps (intent-hq/intentd#1917): the guest cap is spent
  // at join time, so a redeem can be refused with `workspace-full`. It is a
  // documented code — logged and given its own sentence, not the generic one.
  it('workspace-full redeem refusal: distinct failure dialog, code logged, nothing stored', async () => {
    redeemStart.mockRejectedValue(new InviteRpcError(-32001, { code: 'workspace-full' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const fullDialog = showMessageBox.mock.calls.at(-1)?.[0] as { type: string; message: string };
    expect(fullDialog).toMatchObject({ type: 'error' });
    expect(guestAdd).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toContain('workspace-full');

    redeemStart.mockRejectedValue(new InviteRpcError(-32001, { code: 'some-unknown-code' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    const genericDialog = showMessageBox.mock.calls.at(-1)?.[0] as { message: string };
    expect(genericDialog.message).not.toBe(fullDialog.message);
  });

  it('phase-2 rejection (denied) after opening GitHub: failure dialog, nothing stored', async () => {
    redeemWait.mockRejectedValue(new InviteRpcError(-32002, { code: 'invite-flow-denied' }));
    await expect(handleInviteDeepLink(LINK)).resolves.toBeUndefined();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(guestAdd).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(3);
    expect(showMessageBox.mock.calls[2][0]).toMatchObject({ type: 'error' });
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
    expect(showMessageBox).toHaveBeenCalledTimes(1);
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
