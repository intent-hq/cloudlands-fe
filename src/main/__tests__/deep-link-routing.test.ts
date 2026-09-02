import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Routing tests for createWindowForDeepLink: `intent://pair` links go straight
 * to the main-process pair handler — no new BrowserWindow, no renderer IPC,
 * and no bearer token in any log line. Non-pair links keep the existing
 * behavior (settings → existing window IPC; open → new window).
 */

const mockBrowserWindowCtor = vi.fn();
const mockGetPrimaryDisplay = vi.fn(() => ({
  workArea: { x: 0, y: 0, width: 1440, height: 900 },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/tmp'),
    dock: undefined,
  },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => []);
    loadURL = vi.fn();
    focus = vi.fn();
    webContents = { on: vi.fn(), send: vi.fn(), session: { clearCache: vi.fn() } };
    on = vi.fn();
    once = vi.fn();
    constructor(options: unknown) {
      mockBrowserWindowCtor(options);
    }
  },
  screen: { getPrimaryDisplay: () => mockGetPrimaryDisplay() },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: { createFromPath: vi.fn() },
}));

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
import { createWindowForDeepLink } from '../window';

const TOKEN = 'super-secret-token-value';
const PAIR_LINK = `intent://pair?v=1&host=192.168.1.10&port=8443&fp=AA:BB:CC&token=${TOKEN}`;

function makeMainWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

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

  it('never logs the pair token', async () => {
    await createWindowForDeepLink(PAIR_LINK, makeHandler());
    expect(logLines.join('\n')).not.toContain(TOKEN);
  });

  it('still sends settings links to the existing window over IPC', async () => {
    const mainWindow = makeMainWindow();
    mockGetMainWindow.mockReturnValue(mainWindow);
    await createWindowForDeepLink('intent://settings?section=general', makeHandler());
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('deep-link', {
      type: 'settings',
      params: { section: 'general' },
    });
    expect(handlePairDeepLink).not.toHaveBeenCalled();
    expect(mockBrowserWindowCtor).not.toHaveBeenCalled();
  });

  it('still creates a new window for open links', async () => {
    await createWindowForDeepLink('intent://open?id=workspace_123', makeHandler());
    expect(mockBrowserWindowCtor).toHaveBeenCalledTimes(1);
    expect(handlePairDeepLink).not.toHaveBeenCalled();
  });
});
