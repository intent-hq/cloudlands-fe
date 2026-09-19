/**
 * Security audit for the invite deep link: the one-time invite secret and the
 * minted guest token must never reach a log line, whatever spelling of the
 * credential query key the URI parser accepts and whatever free-form text an
 * error carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shell } from 'electron';

const mocks = vi.hoisted(() => ({
  logs: [] as string[],
  start: vi.fn(),
  wait: vi.fn(),
  add: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock('$shared/logger', () => ({
  Logger: class {
    info(...args: unknown[]) {
      mocks.logs.push(JSON.stringify(args));
    }
    warn(...args: unknown[]) {
      mocks.logs.push(JSON.stringify(args));
    }
    error(...args: unknown[]) {
      mocks.logs.push(JSON.stringify(args));
    }
  },
}));
vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isReady: () => true },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: mocks.dialog },
}));
vi.mock('../../../../main/state', () => ({ getMainWindow: () => null }));
vi.mock('../../../protocol/main/protocol-adapter', () => ({ protocolAdapter: {} }));
vi.mock('../../../backend/main/guest-sessions-store', () => ({
  add: mocks.add,
  GuestStoreCorruptError: class extends Error {},
  GuestEncryptionUnavailableError: class extends Error {},
}));
vi.mock('../../../backend/main/backend.ipc', () => ({ openBackendWindow: mocks.open }));
vi.mock('../../../backend/main/backend-connection', () => ({
  PinMismatchError: class extends Error {},
}));
vi.mock('../../../backend/main/invite-connection', () => ({
  InviteRpcError: class extends Error {},
  InviteTransportError: class extends Error {},
  openInviteConnection: vi.fn(async () => ({
    host: '127.0.0.1',
    via: 'direct',
    redeemStart: mocks.start,
    redeemWait: mocks.wait,
    close: mocks.close,
  })),
}));

import { parseInviteUri } from '$shared/utils/invite-uri';
import { DeepLinkHandler } from '../../deep-link-handler';
import { scrubToken } from '../../utils/scrub-token';
import { handleInviteDeepLink } from '../invite-deep-link';

const secret = 'review-only-invite-marker';
const token = 'review-only-credential-marker';
const link = `intent://invite?v=1&host=127.0.0.1&port=8443&fp=AA&inviteId=review&secret=${secret}`;

async function replayColdStart(url: string): Promise<ReturnType<typeof vi.fn>> {
  const router = new DeepLinkHandler();
  await router.handleDeepLink(url, null);
  const send = vi.fn();
  await router.processPendingUrl({ webContents: { send } } as never);
  return send;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.logs.length = 0;
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.start.mockResolvedValue({
    flowId: 'review',
    userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 60,
    workspaceTitle: 'Review',
  });
  mocks.wait.mockResolvedValue({
    token,
    principalId: 'review',
    login: 'review',
    workspaceId: 'review',
  });
  mocks.add.mockResolvedValue({ id: 'review', tokenEncrypted: true });
});

describe('review: secret boundary', () => {
  it('redacts an encoded secret query key during cold-start replay', async () => {
    const encoded = link.replace('&secret=', '&%73ecret=');
    expect(parseInviteUri(encoded)?.secret === secret).toBe(true);
    const send = await replayColdStart(encoded);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.logs.some((line) => line.includes(secret))).toBe(false);
  });

  it('does not log the minted credential from an unlabeled error message', async () => {
    mocks.add.mockRejectedValueOnce(new Error(`Encryption refused input ${token}`));
    await handleInviteDeepLink(link);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.logs.some((line) => line.includes(token))).toBe(false);
  });

  it('keeps a normal cold-start invite token-free at renderer IPC', async () => {
    const send = await replayColdStart(link);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.logs.some((line) => line.includes(secret) || line.includes(token))).toBe(false);
  });

  // The WHATWG URL parser strips ASCII tab/LF/CR anywhere in its input, so
  // these spellings all redeem as `secret=<marker>` — the log scrubber must
  // agree with the parser about what the credential key is.
  it.each([
    ['LF inside the key', 'sec\nret='],
    ['tab after the key', 'secret\t='],
    ['tab before the value', 'secret=\t'],
    ['CR inside the key', 'sec\rret='],
  ])(
    'redacts a credential key the URL parser normalizes (%s) during cold-start replay',
    async (_name, spelling) => {
      const variant = link.replace('&secret=', `&${spelling}`);
      expect(parseInviteUri(variant)?.secret === secret).toBe(true);
      await replayColdStart(variant);
      expect(mocks.open).toHaveBeenCalledOnce();
      expect(mocks.logs.some((line) => line.includes(secret))).toBe(false);
    },
  );

  it('aborts before storing or opening when the OS refuses to launch the verification URL', async () => {
    vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error(`launch refused for ${token}`));
    await handleInviteDeepLink(link);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.dialog.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error' });
    const allLogs = mocks.logs.join('\n');
    expect(allLogs).toContain('verification-launch-failed');
    expect(allLogs).not.toContain(token);
  });
});

describe('review: scrubToken key spellings', () => {
  const spellings = [
    'secret',
    'SECRET',
    'Secret',
    '%73ecret',
    '%53ECRET',
    's%65cret',
    '%73%65%63%72%65%74',
    'token',
    'TOKEN',
    '%74oken',
    't%6Fken',
  ];
  for (const key of spellings) {
    it(`redacts the value of a "${key}" query key`, () => {
      const scrubbed = scrubToken(`intent://x?v=1&${key}=${secret}&host=h`);
      expect(scrubbed).not.toContain(secret);
      expect(scrubbed).toContain('host=h');
    });
  }

  it('redacts every credential key spelled differently in the same URL', () => {
    const scrubbed = scrubToken(`intent://x?%73ecret=${secret}&TOKEN=${token}&fp=AA`);
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).not.toContain(token);
    expect(scrubbed).toContain('fp=AA');
  });

  it('leaves non-credential keys and free text untouched', () => {
    const text = 'Received open-url event: intent://open?id=ws_123&title=a%20b';
    expect(scrubToken(text)).toBe(text);
  });
});
