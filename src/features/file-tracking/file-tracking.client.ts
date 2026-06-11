/**
 * File Tracking Client
 *
 * Client-side wrapper for file tracking IPC calls.
 * Used by renderer process components to get file tracking data.
 */

import { FILE_TRACKING_CHANNELS } from '../../shared/ipc/channels';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';

interface IPCResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface LineStats {
  additions: number;
  deletions: number;
}

/**
 * Get line change statistics for a workspace.
 * Returns real-time additions/deletions calculated from:
 * - Unstaged changes
 * - Staged changes
 * - Local commits (not yet pushed)
 *
 * This matches the calculation used in the workspace view (StackedSidebar/TabbedSidebar).
 */
export async function getLineStats(workspaceId: string): Promise<LineStats> {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return { additions: 0, deletions: 0 };
  }

  try {
    const response = await invokeIpc<IPCResponse<LineStats>>(FILE_TRACKING_CHANNELS.GET_LINE_STATS, {
      workspaceId,
    });

    if (!response.ok || !response.data) {
      return { additions: 0, deletions: 0 };
    }

    return response.data;
  } catch {
    return { additions: 0, deletions: 0 };
  }
}
