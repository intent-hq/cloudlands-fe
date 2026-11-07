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
vi.mock('../../../backend/main/desktop-connections-store', () => ({
  get findMatching() {
    return findMatching;
  },
  get add() {
    return add;
  },
}));

const openBackendWindow = vi.fn();
const NodeWindowRefusedError = vi.hoisted(
  () =>
    class NodeWindowRefusedError extends Error {
      constructor(readonly connectionId: string) {
        super('node');
      }
    },
);
vi.mock('../../../backend/main/backend.ipc', () => ({
  get openBackendWindow() {
    return openBackendWindow;
  },
  NodeWindowRefusedError,
}));

let mainWindow: unknown = null;
vi.mock('../../../../main/state', () => ({
  getMainWindow: () => mainWindow,
}));

const pairLinks = vi.hoisted(() => ({
  inspect: vi.fn(),
  commit: vi.fn(),
  discard: vi.fn(),
}));
vi.mock('../../../backend/main/pair-link.ipc', () => ({ getPairLinks: () => pairLinks }));
const queueDeepLinkForWindow = vi.hoisted(() => vi.fn());
vi.mock('../pending-deep-links', () => ({ queueDeepLinkForWindow }));

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

import { JsonRpcClient } from '../../../backend/main/json-rpc-client';
import { handlePairDeepLink, routePairLinkFromOs } from '../pair-deep-link';
import { TC_ADDRESS_WITH_PSK } from '../../../../test/fixtures/tc-address.fixture';

const PIN = 'ab'.repeat(32);
const TOKEN = 'super-secret-token-value';
const LINK = `intent://pair?v=1&host=192.168.1.10&port=8443&fp=${PIN}&token=${TOKEN}`;

beforeEach(() => {
  vi.clearAllMocks();
  lifetime = true;
  mainWindow = null;
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
  pairLinks.inspect.mockResolvedValue({
    ok: true,
    pendingId: 'pending-machine',
    kind: 'machine',
    label: 'Build box',
    existingId: null,
  });
});

function fakeWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

