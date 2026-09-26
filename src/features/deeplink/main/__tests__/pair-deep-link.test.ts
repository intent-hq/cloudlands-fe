import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the `intent://pair` deep-link connect flow
 * (features/deeplink/main/pair-deep-link.ts): known-server links foreground
 * without touching stored credentials, new-server links confirm + add + open,
 * malformed links are rejected fail-soft, and the bearer token never reaches
 * a log line.
 */

const showMessageBox = vi.fn();
const appIsReady = vi.fn(() => true);
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
}));

let lifetime = true;
vi.mock('../invite-attempt', () => ({
  captureInviteAttempt: () => ({ current: () => lifetime, allowed: () => lifetime, release() {} }),
}));
const inspectCredential = vi.hoisted(() => vi.fn());
vi.mock('../../../backend/main/invited-principal', async (actual) => ({
  ...(await actual<typeof import('../../../backend/main/invited-principal')>()),
  inspectPersonalCredential: inspectCredential,
}));
const { invitedAdd, invitedFind } = vi.hoisted(() => ({
  invitedAdd: vi.fn(),
  invitedFind: vi.fn(),
}));
vi.mock('../../../backend/main/guest-sessions-store', () => ({
  add: invitedAdd,
  findAllMatching: invitedFind,
}));
const findMatching = vi.fn();
const add = vi.fn();
vi.mock('../../../backend/main/connections-store', () => ({
  get findMatching() {
    return findMatching;
  },
  get add() {
    return add;
  },
}));

const openBackendWindow = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  get openBackendWindow() {
    return openBackendWindow;
  },
}));

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

import { handlePairDeepLink, routePairLinkFromOs } from '../pair-deep-link';
import { TC_ADDRESS_WITH_PSK } from '../../../../test/fixtures/tc-address.fixture';

const PIN = 'ab'.repeat(32);
const TOKEN = 'super-secret-token-value';
const LINK = `intent://pair?v=1&host=192.168.1.10&port=8443&fp=${PIN}&token=${TOKEN}`;

beforeEach(() => {
  vi.clearAllMocks();
  lifetime = true;
  inspectCredential.mockResolvedValue({
    principal: { id: 'owner', isAdministrator: true },
    capabilities: { hostMembership: false },
  });
  invitedFind.mockResolvedValue([]);
  invitedAdd.mockResolvedValue({ id: 'invited-person' });
  logLines.length = 0;
  appIsReady.mockReturnValue(true);
  openBackendWindow.mockResolvedValue({ id: 'x' });
  add.mockResolvedValue({ id: 'new-id' });
  findMatching.mockResolvedValue(null);
  showMessageBox.mockResolvedValue({ response: 0 });
});

describe('handlePairDeepLink', () => {
  it('known server: opens its window without dialog or credential rewrite', async () => {
    findMatching.mockResolvedValue({ id: 'known-id', fingerprint: PIN });
    await handlePairDeepLink(LINK);
    expect(findMatching).toHaveBeenCalledWith({
      hosts: ['192.168.1.10'],
      port: 8443,
      fingerprint: PIN,
    });
    expect(openBackendWindow).toHaveBeenCalledWith('known-id');
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('a route-only match still needs explicit trust before replacing an owner record)', async () => {
    findMatching.mockResolvedValue({ id: 'by-host' });
    await handlePairDeepLink(LINK);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('new-id');
  });

  it('new server: confirms, adds with token + tc, then opens', async () => {
    await handlePairDeepLink(`${LINK}&tc=ts.example:443`);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      label: '192.168.1.10',
      host: '192.168.1.10',
      port: 8443,
      fingerprint: PIN,
      token: TOKEN,
      tcAddress: 'ts.example:443',
    });
    expect(openBackendWindow).toHaveBeenCalledWith('new-id');
  });

  it('new server without tc omits tcAddress', async () => {
    await handlePairDeepLink(LINK);
    expect(add).toHaveBeenCalledWith(expect.not.objectContaining({ tcAddress: expect.anything() }));
  });

  it('dialog cancel: neither adds nor opens', async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    await handlePairDeepLink(LINK);
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it.each([
    ['not a pairing uri', 'https://example.com/'],
    ['missing token', 'intent://pair?v=1&host=h&port=8443&fp=AA:BB:CC'],
    ['missing host', `intent://pair?v=1&port=8443&fp=AA:BB:CC&token=${TOKEN}`],
    ['missing port', `intent://pair?v=1&host=h&fp=AA:BB:CC&token=${TOKEN}`],
    ['missing fingerprint', `intent://pair?v=1&host=h&port=8443&token=${TOKEN}`],
  ])('rejects link with %s without crashing or acting', async (_name, url) => {
    await expect(handlePairDeepLink(url)).resolves.toBeUndefined();
    expect(findMatching).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });

  it('never logs the token, including when a downstream step throws', async () => {
    findMatching.mockRejectedValue(new Error(`connect failed for token=${TOKEN} at host`));
    await expect(handlePairDeepLink(LINK)).resolves.toBeUndefined();
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain(TOKEN);
    expect(allLogs).toContain('Error');
    expect(allLogs).not.toContain('connect failed');
  });

  it('scrubs a complete pairing link echoed by a downstream error', async () => {
    const link = `${LINK}&tc=${TC_ADDRESS_WITH_PSK}`;
    add.mockRejectedValue(new Error(`Unable to connect using ${link}`));
    await expect(handlePairDeepLink(link)).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ tcAddress: TC_ADDRESS_WITH_PSK }));
    expect(logLines.join('\n')).not.toContain(TOKEN);
    expect(logLines.join('\n')).not.toContain(TC_ADDRESS_WITH_PSK);
  });

  it('fails soft when openBackendWindow rejects', async () => {
    findMatching.mockResolvedValue({ id: 'known-id', fingerprint: PIN });
    openBackendWindow.mockRejectedValue(new Error('probe failed'));
    await expect(handlePairDeepLink(LINK)).resolves.toBeUndefined();
  });

  it('drops a concurrent pair link while one is in flight (single dialog)', async () => {
    let resolveDialog!: (v: { response: number }) => void;
    showMessageBox.mockReturnValue(new Promise((resolve) => (resolveDialog = resolve)));
    const first = handlePairDeepLink(LINK);
    const second = handlePairDeepLink(LINK);
    await second;
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    resolveDialog({ response: 0 });
    await first;
    expect(add).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledTimes(1);
  });

  it('handles a subsequent link after the previous one settles', async () => {
    await handlePairDeepLink(LINK);
    await handlePairDeepLink(LINK);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });
});

