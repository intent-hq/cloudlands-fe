/**
 * Auto-Update Client
 *
 * Client-side API for interacting with the auto-update service.
 * Provides manual update checks, channel selection, and state queries.
 * Updates download automatically; installation occurs on next app restart.
 */

import type { UpdateChannel, UpdateProgress, UpdateState } from './types';
import { AUTO_UPDATE_CHANNELS } from './types';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';

interface AutoUpdateResponse<T> {
  success: boolean;
  data: T;
  error?: { message?: string };
}

/**
 * Auto-update client for renderer process
 */
export const autoUpdateClient = {
  /**
   * Manually check for updates (triggers "up to date" notification if no updates)
   */
  async checkForUpdatesManual(): Promise<UpdateState> {
    const response = await invokeIpc<AutoUpdateResponse<UpdateState>>(
      AUTO_UPDATE_CHANNELS.CHECK_MANUAL,
    );
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to check for updates');
    }
    return response.data;
  },

  /**
   * Get the current update state
   */
  async getState(): Promise<UpdateState> {
    const response = await invokeIpc<AutoUpdateResponse<UpdateState>>(AUTO_UPDATE_CHANNELS.GET_STATE);
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get update state');
    }
    return response.data;
  },

  /**
   * Set the update channel (stable, beta, alpha)
   */
  async setChannel(channel: UpdateChannel): Promise<void> {
    const response = await invokeIpc<AutoUpdateResponse<void>>(AUTO_UPDATE_CHANNELS.SET_CHANNEL, {
      channel,
    });
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to set update channel');
    }
  },

  /**
   * Subscribe to update status changes
   * @returns Unsubscribe function
   */
  onStatusChanged(callback: (state: UpdateState) => void): () => void {
    const listenerId = window.electronAPI.on(AUTO_UPDATE_CHANNELS.STATUS_CHANGED, callback);
    return () => {
      if (listenerId) {
        window.electronAPI.offById(AUTO_UPDATE_CHANNELS.STATUS_CHANGED, listenerId);
      }
    };
  },

  /**
   * Subscribe to download progress updates
   * @returns Unsubscribe function
   */
  onProgress(callback: (progress: UpdateProgress) => void): () => void {
    const listenerId = window.electronAPI.on(AUTO_UPDATE_CHANNELS.PROGRESS, callback);
    return () => {
      if (listenerId) {
        window.electronAPI.offById(AUTO_UPDATE_CHANNELS.PROGRESS, listenerId);
      }
    };
  },

  /**
   * Subscribe to update errors
   * @returns Unsubscribe function
   */
  onError(callback: (error: string) => void): () => void {
    const listenerId = window.electronAPI.on(AUTO_UPDATE_CHANNELS.ERROR, callback);
    return () => {
      if (listenerId) {
        window.electronAPI.offById(AUTO_UPDATE_CHANNELS.ERROR, listenerId);
      }
    };
  },

  /**
   * Subscribe to show toast events (triggered by main process when menu is clicked)
   * @returns Unsubscribe function
   */
  onShowToast(callback: () => void): () => void {
    const listenerId = window.electronAPI.on(AUTO_UPDATE_CHANNELS.SHOW_TOAST, callback);
    return () => {
      if (listenerId) {
        window.electronAPI.offById(AUTO_UPDATE_CHANNELS.SHOW_TOAST, listenerId);
      }
    };
  },

  /**
   * Subscribe to "up to date" events (sent when no update is available)
   * @returns Unsubscribe function
   */
  onUpToDate(callback: (data: { version: string; isDev?: boolean }) => void): () => void {
    const listenerId = window.electronAPI.on(AUTO_UPDATE_CHANNELS.UP_TO_DATE, callback);
    return () => {
      if (listenerId) {
        window.electronAPI.offById(AUTO_UPDATE_CHANNELS.UP_TO_DATE, listenerId);
      }
    };
  },
};
