/**
 * Release Notes Client (renderer)
 *
 * Thin wrapper over the `release-notes:*` IPC surface: an on-demand fetch for
 * the running version's notes, the dismiss notification, and subscriptions to
 * the main-process pushes that open and close the modal.
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
   * Tell the main process the user dismissed the modal so it can clear the
   * parked notes and broadcast `release-notes:close` to every window.
   * Fail-soft: a missing bridge or handler error never surfaces to the caller.
   */
  async dismissReleaseNotes(): Promise<void> {
    try {
      await invokeIpc<ReleaseNotesResponse>(RELEASE_NOTES_CHANNELS.DISMISS);
    } catch {
      // Best-effort notification; the local modal is already closed.
    }
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

  /**
   * Subscribe to the main → renderer "close release notes" broadcast, sent
   * after any window dismisses the modal.
   * @returns Unsubscribe function
   */
  onClose(callback: () => void): () => void {
    const listenerId = window.electronAPI?.on(RELEASE_NOTES_CHANNELS.CLOSE, callback);
    return () => {
      if (listenerId) {
        window.electronAPI?.offById(RELEASE_NOTES_CHANNELS.CLOSE, listenerId);
      }
    };
  },
};