describe('routePairLinkFromOs', () => {
  it('handles the link when the app is ready even with no window (macOS zero-window)', async () => {
    appIsReady.mockReturnValue(true);
    findMatching.mockResolvedValue({ id: 'known-id', fingerprint: PIN });
    const park = vi.fn();
    await routePairLinkFromOs(LINK, park);
    expect(openBackendWindow).toHaveBeenCalledWith('known-id');
    expect(park).not.toHaveBeenCalled();
  });

  it('parks the link before the app is ready', async () => {
    appIsReady.mockReturnValue(false);
    const park = vi.fn().mockResolvedValue(undefined);
    await routePairLinkFromOs(LINK, park);
    expect(park).toHaveBeenCalledWith(LINK);
    expect(findMatching).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });
});

describe('personal invited pairing (controlled authenticated principal fixture)', () => {
  it('stores a member separately from the owner and other people on the same host', async () => {
    inspectCredential.mockResolvedValue({
      principal: {
        id: 'C',
        login: null,
        isAdministrator: false,
        hostRole: 'member',
        identity: { provider: 'gitlab', host: 'gitlab.example', externalUserId: '7' },
      },
      capabilities: { hostMembership: true },
    });
    invitedFind.mockResolvedValue([{ id: 'B-record', principalId: 'B', fingerprint: PIN }]);
    await handlePairDeepLink(LINK);
    expect(invitedAdd).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'C', login: null, token: TOKEN, hostRole: 'member' }),
    );
    expect(findMatching).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).toHaveBeenCalledWith('invited-person', {
      mayOpen: expect.any(Function),
    });
  });
  it('classifies a legacy non-administrator as guest, never member or owner', async () => {
    inspectCredential.mockResolvedValue({
      principal: { id: 'B', login: 'guest', isAdministrator: false },
      capabilities: { hostMembership: false },
    });
    await handlePairDeepLink(LINK);
    expect(invitedAdd).toHaveBeenCalledWith(
      expect.objectContaining({ hostRole: 'guest', principalId: 'B' }),
    );
    expect(add).not.toHaveBeenCalled();
  });
  it('cancellation or Multiplayer disable during authentication stores nothing', async () => {
    inspectCredential.mockImplementation(async () => {
      lifetime = false;
      return {
        principal: { id: 'B', isAdministrator: false },
        capabilities: { hostMembership: false },
      };
    });
    await handlePairDeepLink(LINK);
    expect(invitedAdd).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });
  it('an unknown advertised role or a failed pinned authentication cannot enter either registry', async () => {
    inspectCredential.mockResolvedValue({
      principal: { id: 'B', isAdministrator: false, hostRole: 'unknown' },
      capabilities: { hostMembership: true },
    });
    await handlePairDeepLink(LINK);
    inspectCredential.mockRejectedValue(new Error('bounded failure'));
    await handlePairDeepLink(LINK);
    expect(invitedAdd).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
  });
});
