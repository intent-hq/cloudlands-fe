/**
 * Release Notes Client (renderer)
 *
 * Thin wrapper over the `release-notes:*` IPC surface: an on-demand fetch for
 * the running version's notes and a subscription to the main-process push that
 * opens the modal.
 */

import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import {
  RELEASE_NOTES_CHANNELS,
  type ReleaseNotesContent,
  type ShowReleaseNotesPayload,
} from './types';

/** Response envelope from the release-notes ipcMain handler. */
interface ReleaseNotesResponse {
  success: boolean;
  data?: ReleaseNotesContent | null;
  error?: { message?: string };
}

export const releaseNotesClient = {
  /**
   * Fetch the release notes for the running version. Resolves `null` when no
   * notes are available (dev build, unpublished version, offline, bridge-less
   * build) — the modal renders its fallback state.
   */
  async getReleaseNotes(): Promise<ReleaseNotesContent | null> {
    const response = await invokeIpc<ReleaseNotesResponse>(RELEASE_NOTES_CHANNELS.GET);
    if (!response?.success) return null;
    return response.data ?? null;
  },

  /**
   * Claim the startup notes the main process parked before the renderer had a
   * `release-notes:show` listener. Resolves `null` when there is nothing
   * pending; claiming clears the slot so the modal opens at most once.
   */
  async claimPendingReleaseNotes(): Promise<ReleaseNotesContent | null> {
    const response = await invokeIpc<ReleaseNotesResponse>(RELEASE_NOTES_CHANNELS.GET_PENDING);
    if (!response?.success) return null;
    return response.data ?? null;
  },

  /**
   * Subscribe to the main → renderer "show release notes" push.
   * @returns Unsubscribe function
   */
  onShow(callback: (payload: ShowReleaseNotesPayload) => void): () => void {
    const listenerId = window.electronAPI?.on(RELEASE_NOTES_CHANNELS.SHOW, callback);
    return () => {
      if (listenerId) {
        window.electronAPI?.offById(RELEASE_NOTES_CHANNELS.SHOW, listenerId);
      }
    };
  },
};
