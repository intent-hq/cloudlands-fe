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
  BrowserWindow: vi.fn(),
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

describe('AutoUpdateService channel persistence', () => {
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
    const { __drainLocalPrefsWriteChainForTesting } = await import(
      '../../../../main/local-prefs'
    );
    await __drainLocalPrefsWriteChainForTesting();
    // Clean up the temp directory
    await fs.rm(testUserDataPath, { recursive: true, force: true });
  });

  it('setChannel(beta) persists betaUpdatesEnabled=true to local-prefs.json', async () => {
    // Import the service after mocks are set up
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service (this loads the channel from settings)
    const mockWindow = {} as any;
    await autoUpdateService.initialize(mockWindow);

    // Set the channel to beta (now awaitable)
    await autoUpdateService.setChannel('beta');

    // Poll for the local-prefs.json file to be written
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await expect.poll(
      async () => {
        const prefsContent = await fs.readFile(prefsPath, 'utf8');
        const prefs = JSON.parse(prefsContent);
        return prefs.betaUpdatesEnabled;
      },
      { timeout: 2000, interval: 50 },
    ).toBe(true);
  });

  it('setChannel(stable) persists betaUpdatesEnabled=false to local-prefs.json', async () => {
    // Import the service after mocks are set up
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service
    const mockWindow = {} as any;
    await autoUpdateService.initialize(mockWindow);

    // Set the channel to stable (now awaitable)
    await autoUpdateService.setChannel('stable');

    // Poll for the local-prefs.json file to be written
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await expect.poll(
      async () => {
        const prefsContent = await fs.readFile(prefsPath, 'utf8');
        const prefs = JSON.parse(prefsContent);
        return prefs.betaUpdatesEnabled;
      },
      { timeout: 2000, interval: 50 },
    ).toBe(false);
  });

  it('loadChannelFromSettings reads betaUpdatesEnabled from local-prefs.json on init', async () => {
    // Pre-populate local-prefs.json with beta enabled
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await fs.writeFile(prefsPath, JSON.stringify({ betaUpdatesEnabled: true }), 'utf8');

    // Import the service after mocks are set up
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service (this should load beta from local-prefs)
    const mockWindow = {} as any;
    await autoUpdateService.initialize(mockWindow);

    // Get the state and verify the channel is beta
    const state = autoUpdateService.getState();
    expect(state.channel).toBe('beta');
  });

  it('defaults to stable when no pref exists', async () => {
    // Import the service without pre-populating local-prefs.json
    const { autoUpdateService } = await import('../auto-update.service');

    // Initialize the service
    const mockWindow = {} as any;
    await autoUpdateService.initialize(mockWindow);

    // Get the state and verify the channel defaults to stable
    const state = autoUpdateService.getState();
    expect(state.channel).toBe('stable');
  });
});
