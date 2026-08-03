/**
 * Auto-Update Service
 *
 * Core service for handling automatic updates using electron-updater.
 * Manages update lifecycle: check → download → install
 */

import { app, BrowserWindow, powerMonitor } from 'electron';
import type { UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import electronUpdater from 'electron-updater';
import { DEFAULTS } from '../../../shared/constants';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import { saveWindowSessions } from '../../../main/window';
import { listRespondingAgents } from '../../../main/running-agents';
import type { UpdateChannel, UpdateState, UpdateStatus } from '../types';

const { autoUpdater } = electronUpdater;

const logger = new Logger('AutoUpdateService');

// Storage key for beta updates setting (must match renderer store)
const BETA_UPDATES_STORAGE_KEY = 'betaUpdatesEnabled';

// How often to check for updates (1 hour in milliseconds)
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// Minimum time between focus/resume checks (4 hours)
const FOCUS_RESUME_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Timeout for a single update check (30 seconds)
// If autoUpdater.checkForUpdates() doesn't resolve within this time, force error state
const UPDATE_CHECK_TIMEOUT_MS = 30 * 1000;
// Maximum time a check can be in 'checking' state before being considered stuck
const CHECK_STUCK_TIMEOUT_MS = 30_000;
// How often to re-check agent.isResponding while an install is armed
const IDLE_POLL_INTERVAL_MS = 1500;

/**
 * Get the update base URL
 * Uses AUTO_UPDATE_URL env var if set, otherwise uses the default from constants
 */
function getUpdateBaseUrl(): string {
  return process.env.AUTO_UPDATE_URL || DEFAULTS.AUTO_UPDATE_URL;
}

class AutoUpdateService {
  private state: UpdateState = {
    status: 'idle',
    currentVersion: '',
    updateInfo: null,
    progress: null,
    error: null,
    channel: 'stable',
    respondingAgentCount: null,
  };

  private mainWindow: BrowserWindow | null = null;
  private initialized = false;
  private isManualCheck = false;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private checkTimeoutId: NodeJS.Timeout | null = null;
  private lastCheckAt: number | null = null;
  private onWindowFocus: (() => void) | null = null;
  private onResume: (() => void) | null = null;

  /** Bumped on cancel / re-arm so an in-flight poll cannot quitAndInstall. */
  private installWaitGeneration = 0;
  private idlePollTimer: NodeJS.Timeout | null = null;
  private installInFlight = false;

  async initialize(mainWindow: BrowserWindow) {
    if (this.initialized) {
      logger.warn('AutoUpdateService already initialized');
      return;
    }

    this.mainWindow = mainWindow;
    this.state.currentVersion = app.getVersion();

    // Configure auto-updater
    autoUpdater.autoDownload = true; // Auto-download updates in background
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    // Load persisted channel setting from electron-store
    await this.loadChannelFromSettings();

    // Set initial feed URL based on channel
    this.setChannel(this.state.channel);

    // Set up event handlers
    this.setupEventHandlers();
    this.setupFocusResumeHandlers();

    this.initialized = true;

    logger.info('AutoUpdateService initialized', {
      version: this.state.currentVersion,
      channel: this.state.channel,
      updateUrl: getUpdateBaseUrl(),
    });

    // Check for updates on startup (after a short delay)
    setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        logger.debug('Initial update check failed', { error: err.message });
      });
    }, 10000); // 10 seconds after startup

    // Set up periodic update checks (every hour)
    this.updateCheckInterval = setInterval(() => {
      logger.info('Periodic update check...');
      this.checkForUpdates().catch((err) => {
        logger.debug('Periodic update check failed', { error: err.message });
      });
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  /**
   * Update the main window reference.
   * Call this when a new window is created to ensure events are sent to the correct window.
   */
  updateMainWindow(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Cleanup resources (call on app quit)
   */
  cleanup() {
    this.clearCheckTimeout();
    this.stopIdleWaiter();
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
    if (this.onWindowFocus) {
      app.off('browser-window-focus', this.onWindowFocus);
      this.onWindowFocus = null;
    }
    if (this.onResume) {
      powerMonitor.off('resume', this.onResume);
      this.onResume = null;
    }
  }

  /**
   * Load the update channel from persisted settings
   */
  private async loadChannelFromSettings(): Promise<void> {
    try {
      // FE-local pref (PROTOCOL.md §5.12 "Not exposed (FE-only)"). The
      // legacy `settings` electron-store is retired.
      const { getLocalPref } = await import('../../../main/local-prefs');
      const betaEnabled = await getLocalPref<boolean>(BETA_UPDATES_STORAGE_KEY);

      if (typeof betaEnabled === 'boolean' && betaEnabled) {
        this.state.channel = 'beta';
        logger.info('Beta updates enabled from local-prefs');
      } else {
        this.state.channel = 'stable';
      }
    } catch (error) {
      logger.error('Failed to load channel setting, defaulting to stable', error as Error);
      this.state.channel = 'stable';
    }
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      logger.info('Checking for updates...');
      this.updateStatus('checking');
    });

    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      this.clearCheckTimeout();
      logger.info('Update available', { version: info.version });
      this.state.updateInfo = {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      };
      this.updateStatus('available');
    });

    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      this.clearCheckTimeout();
      logger.info('No update available', {
        currentVersion: info.version,
        isManualCheck: this.isManualCheck,
      });
      this.updateStatus('not-available');
      // For manual checks, send an "up to date" notification to the renderer
      if (this.isManualCheck) {
        this.isManualCheck = false;
        this.sendToRenderer('auto-update:up-to-date', { version: info.version });
      }
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      if (this.state.status !== 'downloading') {
        this.updateStatus('downloading');
      }
      this.state.progress = {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      };
      this.sendToRenderer('auto-update:progress', this.state.progress);
    });

    autoUpdater.on('update-downloaded', (info: ElectronUpdateInfo) => {
      logger.info('Update downloaded', { version: info.version });
      // Do not clobber an armed wait-for-idle if another download finishes.
      if (this.state.status !== 'waiting-for-idle') {
        this.updateStatus('downloaded');
      }
    });

    autoUpdater.on('error', (error: Error) => {
      this.clearCheckTimeout();
      logger.error('Auto-update error', error);
      this.state.error = error.message;
      this.updateStatus('error');
    });
  }

  async setChannel(channel: UpdateChannel): Promise<void> {
    this.state.channel = channel;

    // Persist the channel choice BEFORE the baseUrl guard so the preference
    // survives even if AUTO_UPDATE_URL is missing
    await this.persistChannelSetting(channel);

    const baseUrl = getUpdateBaseUrl();
    if (!baseUrl) {
      logger.warn('Cannot set update channel: AUTO_UPDATE_URL not configured');
      return;
    }
    const feedUrl = `${baseUrl}/${channel}`;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    logger.info('Update channel set', { channel, feedUrl });
  }

  private async persistChannelSetting(channel: UpdateChannel): Promise<void> {
    const { setLocalPref } = await import('../../../main/local-prefs');
    await setLocalPref(BETA_UPDATES_STORAGE_KEY, channel === 'beta');
  }

  private async checkForUpdates(): Promise<UpdateState> {
    // Skip if downloading, already downloaded, or waiting to install
    if (
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded' ||
      this.state.status === 'waiting-for-idle'
    ) {
      logger.debug('Skipping update check - already in progress or complete', {
        status: this.state.status,
      });
      return this.state;
    }

    // If already checking, only proceed if the check appears stuck
    if (this.state.status === 'checking') {
      const elapsed = this.lastCheckAt ? Date.now() - this.lastCheckAt : Infinity;
      if (elapsed < CHECK_STUCK_TIMEOUT_MS) {
        logger.debug('Skipping update check - check already in progress', {
          elapsedMs: elapsed,
        });
        return this.state;
      }
      logger.warn('Previous update check appears stuck, resetting and retrying', {
        elapsedMs: elapsed,
      });
      this.updateStatus('idle');
    }

    const baseUrl = getUpdateBaseUrl();
    if (!baseUrl) {
      this.state.error = m.autoUpdate_service_urlNotConfigured_error();
      this.updateStatus('error');
      return this.state;
    }

    try {
      this.lastCheckAt = Date.now();
      this.startCheckTimeout();
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.clearCheckTimeout();
      logger.error('Failed to check for updates', error as Error);
      this.state.error = (error as Error).message;
      this.updateStatus('error');
    }
    return this.state;
  }

  /**
   * Manually check for updates (triggered by user action like menu click)
   * This will send an "up to date" notification if no updates are available
   */
  async checkForUpdatesManual(): Promise<UpdateState> {
    // If install is armed, surface the waiting state
    if (this.state.status === 'waiting-for-idle') {
      logger.info('Manual check: Install waiting for agents to go idle');
      this.sendToRenderer('auto-update:status-changed', this.state);
      return this.state;
    }

    // If update is already downloaded, just notify the user
    if (this.state.status === 'downloaded') {
      logger.info('Manual check: Update already downloaded');
      this.sendToRenderer('auto-update:status-changed', this.state);
      return this.state;
    }

    // If currently downloading, notify the user of progress
    if (this.state.status === 'downloading') {
      logger.info('Manual check: Download in progress');
      this.sendToRenderer('auto-update:status-changed', this.state);
      if (this.state.progress) {
        this.sendToRenderer('auto-update:progress', this.state.progress);
      }
      return this.state;
    }

    // If already checking (e.g., from automatic check), notify renderer of current state
    // and ensure the timeout is (re)started so it won't hang forever
    if (this.state.status === 'checking') {
      logger.info('Manual check: Check already in progress, ensuring timeout is set');
      this.isManualCheck = true;
      this.sendToRenderer('auto-update:status-changed', this.state);
      this.startCheckTimeout();
      return this.state;
    }

    logger.info('Manual update check initiated');
    this.isManualCheck = true;
    return this.checkForUpdates();
  }

  async downloadUpdate(): Promise<void> {
    if (this.state.status !== 'available') {
      throw new Error('No update available to download');
    }

    logger.info('Starting update download...');
    this.updateStatus('downloading');
    await autoUpdater.downloadUpdate();
  }

  /**
   * Arm install: wait until no daemon agents report isResponding, then
   * quitAndInstall. Returns once the waiter is armed (or install has started
   * if already idle). Double-click while waiting is a no-op success.
   */
  async installUpdate(): Promise<void> {
    if (this.state.status === 'waiting-for-idle') {
      logger.info('Install already waiting for agents to go idle');
      return;
    }
    if (this.state.status !== 'downloaded') {
      throw new Error('No update downloaded to install');
    }
    if (this.installInFlight) {
      logger.info('Install already in flight');
      return;
    }

    logger.info('Saving window sessions before arming install...');
    await saveWindowSessions();

    const generation = ++this.installWaitGeneration;
    this.state.respondingAgentCount = null;
    this.updateStatus('waiting-for-idle');

    await this.pollAndInstallWhenIdle(generation);
  }

  /**
   * Cancel a pending wait-for-idle install and return to downloaded.
   */
  cancelPendingInstall(): void {
    if (this.state.status !== 'waiting-for-idle') {
      logger.debug('cancelPendingInstall: nothing to cancel', { status: this.state.status });
      return;
    }
    logger.info('Cancelling pending install wait');
    this.installWaitGeneration += 1;
    this.stopIdleWaiter();
    this.state.respondingAgentCount = null;
    this.updateStatus('downloaded');
  }

  private stopIdleWaiter() {
    if (this.idlePollTimer) {
      clearTimeout(this.idlePollTimer);
      this.idlePollTimer = null;
    }
  }

  private async pollAndInstallWhenIdle(generation: number): Promise<void> {
    const tick = async () => {
      if (generation !== this.installWaitGeneration) {
        logger.debug('Idle waiter generation invalidated; stopping', { generation });
        return;
      }

      let count = 0;
      try {
        const { getBackendClient } = await import('../../backend/main/backend.ipc');
        const agents = await listRespondingAgents(getBackendClient());
        count = agents.length;
      } catch (error) {
        // listRespondingAgents already fail-opens; client lookup should too.
        logger.warn('Idle check failed; treating as idle', {
          error: error instanceof Error ? error.message : String(error),
        });
        count = 0;
      }

      if (generation !== this.installWaitGeneration) {
        return;
      }

      this.state.respondingAgentCount = count;
      this.sendToRenderer('auto-update:status-changed', this.getState());

      if (count === 0) {
        await this.performQuitAndInstall(generation);
        return;
      }

      logger.info('Waiting for agents to go idle before install', {
        respondingAgentCount: count,
      });
      this.idlePollTimer = setTimeout(() => {
        void tick();
      }, IDLE_POLL_INTERVAL_MS);
    };

    await tick();
  }

  private async performQuitAndInstall(generation: number): Promise<void> {
    if (generation !== this.installWaitGeneration) {
      logger.debug('Skipping quitAndInstall; generation invalidated');
      return;
    }
    if (this.installInFlight) {
      return;
    }
    this.installInFlight = true;
    this.stopIdleWaiter();

    try {
      await saveWindowSessions();
    } catch (error) {
      logger.warn('Final session save before install failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (generation !== this.installWaitGeneration) {
      this.installInFlight = false;
      return;
    }

    isInstallingUpdate = true;
    logger.info('All agents idle - installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  private updateStatus(status: UpdateStatus) {
    this.state.status = status;
    if (status !== 'error') {
      this.state.error = null;
    }
    if (status === 'idle' || status === 'checking') {
      this.state.progress = null;
    }
    if (status !== 'waiting-for-idle') {
      this.state.respondingAgentCount = null;
    }
    this.sendToRenderer('auto-update:status-changed', this.state);
  }

  private setupFocusResumeHandlers() {
    if (this.onWindowFocus || this.onResume) {
      return;
    }

    this.onWindowFocus = () => {
      this.checkForUpdatesIfStale('focus');
    };
    app.on('browser-window-focus', this.onWindowFocus);

    this.onResume = () => {
      this.checkForUpdatesIfStale('resume');
    };
    powerMonitor.on('resume', this.onResume);
  }

  private checkForUpdatesIfStale(reason: 'focus' | 'resume') {
    const now = Date.now();
    if (this.lastCheckAt && now - this.lastCheckAt < FOCUS_RESUME_CHECK_INTERVAL_MS) {
      logger.debug('Skipping update check (too soon)', {
        reason,
        lastCheckAt: this.lastCheckAt,
      });
      return;
    }

    logger.info('Checking for updates due to app activity', { reason });
    this.checkForUpdates().catch((err) => {
      logger.debug('Activity-triggered update check failed', { reason, error: err.message });
    });
  }

  /**
   * Start a timeout for the current update check.
   * If the check doesn't complete within UPDATE_CHECK_TIMEOUT_MS,
   * force the state to 'error' to prevent the UI from spinning forever.
   */
  private startCheckTimeout() {
    this.clearCheckTimeout();
    this.checkTimeoutId = setTimeout(() => {
      if (this.state.status === 'checking') {
        logger.warn('Update check timed out after ' + UPDATE_CHECK_TIMEOUT_MS + 'ms');
        this.state.error = m.autoUpdate_check_timeout_error();
        this.updateStatus('error');
      }
    }, UPDATE_CHECK_TIMEOUT_MS);
  }

  private clearCheckTimeout() {
    if (this.checkTimeoutId) {
      clearTimeout(this.checkTimeoutId);
      this.checkTimeoutId = null;
    }
  }

  private sendToRenderer(channel: string, data: unknown) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }
}

export const autoUpdateService = new AutoUpdateService();

/**
 * Flag indicating the app is quitting to install an update.
 * When true, the window-all-closed handler should not delete window-sessions.json.
 */
export let isInstallingUpdate = false;
