import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Routing tests for createWindowForDeepLink: `intent://pair` links go straight
 * to the main-process pair handler — no new BrowserWindow, no renderer IPC,
 * and no bearer token in any log line. Renderer-bound links are queued for
 * their target window (pulled via `deep-link:consume-pending`): `open` links
 * → a local-daemon window; `create newWindow=true` → a new window; everything
 * else → the last-focused main window. Also covers createWindow's cold-start
 * argv scan: a pair link never reaches the renderer, other links are queued
 * for the first window only, and the scan matches the intent:// scheme
 * case-insensitively.
 */

const mockBrowserWindowCtor = vi.fn();
const mockLoadUrl = vi.fn(() => Promise.resolve());
const mockGetPrimaryDisplay = vi.fn(() => ({
  workArea: { x: 0, y: 0, width: 1440, height: 900 },
}));

// Windows visible to BrowserWindow.getAllWindows / fromWebContents.
const liveWindows: Array<{ webContents: unknown }> = [];
let nextWebContentsId = 1000;

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => `/tmp/deep-link-routing-test-${process.pid}`),
    getAppPath: vi.fn(() => '/tmp'),
    dock: undefined,
  },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => liveWindows);
    static fromWebContents = vi.fn(
      (webContents: unknown) => liveWindows.find((w) => w.webContents === webContents) ?? null,
    );
    loadURL = mockLoadUrl;
    focus = vi.fn();
    show = vi.fn();
    restore = vi.fn();
    isDestroyed = () => false;
    isMinimized = () => false;
    webContents = {
      id: nextWebContentsId++,
      on: vi.fn(),
      once: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      getURL: () => 'http://localhost/',
      session: { clearCache: vi.fn() },
    };
    on = vi.fn();
    once = vi.fn();
    constructor(options: unknown) {
      mockBrowserWindowCtor(options);
      createdWindows.push(this as unknown as { webContents: { id: number } });
      liveWindows.push(this as unknown as { webContents: unknown });
    }
  },
  screen: { getPrimaryDisplay: () => mockGetPrimaryDisplay() },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: { createFromPath: vi.fn() },
}));

const createdWindows: Array<{ webContents: { id: number } }> = [];
const mockGetMainWindow = vi.fn();
vi.mock('../state', () => ({
  getMainWindow: () => mockGetMainWindow(),
  setMainWindow: vi.fn(),
}));

const handlePairDeepLink = vi.fn();
vi.mock('../../features/deeplink/main/pair-deep-link', () => ({
  get handlePairDeepLink() {
    return handlePairDeepLink;
  },
}));

vi.mock('../utils/resolve-app-title', () => ({
  resolveAppTitle: () => 'Intent',
  registerWindowTitleListener: vi.fn(),
}));

vi.mock('../utils/resolve-app-icon', () => ({
  resolveAppIconPath: () => undefined,
  resolveAppDockIconPath: () => undefined,
}));

