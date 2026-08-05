/**
 * First Visit State Repository
 *
 * Data access layer for first visit state persistence.
 * Handles all file I/O operations for tracking first visit progress.
 */

import { promises as fs } from 'fs';
import type { FirstVisitState, WorkspaceId } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import { validateFirstVisitState, safeValidateFirstVisitState } from '../../../shared/schemas';
import * as Errors from '../../../shared/errors';
import { Logger } from '../../../shared/logger';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const { FileReadError, FileWriteError } = Errors;

const logger = new Logger('FirstVisitStateRepository');

const CURRENT_VERSION = 1;

/**
 * Repository interface for first visit state persistence
 */
export interface FirstVisitStateRepository {
  load(workspaceId: WorkspaceId): Promise<FirstVisitState | null>;
  save(workspaceId: WorkspaceId, state: FirstVisitState): Promise<void>;
  delete(workspaceId: WorkspaceId): Promise<void>;
  exists(workspaceId: WorkspaceId): Promise<boolean>;
}

/**
 * File system implementation of FirstVisitStateRepository
 */
export class FileSystemFirstVisitStateRepository implements FirstVisitStateRepository {
  /**
   * Load first visit state for a workspace
   */
  async load(workspaceId: WorkspaceId): Promise<FirstVisitState | null> {
    try {
      const statePath = WorkspaceConfig.paths.firstVisitState(workspaceId);

      // Check if file exists
      try {
        await fs.access(statePath);
      } catch {
        logger.debug(`First visit state file does not exist for workspace: ${workspaceId}`);
        return null;
      }

      // Read file
      const data = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(data);

      // Validate schema
      const validation = safeValidateFirstVisitState(state);
      if (!validation.success) {
        logger.warn(`Invalid first visit state schema for workspace: ${workspaceId}`, {
          errors: validation.error.issues,
        });
        // Return null for invalid data
        return null;
      }

      // Validate workspace ID matches
      if (state.workspaceId !== workspaceId) {
        logger.error(
          // i18n-ignore (developer log / internal error)
          `First visit state workspace ID mismatch for workspace: ${workspaceId}. ` +
            // i18n-ignore (developer log / internal error)
            `State has: ${state.workspaceId}, expected: ${workspaceId}`,
        );
        return null;
      }

      // logger.debug(`First visit state loaded successfully for workspace: ${workspaceId}`);
      return state;
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error(`Invalid JSON in first visit state file for workspace: ${workspaceId}`, error);
        return null;
      }
      logger.error(
        // i18n-ignore (developer log / internal error)
        `Failed to load first visit state for workspace: ${workspaceId}`,
        error as Error,
      );
      throw new FileReadError(WorkspaceConfig.paths.firstVisitState(workspaceId), error as Error);
    }
  }

  /**
   * Save first visit state for a workspace
   */
  async save(workspaceId: WorkspaceId, state: FirstVisitState): Promise<void> {
    try {
      // Validate state before saving
      validateFirstVisitState(state);

      // Validate workspace ID matches
      if (state.workspaceId !== workspaceId) {
        throw new Error(
          // i18n-ignore (developer log / internal error)
          `Workspace ID mismatch: state.workspaceId=${state.workspaceId}, workspaceId=${workspaceId}`,
        );
      }

      // Ensure metadata directory exists
      const metadataDir = WorkspaceConfig.paths.metadata(workspaceId);
      await fs.mkdir(metadataDir, { recursive: true });

      // Write state file
      const statePath = WorkspaceConfig.paths.firstVisitState(workspaceId);
      await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(statePath);

      // logger.debug(`First visit state saved successfully for workspace: ${workspaceId}`);
    } catch (error) {
      logger.error(
        // i18n-ignore (developer log / internal error)
        `Failed to save first visit state for workspace: ${workspaceId}`,
        error as Error,
      );
      if (error instanceof Error) {
        throw new FileWriteError(WorkspaceConfig.paths.firstVisitState(workspaceId), error);
      }
      throw error;
    }
  }

  /**
   * Delete first visit state for a workspace
   */
  async delete(workspaceId: WorkspaceId): Promise<void> {
    try {
      const statePath = WorkspaceConfig.paths.firstVisitState(workspaceId);

      // Check if file exists
      try {
        await fs.access(statePath);
      } catch {
        // File doesn't exist, nothing to delete
        logger.debug(`First visit state file does not exist for workspace: ${workspaceId}`);
        return;
      }

      // Delete file
      await fs.unlink(statePath);
      logger.debug(`First visit state deleted successfully for workspace: ${workspaceId}`);
    } catch (error) {
      logger.error(
        // i18n-ignore (developer log / internal error)
        `Failed to delete first visit state for workspace: ${workspaceId}`,
        error as Error,
      );
      throw error;
    }
  }

  /**
   * Check if first visit state exists for a workspace
   */
  async exists(workspaceId: WorkspaceId): Promise<boolean> {
    try {
      const statePath = WorkspaceConfig.paths.firstVisitState(workspaceId);
      await fs.access(statePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryFirstVisitStateRepository implements FirstVisitStateRepository {
  private states = new Map<WorkspaceId, FirstVisitState>();

  async load(workspaceId: WorkspaceId): Promise<FirstVisitState | null> {
    return this.states.get(workspaceId) || null;
  }

  async save(workspaceId: WorkspaceId, state: FirstVisitState): Promise<void> {
    // Validate before saving
    validateFirstVisitState(state);

    // Validate workspace ID matches
    if (state.workspaceId !== workspaceId) {
      throw new Error(
        // i18n-ignore (developer log / internal error)
        `Workspace ID mismatch: state.workspaceId=${state.workspaceId}, workspaceId=${workspaceId}`,
      );
    }

    this.states.set(workspaceId, state);
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    this.states.delete(workspaceId);
  }

  async exists(workspaceId: WorkspaceId): Promise<boolean> {
    return this.states.has(workspaceId);
  }

  // Test helper
  clear(): void {
    this.states.clear();
  }
}

/**
 * Create default first visit state for a workspace
 */
export function createDefaultFirstVisitState(workspaceId: WorkspaceId): FirstVisitState {
  return {
    version: CURRENT_VERSION,
    workspaceId,
    firstVisitSetupReady: false, // Setup not done yet
    mainContentRevealed: false,
    navigationRailRevealed: false,
    workspaceDockRevealed: false,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Factory function to create a FirstVisitStateRepository instance
 */
export function createFirstVisitStateRepository(): FirstVisitStateRepository {
  return new FileSystemFirstVisitStateRepository();
}
