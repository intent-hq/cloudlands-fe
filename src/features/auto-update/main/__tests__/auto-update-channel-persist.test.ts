/**
 * Auto-Update Service Channel Persistence Tests
 *
 * Tests that setChannel() persists the channel choice to local-prefs.json
 * so it survives restart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// Mock Electron before importing the service
vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.0.0',
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: vi.fn(),
  },
  powerMonitor: {
    on: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  __esModule: true,
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
    },
  },
}));

let testUserDataPath: string;

beforeEach(async () => {
  // Create a temp directory for the test
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-test-'));
  vi.clearAllMocks();
  // Reset the module cache to get a fresh service instance
  vi.resetModules();
});

afterEach(async () => {
  // Clean up timers and intervals
  vi.clearAllTimers();
  vi.useRealTimers();
  // Drain any in-flight writes from local-prefs before cleanup
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  // Clean up the temp directory
  await fs.rm(testUserDataPath, { recursive: true, force: true });
});

describe('AutoUpdateService channel persistence', () => {
  it.each(['stable', 'beta', 'alpha', 'disabled'] as const)(
    'setChannel(%s) persists updateChannel to local-prefs.json',
    async (channel) => {
      // Import the service after mocks are set up
      const { autoUpdateService } = await import('../auto-update.service');

      // Initialize the service (this loads the channel from settings)
      await autoUpdateService.initialize();

      // Set the channel (now awaitable)
      await autoUpdateService.setChannel(channel);

      // Poll for the local-prefs.json file to be written
      const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
      await expect
        .poll(
          async () => {
            const prefsContent = await fs.readFile(prefsPath, 'utf8');
            const prefs = JSON.parse(prefsContent);
            return prefs.updateChannel;
          },
          { timeout: 2000, interval: 50 },
        )
        .toBe(channel);
    },
  );

  it('loadChannelFromSettings reads updateChannel from local-prefs.json on init', async () => {
    // Pre-populate local-prefs.json with the alpha channel
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ updateChannel: 'alpha' }), 'utf8');

    // Import the service after mocks are set up
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service (this should load alpha from local-prefs)
    await autoUpdateService.initialize();

    // Get the state and verify the channel is alpha
    const state = autoUpdateService.getState();
    expect(state.channel).toBe('alpha');
  });

  it("a persisted 'disabled' channel round-trips on init and never points the feed", async () => {
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ updateChannel: 'disabled' }), 'utf8');

    const { default: electronUpdater } = await import('electron-updater');
    const { autoUpdateService } = await import('../auto-update.service');
    await autoUpdateService.initialize();

    expect(autoUpdateService.getState().channel).toBe('disabled');
    // There is no /disabled feed: initialize()'s internal setChannel call
    // must not configure a feed URL.
    expect(electronUpdater.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(electronUpdater.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('migrates legacy betaUpdatesEnabled=true to updateChannel=beta and removes the old key', async () => {
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ betaUpdatesEnabled: true }), 'utf8');

    const { autoUpdateService } = await import('../auto-update.service');
    await autoUpdateService.initialize();

    expect(autoUpdateService.getState().channel).toBe('beta');
    await expect
      .poll(
        async () => {
          const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
          return [prefs.updateChannel, 'betaUpdatesEnabled' in prefs];
        },
        { timeout: 2000, interval: 50 },
      )
      .toEqual(['beta', false]);
  });

  it('migrates legacy betaUpdatesEnabled=false to updateChannel=stable and removes the old key', async () => {
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ betaUpdatesEnabled: false }), 'utf8');

    const { autoUpdateService } = await import('../auto-update.service');
    await autoUpdateService.initialize();

    expect(autoUpdateService.getState().channel).toBe('stable');
    await expect
      .poll(
        async () => {
          const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
          return [prefs.updateChannel, 'betaUpdatesEnabled' in prefs];
        },
        { timeout: 2000, interval: 50 },
      )
      .toEqual(['stable', false]);
  });

  it('prefers updateChannel over a lingering legacy betaUpdatesEnabled key', async () => {
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(
      prefsPath,
      JSON.stringify({ updateChannel: 'stable', betaUpdatesEnabled: true }),
      'utf8',
    );

    const { autoUpdateService } = await import('../auto-update.service');
    await autoUpdateService.initialize();

    expect(autoUpdateService.getState().channel).toBe('stable');
  });

  it('defaults to stable when no pref exists', async () => {
    // Import the service without pre-populating local-prefs.json
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service
    await autoUpdateService.initialize();

    // Get the state and verify the channel defaults to stable
    const state = autoUpdateService.getState();
    expect(state.channel).toBe('stable');
  });
});

/**
 * GET_STATE boot gating: setupAutoUpdateIPC() runs before window creation but
 * initializeAutoUpdater() only runs later in the deferred secondary-startup
 * task, so an early renderer GET_STATE must wait for the boot flow to settle
 * the channel instead of answering the pre-init default (stable).
 */
describe('GET_STATE boot gating (early renderer read)', () => {
  async function registerAndGetStateHandler() {
    const { ipcMain } = await import('electron');
    const ipc = await import('../auto-update.ipc');
    ipc.setupAutoUpdateIPC();
    const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>;
    const getStateHandler = handleMock.mock.calls.find(
      ([channel]) => channel === 'auto-update:get-state',
    )?.[1] as (event: unknown, data?: unknown) => Promise<any>;
    expect(getStateHandler).toBeTypeOf('function');
    return { ipc, getStateHandler };
  }

  it('a GET_STATE issued before initializeAutoUpdater() waits and answers the loaded channel', async () => {
    // Persisted beta preference that a too-early read used to miss
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ betaUpdatesEnabled: true }), 'utf8');

    const { ipc, getStateHandler } = await registerAndGetStateHandler();

    // Renderer read arrives BEFORE initialization has even started — it must
    // stay pending rather than answering the pre-init default.
    let settled = false;
    const pending = getStateHandler({}, undefined).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    // The deferred secondary-startup task initializes the updater
    ipc.initializeAutoUpdater();

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.data.channel).toBe('beta');
  });

  it('initializeAutoUpdater() before any window exists (secondary task raced ahead of window creation) still initializes and settles the gate', async () => {
    // Persisted beta preference — only visible in GET_STATE if initialize()
    // really ran (intent-hq/monorepo#1848: the pre-window race used to skip
    // initialization entirely).
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ betaUpdatesEnabled: true }), 'utf8');

    const { ipc, getStateHandler } = await registerAndGetStateHandler();
    const pending = getStateHandler({}, undefined);

    // The deferred secondary-startup task runs before any window exists
    // (getAllWindows is mocked to []); initialization must proceed regardless.
    ipc.initializeAutoUpdater();

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.data.channel).toBe('beta');
    // Proves initialize() actually ran (currentVersion is set there).
    expect(result.data.currentVersion).toBe('2.0.0');
  });

  it('markAutoUpdaterNotInitialized() (dev mode) unblocks GET_STATE with the default state', async () => {
    const { ipc, getStateHandler } = await registerAndGetStateHandler();

    const pending = getStateHandler({}, undefined);
    ipc.markAutoUpdaterNotInitialized();

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.data.channel).toBe('stable');
  });
});
