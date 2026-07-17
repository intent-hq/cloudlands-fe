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
}

/**
 * IPC Channel constants for auto-update
 */
export const AUTO_UPDATE_CHANNELS = {
  // Invoke channels (renderer → main)
  CHECK_MANUAL: 'auto-update:check-manual',
  GET_STATE: 'auto-update:get-state',
  SET_CHANNEL: 'auto-update:set-channel',
  // Event channels (main → renderer)
  STATUS_CHANGED: 'auto-update:status-changed',
  PROGRESS: 'auto-update:progress',
  ERROR: 'auto-update:error',
  UP_TO_DATE: 'auto-update:up-to-date',
  SHOW_TOAST: 'auto-update:show-toast', // Signal to renderer to show the update toast
} as const;
