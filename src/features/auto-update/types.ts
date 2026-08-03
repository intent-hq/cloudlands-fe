/**
 * Auto-Update Types
 *
 * Shared types for the auto-update feature between main and renderer processes.
 */

export type UpdateChannel = 'stable' | 'beta' | 'alpha';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'waiting-for-idle'
  | 'error';

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  channel: UpdateChannel;
  /**
   * When status is waiting-for-idle, how many agents the daemon currently
   * reports as isResponding. Zero once the waiter is about to install.
   * Null when not waiting.
   */
  respondingAgentCount: number | null;
}

/**
 * IPC Channel constants for auto-update
 */
export const AUTO_UPDATE_CHANNELS = {
  // Invoke channels (renderer → main)
  CHECK_MANUAL: 'auto-update:check-manual',
  DOWNLOAD: 'auto-update:download',
  INSTALL: 'auto-update:install',
  CANCEL_INSTALL: 'auto-update:cancel-install',
  GET_STATE: 'auto-update:get-state',
  SET_CHANNEL: 'auto-update:set-channel',
  // Event channels (main → renderer)
  STATUS_CHANGED: 'auto-update:status-changed',
  PROGRESS: 'auto-update:progress',
  ERROR: 'auto-update:error',
  UP_TO_DATE: 'auto-update:up-to-date',
  SHOW_TOAST: 'auto-update:show-toast', // Signal to renderer to show the update toast
} as const;
