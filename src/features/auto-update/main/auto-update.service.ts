/**
 * Auto-Update Service
 *
 * Core service for handling automatic updates using electron-updater.
 * Manages update lifecycle: check → download → install
 */

import { app, powerMonitor } from 'electron';
import type { UpdateInfo as ElectronUpdateInfo, ProgressInfo } from 'electron-updater';
import electronUpdater from 'electron-updater';
import { DEFAULTS } from '../../../shared/constants';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import { confirmQuitWithRunningAgents } from '../../../main/quit-confirmation';
import { saveWindowSessions } from '../../../main/window';
import { getActiveId } from '../../backend/main/connections-store';
import { broadcastToRenderers } from './auto-update-broadcast';
import { isUpdateChannel, type UpdateChannel, type UpdateState, type UpdateStatus } from '../types';

const { autoUpdater } = electronUpdater;

const logger = new Logger('AutoUpdateService');

// Storage key for the update channel preference
const UPDATE_CHANNEL_STORAGE_KEY = 'updateChannel';
// Legacy boolean key, migrated to UPDATE_CHANNEL_STORAGE_KEY on first load
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
  };

  private initialized = false;
  private isManualCheck = false;
  private isConfirmingInstall = false;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private checkTimeoutId: NodeJS.Timeout | null = null;
  private lastCheckAt: number | null = null;
  // Per-check watchdog session token (intent-hq/monorepo#1698). Set when a
  // check starts, cleared by any terminal event (available / not-available /
  // error). The timeout callback checks this token instead of
  // `state.status === 'checking'` so it still fires when electron-updater
  // dedups onto a hung earlier check and never re-emits 'checking-for-update'.
  private checkSessionActive = false;
  // A user channel switch arrived while a check was in flight against the
  // previous feed; run one fresh manual check when that check settles.
  private channelSwitchRecheckQueued = false;
  private onWindowFocus: (() => void) | null = null;
  private onResume: (() => void) | null = null;

  /**
   * Initialize the updater. Initialization does not depend on any window
   * existing (intent-hq/monorepo#1848): the secondary-startup task can run
   * before window creation, and renderer notifications are broadcast to
   * whatever windows are live at send time (`sendToRenderer`).
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('AutoUpdateService already initialized');
      return;
    }

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
   * Cleanup resources (call on app quit)
   */
  cleanup() {
    this.clearCheckTimeout();
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
      const { getLocalPref, setLocalPref, deleteLocalPref } =
        await import('../../../main/local-prefs');
      const channel = await getLocalPref<string>(UPDATE_CHANNEL_STORAGE_KEY);

      if (isUpdateChannel(channel)) {
        this.state.channel = channel;
        return;
      }

      // One-time migration from the legacy boolean pref:
      // betaUpdatesEnabled=true → 'beta', otherwise → 'stable'.
      const betaEnabled = await getLocalPref<boolean>(BETA_UPDATES_STORAGE_KEY);
      this.state.channel = betaEnabled === true ? 'beta' : 'stable';
      if (typeof betaEnabled === 'boolean') {
        await setLocalPref(UPDATE_CHANNEL_STORAGE_KEY, this.state.channel);
        await deleteLocalPref(BETA_UPDATES_STORAGE_KEY);
        logger.info('Migrated legacy betaUpdatesEnabled pref to updateChannel', {
          channel: this.state.channel,
        });
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
      this.checkSessionActive = false;
      // Reset the manual-check flag here too (like the other terminal
      // handlers below), otherwise a later automatic check's
      // 'update-not-available' would incorrectly show the manual "up to
      // date" toast because `isManualCheck` stayed latched from this check.
      this.isManualCheck = false;
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
      this.checkSessionActive = false;
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
      this.updateStatus('downloaded');
    });

    autoUpdater.on('error', (error: Error) => {
      this.clearCheckTimeout();
      this.checkSessionActive = false;
      logger.error('Auto-update error', error);
      this.state.error = error.message;
      this.updateStatus('error');
      this.isManualCheck = false;
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
    await setLocalPref(UPDATE_CHANNEL_STORAGE_KEY, channel);
  }

  private async checkForUpdates(): Promise<UpdateState> {
    // Defense in depth (intent-hq/monorepo#1848): an uninitialized service
    // has no electron-updater event handlers attached, so no terminal event
    // would ever close the check session — the watchdog's misleading
    // "timed out / check your network" error would be the only outcome even
    // when the underlying check succeeds. Fail fast with a clear error.
    if (!this.initialized) {
      logger.warn('Update check requested before initialization; failing fast');
      this.state.error = m.autoUpdate_service_notInitialized_error();
      this.updateStatus('error');
      this.isManualCheck = false;
      return this.state;
    }

    // Skip if downloading or already downloaded
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') {
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
      this.checkSessionActive = true;
      this.startCheckTimeout();
      const result = await autoUpdater.checkForUpdates();
      // checkForUpdates() resolving null/undefined means the updater is not
      // active (e.g. dev config, unsupported platform) and no further event
      // will ever arrive for this check — without an explicit terminal state
      // here, the manual-check watchdog would be the only thing preventing an
      // infinite spinner. Only terminal if the session wasn't already closed
      // by another event (e.g. a fast update-not-available import race).
      if (!result && this.checkSessionActive) {
        this.clearCheckTimeout();
        this.checkSessionActive = false;
        logger.warn('checkForUpdates() resolved with no result; treating as error');
        this.state.error = m.autoUpdate_service_unknown_error();
        this.updateStatus('error');
        this.isManualCheck = false;
      }
    } catch (error) {
      this.clearCheckTimeout();
      this.checkSessionActive = false;
      logger.error('Failed to check for updates', error as Error);
      this.state.error = (error as Error).message;
      this.updateStatus('error');
      this.isManualCheck = false;
    }
    return this.state;
  }

  /**
   * Manually check for updates (triggered by user action like menu click)
   * This will send an "up to date" notification if no updates are available
   */
  async checkForUpdatesManual(): Promise<UpdateState> {
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

  /**
   * User-initiated channel-switch check. Behaves like a manual check, except
   * when a check is already in flight (startup / periodic / focus-triggered):
   * that request targets the PREVIOUS feed, so instead of adopting its result
   * (checkForUpdatesManual()'s 'checking' early return), queue exactly one
   * fresh manual check to run once the in-flight one settles — the new
   * channel is always actually queried. The in-flight old-feed check is left
   * non-manual so its result produces no user-facing toast; the queued
   * recheck carries the manual feedback for the new feed. Downloading /
   * downloaded states keep the manual-check treatment (notify, no new check).
   * Broadcasts 'auto-update:show-toast' first so the "Checking…" toast is
   * visible immediately and error outcomes have a surface; skips everything
   * (check + toast) when the service was never initialized (dev mode).
   */
  async checkForUpdatesOnChannelSwitch(): Promise<UpdateState> {
    // Dev mode / pre-init: the updater never initializes, so a check would
    // only hit checkForUpdates()'s not-initialized fail-fast path and pollute
    // the state GET_STATE consumers read with an error on every dev channel
    // switch. Skip the check — and the toast below, so no "Checking…"
    // surface appears that nothing will ever resolve.
    if (!this.initialized) {
      logger.info('Skipping channel-switch update check: service not initialized');
      return this.state;
    }

    // Make the toast surface visible before any status lands (mirrors the
    // menu "Check for Updates" sites): a 'checking' status broadcast alone
    // never sets toastVisible in the renderer, and an error outcome has no
    // other visible surface — without this, the switch shows no "Checking…"
    // feedback and a failed check is completely silent.
    broadcastToRenderers('auto-update:show-toast');

    if (this.state.status === 'checking') {
      logger.info('Channel switched during in-flight check; queueing recheck against new feed');
      this.channelSwitchRecheckQueued = true;
      // Ensure the watchdog is armed so a hung in-flight check still reaches
      // a terminal state (which releases the queued recheck).
      this.startCheckTimeout();
      this.sendToRenderer('auto-update:status-changed', this.state);
      return this.state;
    }
    return this.checkForUpdatesManual();
  }

  async downloadUpdate(): Promise<void> {
    if (this.state.status !== 'available') {
      throw new Error('No update available to download');
    }

    logger.info('Starting update download...');
    this.updateStatus('downloading');
    await autoUpdater.downloadUpdate();
  }

  async installUpdate(): Promise<void> {
    if (this.state.status !== 'downloaded') {
      throw new Error('No update downloaded to install');
    }

    // Re-entrancy guard: the confirmation below opens a long async window
    // (daemon RPC + user-facing dialog), so a second Install click while the
    // prompt is pending would stack a second dialog.
    if (this.isConfirmingInstall) {
      logger.info('Install confirmation already pending; ignoring repeat install request');
      return;
    }

    // Confirm running agents BEFORE any install side effect: on macOS,
    // quitAndInstall() closes all windows before `before-quit` fires, so the
    // prompt there appears after the window is gone and cancelling strands a
    // windowless app mid-install. Prompting here keeps the window open; the
    // before-quit handler skips its prompt while isInstallingUpdate is true.
    this.isConfirmingInstall = true;
    try {
      const proceed = await confirmQuitWithRunningAgents();
      if (!proceed) {
        logger.info('Update install cancelled by user due to running agents');
        return;
      }

      logger.info('Saving window sessions before installing update...');
      // Persist under the currently-active backend (T21) so the update-restart
      // restores the same backend's windows rather than clobbering local's slot.
      await saveWindowSessions(await getActiveId());
      isInstallingUpdate = true;

      logger.info('Installing update and restarting...');
      autoUpdater.quitAndInstall(false, true);
    } finally {
      this.isConfirmingInstall = false;
    }
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
    this.sendToRenderer('auto-update:status-changed', this.state);
    this.maybeRunQueuedChannelSwitchRecheck(status);
  }

  /**
   * Release a queued channel-switch recheck when the in-flight check reaches
   * a terminal state. Every terminal path funnels through updateStatus()
   * (update-available / update-not-available / error event, watchdog timeout,
   * null-result and rejection paths in checkForUpdates()), so this is the
   * single choke point. Deferred to a microtask so the settling handler's
   * trailing logic (isManualCheck bookkeeping) runs before the fresh check
   * flips the flags for its own session. The recheck goes through
   * checkForUpdatesManual(), keeping the downloading/downloaded guards.
   */
  private maybeRunQueuedChannelSwitchRecheck(status: UpdateStatus) {
    if (!this.channelSwitchRecheckQueued) return;
    if (status !== 'available' && status !== 'not-available' && status !== 'error') return;
    this.channelSwitchRecheckQueued = false;
    queueMicrotask(() => {
      logger.info('Running queued channel-switch update check against new feed');
      void this.checkForUpdatesManual().catch((error) => {
        logger.debug('Queued channel-switch update check failed', {
          error: (error as Error).message,
        });
      });
    });
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
      // Gate on the per-check session token (intent-hq/monorepo#1698), not
      // `state.status === 'checking'`: electron-updater can dedup a manual
      // check onto an earlier hung request without ever re-firing
      // 'checking-for-update', in which case `state.status` never becomes
      // 'checking' and the old gate would never fire.
      if (this.checkSessionActive) {
        logger.warn('Update check timed out after ' + UPDATE_CHECK_TIMEOUT_MS + 'ms');
        this.checkSessionActive = false;
        this.state.error = m.autoUpdate_check_timeout_error();
        this.updateStatus('error');
        this.isManualCheck = false;
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
    broadcastToRenderers(channel, data);
  }
}

export const autoUpdateService = new AutoUpdateService();

/**
 * Flag indicating the app is quitting to install an update.
 * When true, the window-all-closed handler should not delete window-sessions.json.
 */
export let isInstallingUpdate = false;