const logLines: string[] = [];
vi.mock('../../shared/logger', () => ({
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

import type { DeepLinkHandler } from '../../features/deeplink/deep-link-handler';
import {
  __resetPendingDeepLinksForTesting,
  consumePendingDeepLinks,
} from '../../features/deeplink/main/pending-deep-links';
import {
  __resetColdStartDeepLinkForTesting,
  createWindow,
  createWindowForDeepLink,
} from '../window';
import { markRendererWindowsAllowed } from '../renderer-window-gate';
import { findIntentUrl } from '../../features/deeplink/utils/find-intent-url';
import { TC_ADDRESS_WITH_PSK } from '../../test/fixtures/tc-address.fixture';

const TOKEN = 'super-secret-token-value';
const PAIR_LINK = `intent://pair?v=1&host=192.168.1.10&port=8443&fp=AA:BB:CC&token=${TOKEN}&tc=${TC_ADDRESS_WITH_PSK}`;

function makeMainWindow(backendId?: string) {
  const webContents = {
    id: nextWebContentsId++,
    send: vi.fn(),
    once: vi.fn(),
    isDestroyed: () => false,
    getURL: () => 'http://localhost/',
  };
  return {
    backendId,
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents,
  };
}

const NUDGE = { pending: true };

function makeHandler(): DeepLinkHandler {
  // The real parser is exercised via the pass-through; only the two methods
  // createWindowForDeepLink uses need to exist.
  return {
    parseDeepLink: (url: string) => {
      const parsed = new URL(url);
      const params: Record<string, string> = {};
      parsed.searchParams.forEach((v, k) => (params[k] = v));
      return { type: parsed.hostname || parsed.pathname.replace(/^\/+/, ''), params };
    },
    handleDeepLink: vi.fn(),
  } as unknown as DeepLinkHandler;
}

beforeEach(() => {
  vi.clearAllMocks();
  logLines.length = 0;
  handlePairDeepLink.mockResolvedValue(undefined);
  mockGetMainWindow.mockReturnValue(makeMainWindow());
  liveWindows.length = 0;
  createdWindows.length = 0;
  __resetPendingDeepLinksForTesting();
  __resetColdStartDeepLinkForTesting();
  markRendererWindowsAllowed();
});

describe('createWindowForDeepLink pair-link routing', () => {
  it('routes a pair link to the pair handler without creating a window or IPC', async () => {
    const mainWindow = makeMainWindow();
    mockGetMainWindow.mockReturnValue(mainWindow);
    await createWindowForDeepLink(PAIR_LINK, makeHandler());
    expect(handlePairDeepLink).toHaveBeenCalledWith(PAIR_LINK);
    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('never logs pairing credentials', async () => {
    await createWindowForDeepLink(PAIR_LINK, makeHandler());
    expect(logLines.join('\n')).not.toContain(TOKEN);
    expect(logLines.join('\n')).not.toContain(TC_ADDRESS_WITH_PSK);
  });

  it('queues settings links for the existing window and nudges it', async () => {
    const mainWindow = makeMainWindow();
    mockGetMainWindow.mockReturnValue(mainWindow);
    await createWindowForDeepLink('intent://settings?section=general', makeHandler());
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('deep-link', NUDGE);
    expect(consumePendingDeepLinks(mainWindow.webContents.id).actions).toEqual([
      { type: 'settings', params: { section: 'general' } },
    ]);
    expect(handlePairDeepLink).not.toHaveBeenCalled();
    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
  });
});

describe('createWindowForDeepLink renderer-bound routing', () => {
  it('keeps create links on the last-focused window, even a remote-bound one', async () => {
    const remoteWindow = makeMainWindow('remote-1');
    liveWindows.push(remoteWindow);
    mockGetMainWindow.mockReturnValue(remoteWindow);
    await createWindowForDeepLink('intent://create?repo=%2Frepo&prompt=fix', makeHandler());
    expect(consumePendingDeepLinks(remoteWindow.webContents.id).actions).toEqual([
      { type: 'create', params: { repo: '/repo', prompt: 'fix' } },
    ]);
    expect(remoteWindow.focus).toHaveBeenCalled();
    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
  });

  it('sends a folder link to the local window, not the focused remote window', async () => {
    const remoteWindow = makeMainWindow('remote-1');
    const localWindow = makeMainWindow();
    liveWindows.push(remoteWindow, localWindow);
    mockGetMainWindow.mockReturnValue(remoteWindow);
    await createWindowForDeepLink('intent://open?path=%2FUsers%2Fme%2Fmy%20dir', makeHandler());
    expect(consumePendingDeepLinks(localWindow.webContents.id).actions).toEqual([
      { type: 'open', params: { path: '/Users/me/my dir' } },
    ]);
    expect(localWindow.webContents.send).toHaveBeenCalledWith('deep-link', NUDGE);
    expect(localWindow.focus).toHaveBeenCalled();
    expect(consumePendingDeepLinks(remoteWindow.webContents.id).actions).toEqual([]);
    expect(remoteWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('takes only the requested types and reports what is left queued', async () => {
    const localWindow = makeMainWindow();
    liveWindows.push(localWindow);
    mockGetMainWindow.mockReturnValue(localWindow);
    await createWindowForDeepLink('intent://open?path=%2Fp', makeHandler());
    await createWindowForDeepLink('intent://settings?beta=true', makeHandler());
    expect(consumePendingDeepLinks(localWindow.webContents.id, ['settings'])).toEqual({
      actions: [{ type: 'settings', params: { beta: 'true' } }],
      remaining: 1,
    });
    expect(consumePendingDeepLinks(localWindow.webContents.id)).toEqual({
      actions: [{ type: 'open', params: { path: '/p' } }],
      remaining: 0,
    });
  });

  it('delivers each queued action exactly once', async () => {
    const localWindow = makeMainWindow();
    liveWindows.push(localWindow);
    await createWindowForDeepLink('intent://open?id=workspace_123', makeHandler());
    expect(consumePendingDeepLinks(localWindow.webContents.id).actions).toEqual([
      { type: 'open', params: { id: 'workspace_123' } },
    ]);
    expect(consumePendingDeepLinks(localWindow.webContents.id).actions).toEqual([]);
  });

  it('opens a new window for create links with newWindow=true and queues the action there', async () => {
    const mainWindow = makeMainWindow();
    mockGetMainWindow.mockReturnValue(mainWindow);
    await createWindowForDeepLink('intent://create?repo=%2Frepo&newWindow=true', makeHandler());
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    const loadedUrl = mockLoadUrl.mock.calls[0][0] as string;
    expect(loadedUrl).not.toContain('deepLink=');
    expect(consumePendingDeepLinks(createdWindows[0].webContents.id).actions).toEqual([
      { type: 'create', params: { repo: '/repo', newWindow: 'true' } },
    ]);
    expect(consumePendingDeepLinks(mainWindow.webContents.id).actions).toEqual([]);
  });

  it('opens a local window for a link when every window is closed', async () => {
    mockGetMainWindow.mockReturnValue(null);
    const handler = makeHandler();
    await createWindowForDeepLink('intent://settings?beta=true', handler);
    expect(handler.handleDeepLink).not.toHaveBeenCalled();
    expect(createdWindows).toHaveLength(1);
    expect(consumePendingDeepLinks(createdWindows[0].webContents.id).actions).toEqual([
      { type: 'settings', params: { beta: 'true' } },
    ]);
  });
});

describe('createWindow cold-start argv scan', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('never embeds a pair link (or its token) in the renderer load URL', async () => {
    process.argv = ['electron', '.', PAIR_LINK];
    await createWindow();
    expect(mockLoadUrl).toHaveBeenCalledTimes(1);
    const loadedUrl = mockLoadUrl.mock.calls[0][0] as string;
    expect(loadedUrl).not.toContain(TOKEN);
    expect(loadedUrl).not.toContain('deepLink=');
    expect(logLines.join('\n')).not.toContain(TOKEN);
  });

  it('excludes an uppercase pair link from URL embedding too', async () => {
    process.argv = ['electron', '.', PAIR_LINK.toUpperCase()];
    await createWindow();
    const loadedUrl = mockLoadUrl.mock.calls[0][0] as string;
    expect(loadedUrl).not.toContain('deepLink=');
    expect(logLines.join('\n')).not.toContain(TOKEN.toUpperCase());
  });

  it('queues a non-pair link for the boot window instead of embedding it', async () => {
    process.argv = ['electron', '.', 'intent://open?path=%2FUsers%2Fme'];
    await createWindow();
    const loadedUrl = mockLoadUrl.mock.calls[0][0] as string;
    expect(loadedUrl).not.toContain('deepLink=');
    expect(consumePendingDeepLinks(createdWindows[0].webContents.id).actions).toEqual([
      { type: 'open', params: { path: '/Users/me' } },
    ]);
  });

  it('hands the argv link to the first window only', async () => {
    process.argv = ['electron', '.', 'intent://open?path=%2FUsers%2Fme'];
    await createWindow();
    await createWindow();
    expect(createdWindows).toHaveLength(2);
    expect(consumePendingDeepLinks(createdWindows[0].webContents.id).actions).toHaveLength(1);
    expect(consumePendingDeepLinks(createdWindows[1].webContents.id).actions).toEqual([]);
  });
});

describe('findIntentUrl', () => {
  it('finds the first intent:// argument, matching the scheme case-insensitively', () => {
    expect(findIntentUrl(['electron', '.', 'intent://open?id=x'])).toBe('intent://open?id=x');
    expect(findIntentUrl(['electron', 'INTENT://PAIR?token=t'])).toBe('INTENT://PAIR?token=t');
    expect(findIntentUrl(['electron', '  intent://open  '])).toBe('  intent://open  ');
  });

  it('returns undefined when no intent:// argument is present', () => {
    expect(findIntentUrl(['electron', '.', '--flag', 'https://example.com'])).toBeUndefined();
    expect(findIntentUrl([])).toBeUndefined();
  });
});
