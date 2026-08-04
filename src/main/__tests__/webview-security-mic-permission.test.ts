/**
 * Regression: the app shell's getUserMedia({ audio: true }) can reach the
 * default-session permission-request handler WITHOUT `mediaTypes` populated
 * (Chromium PermissionController path, electron/electron#36629). The gate
 * must still route such an app-shell request to the macOS microphone grant
 * (askForMediaAccess → TCC prompt) instead of rejecting it with
 * NotAllowedError, while video/screen capture and any webview-originated
 * media request stay blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  getAllWindows: vi.fn((): unknown[] => []),
  defaultSession: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  },
  browserPanelSession: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  },
  systemPreferences: {
    getMediaAccessStatus: vi.fn((): string => 'not-determined'),
    askForMediaAccess: vi.fn(async (): Promise<boolean> => true),
  },
}));

vi.mock('electron', () => ({
  app: { on: electronMocks.appOn },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  session: {
    defaultSession: electronMocks.defaultSession,
    fromPartition: vi.fn(() => electronMocks.browserPanelSession),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
  systemPreferences: electronMocks.systemPreferences,
}));

import { setupWebviewSecurity } from '../webview-security';

type RequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: Record<string, unknown>,
) => void;
type CheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details: Record<string, unknown>,
) => boolean;

const appWindowContents = { getType: () => 'window', getURL: () => 'app://workspaces/hud' };
const webviewContents = { getType: () => 'webview', getURL: () => 'https://example.com/' };

function getHandlers(): { request: RequestHandler; check: CheckHandler } {
  const request = electronMocks.defaultSession.setPermissionRequestHandler.mock.calls[0]?.[0];
  const check = electronMocks.defaultSession.setPermissionCheckHandler.mock.calls[0]?.[0];
  if (!request || !check) throw new Error('permission handlers not registered');
  return { request, check };
}

async function requestMedia(
  webContents: unknown,
  details: Record<string, unknown>,
): Promise<boolean> {
  const { request } = getHandlers();
  let granted: boolean | undefined;
  request(webContents, 'media', (g) => (granted = g), details);
  await vi.waitFor(() => expect(granted).toBeDefined());
  return granted as boolean;
}

const originalPlatform = process.platform;

describe('default-session media permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    electronMocks.systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined');
    electronMocks.systemPreferences.askForMediaAccess.mockResolvedValue(true);
    setupWebviewSecurity();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('grants an audio-only request (mediaTypes present) via askForMediaAccess', async () => {
    const granted = await requestMedia(appWindowContents, {
      requestingUrl: 'app://workspaces/hud',
      mediaTypes: ['audio'],
    });
    expect(granted).toBe(true);
    expect(electronMocks.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
  });

  it('grants an app-shell media request WITHOUT mediaTypes (electron#36629 path)', async () => {
    const granted = await requestMedia(appWindowContents, {
      requestingUrl: 'app://workspaces/hud',
    });
    expect(granted).toBe(true);
    expect(electronMocks.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
  });

  it('resolves from the stored TCC grant without re-prompting', async () => {
    electronMocks.systemPreferences.getMediaAccessStatus.mockReturnValue('granted');
    const granted = await requestMedia(appWindowContents, { mediaTypes: ['audio'] });
    expect(granted).toBe(true);
    expect(electronMocks.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('blocks video requests', async () => {
    for (const mediaTypes of [['video'], ['audio', 'video']]) {
      const granted = await requestMedia(appWindowContents, {
        requestingUrl: 'app://workspaces/hud',
        mediaTypes,
      });
      expect(granted).toBe(false);
    }
    expect(electronMocks.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('blocks webview-originated media requests, even audio-only', async () => {
    expect(await requestMedia(webviewContents, { mediaTypes: ['audio'] })).toBe(false);
    expect(await requestMedia(webviewContents, { requestingUrl: 'app://workspaces/hud' })).toBe(
      false,
    );
    expect(electronMocks.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('grants a typeless media request from the dev server in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    try {
      const granted = await requestMedia(
        { getType: () => 'window', getURL: () => 'http://localhost:5190/' },
        { requestingUrl: 'http://localhost:5190/workspaces/hud' },
      );
      expect(granted).toBe(true);
      expect(electronMocks.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('blocks typeless media requests from non-app-shell origins', async () => {
    const granted = await requestMedia(appWindowContents, {
      requestingUrl: 'https://example.com/',
    });
    expect(granted).toBe(false);
    expect(electronMocks.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
  });

  it('permission check: audio allowed for app shell, video and webviews blocked', () => {
    const { check } = getHandlers();
    expect(check(appWindowContents, 'media', 'app://workspaces', { mediaType: 'audio' })).toBe(
      true,
    );
    expect(check(appWindowContents, 'media', 'app://workspaces', { mediaType: 'video' })).toBe(
      false,
    );
    expect(check(webviewContents, 'media', 'https://example.com', { mediaType: 'audio' })).toBe(
      false,
    );
  });
});