describe('a node pairing link', () => {
  beforeEach(() => {
    pairLinks.inspect.mockResolvedValue({
      ok: true,
      pendingId: 'pending-node',
      kind: 'node',
      label: 'GPU rig',
      existingId: null,
    });
  });

  it('never opens a backend window: the app window asks, with the pending id only', async () => {
    const window = fakeWindow();
    mainWindow = window;
    await handlePairDeepLink(LINK);
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(queueDeepLinkForWindow).toHaveBeenCalledWith(window, {
      type: 'node-link',
      params: { pendingId: 'pending-node', label: 'GPU rig', existingId: '' },
    });
    expect(JSON.stringify(queueDeepLinkForWindow.mock.calls)).not.toContain(TOKEN);
    expect(window.focus).toHaveBeenCalled();
    expect(logLines.join('\n')).not.toContain(TOKEN);
  });

  it('opens the local window first when the app has none, never the node', async () => {
    const window = fakeWindow();
    openBackendWindow.mockImplementation(async (id: string) => {
      mainWindow = window;
      return { id };
    });
    await handlePairDeepLink(LINK);
    expect(openBackendWindow).toHaveBeenCalledTimes(1);
    expect(openBackendWindow).toHaveBeenCalledWith('local');
    expect(queueDeepLinkForWindow).toHaveBeenCalledTimes(1);
  });

  it('a link marked mode=node whose test fails shows the failure and never opens a window', async () => {
    pairLinks.inspect.mockResolvedValue({ ok: false, code: 'unreachable', routes: [] });
    await handlePairDeepLink(`${LINK}&mode=node`);
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('a node found only when its window opens is not reported as a pairing failure', async () => {
    pairLinks.inspect.mockResolvedValue({ ok: false, code: 'unreachable', routes: [] });
    openBackendWindow.mockRejectedValue(new NodeWindowRefusedError('new-id'));
    await handlePairDeepLink(LINK);
    expect(add).toHaveBeenCalled();
    // Only the "connect to this backend?" confirmation, no failure dialog.
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('a full daemon keeps the owner pairing flow and drops its pending credential', async () => {
    pairLinks.inspect.mockResolvedValue({
      ok: true,
      pendingId: 'pending-machine',
      kind: 'machine',
      label: 'Build box',
      existingId: null,
    });
    await handlePairDeepLink(LINK);
    expect(pairLinks.discard).toHaveBeenCalledWith('pending-machine');
    expect(queueDeepLinkForWindow).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalled();
    expect(openBackendWindow).toHaveBeenCalledWith('new-id');
  });
});

describe('handlePairDeepLink', () => {
  it.each(['warm', 'cold'])(
    'shows the real early compatibility error for a %s pairing link without opening a window',
    async (launch) => {
      const actual = await vi.importActual<
        typeof import('../../../backend/main/invited-principal')
      >('../../../backend/main/invited-principal');
      inspectCredential.mockImplementation(actual.inspectPersonalCredential);
      const request = vi.spyOn(JsonRpcClient.prototype, 'request').mockResolvedValue({
        server: {
          version: '0.9.12',
          protocolVersion: '9.4', // fixture-protocol-version: old intentd 0.9.12 predates principal.me
          capabilities: { liveState: true },
        },
      });
      const dispose = vi.spyOn(JsonRpcClient.prototype, 'dispose');
      try {
        const park = vi.fn();
        if (launch === 'cold') {
          appIsReady.mockReturnValue(false);
          await routePairLinkFromOs(LINK, park);
          expect(park).toHaveBeenCalledWith(LINK);
          expect(showMessageBox).not.toHaveBeenCalled();
          appIsReady.mockReturnValue(true);
          await handlePairDeepLink(park.mock.calls[0][0]);
        } else await routePairLinkFromOs(LINK, park);
        expect(showMessageBox).toHaveBeenCalledOnce();
        const options = showMessageBox.mock.calls[0][0];
        expect(options.type).toBe('warning');
        expect(options.message).toContain('0.9.12');
        const { readPinnedVersion } = await import('../../../backend/main/intentd-version-pin');
        expect(readPinnedVersion()).not.toBeNull();
        expect(options.message).toContain(readPinnedVersion()!);
        expect(JSON.stringify(options)).not.toContain(TOKEN);
        expect(request.mock.calls.map(([method]) => method)).toEqual(['client.hello']);
        expect(dispose).toHaveBeenCalledOnce();
        expect(add).not.toHaveBeenCalled();
        expect(invitedAdd).not.toHaveBeenCalled();
        expect(openBackendWindow).not.toHaveBeenCalled();
      } finally {
        request.mockRestore();
        dispose.mockRestore();
      }
    },
  );

  it.each([false, true])(
    'shows one failure dialog when credential inspection fails (window=%s)',
    async (hasWindow) => {
      mainWindow = hasWindow ? { isDestroyed: () => false } : null;
      inspectCredential.mockRejectedValue(new Error(`Could not connect with token=${TOKEN}`));
      await handlePairDeepLink(LINK);
      expect(showMessageBox).toHaveBeenCalledOnce();
      const options = showMessageBox.mock.calls[0].at(-1);
      expect(options.type).toBe('error');
      expect(JSON.stringify(options)).not.toContain(TOKEN);
      expect(add).not.toHaveBeenCalled();
      expect(invitedAdd).not.toHaveBeenCalled();
      expect(openBackendWindow).not.toHaveBeenCalled();
      expect(showMessageBox.mock.calls[0].length).toBe(hasWindow ? 2 : 1);
    },
  );

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
    expect(allLogs).toContain('pairing-failed');
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

  it('keeps one failure dialog open for concurrent clicks and permits a later retry', async () => {
    inspectCredential.mockRejectedValue(new Error('unavailable'));
    let dismiss!: (result: { response: number }) => void;
    showMessageBox.mockReturnValue(
      new Promise((resolve) => {
        dismiss = resolve;
      }),
    );
    const first = handlePairDeepLink(LINK);
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledOnce());
    await handlePairDeepLink(LINK);
    expect(showMessageBox).toHaveBeenCalledOnce();
    dismiss({ response: 0 });
    await first;
    showMessageBox.mockResolvedValue({ response: 0 });
    await handlePairDeepLink(LINK);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(add).not.toHaveBeenCalled();
    expect(openBackendWindow).not.toHaveBeenCalled();
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
