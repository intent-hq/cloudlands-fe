/**
 * First Visit State Client
 *
 * Client-side wrapper for first visit state IPC communication.
 * Used by renderer process to communicate with main process.
 */

import type { FirstVisitState, WorkspaceId } from '../../shared/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('FirstVisitStateClient');

class FirstVisitStateClient {
  /**
   * Load first visit state for a workspace
   */
  async load(workspaceId: WorkspaceId): Promise<FirstVisitState | null> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await window.electronAPI.invoke('first-visit-state:load', { workspaceId });
      }
      logger.warn('[FirstVisitStateClient] IPC not available');
      return null;
    } catch (error) {
      logger.error(
        `[FirstVisitStateClient] Failed to load state for workspace: ${workspaceId}`,
        error,
      );
      return null;
    }
  }

  /**
   * Save first visit state for a workspace
   */
  async save(workspaceId: WorkspaceId, state: FirstVisitState): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await window.electronAPI.invoke('first-visit-state:save', { workspaceId, state });
      }
      logger.warn('[FirstVisitStateClient] IPC not available');
      return false;
    } catch (error) {
      logger.error(
        `[FirstVisitStateClient] Failed to save state for workspace: ${workspaceId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Delete first visit state for a workspace
   */
  async delete(workspaceId: WorkspaceId): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await window.electronAPI.invoke('first-visit-state:delete', { workspaceId });
      }
      logger.warn('[FirstVisitStateClient] IPC not available');
      return false;
    } catch (error) {
      logger.error(
        `[FirstVisitStateClient] Failed to delete state for workspace: ${workspaceId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Check if first visit state exists for a workspace
   */
  async exists(workspaceId: WorkspaceId): Promise<boolean> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        return await window.electronAPI.invoke('first-visit-state:exists', { workspaceId });
      }
      logger.warn('[FirstVisitStateClient] IPC not available');
      return false;
    } catch (error) {
      logger.error(
        `[FirstVisitStateClient] Failed to check existence for workspace: ${workspaceId}`,
        error,
      );
      return false;
    }
  }
}

export const firstVisitStateClient = new FirstVisitStateClient();
