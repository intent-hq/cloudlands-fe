/**
 * Panel Layout History Repository
 *
 * Data access layer for panel layout history persistence.
 * Handles file I/O for storing layout snapshots that enable undo/redo of layout changes.
 */

import { promises as fs } from 'fs';
import type { WorkspaceId } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import * as Errors from '../../../shared/errors';
import { Logger } from '../../../shared/logger';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const { FileReadError, FileWriteError } = Errors;

const logger = new Logger('PanelLayoutHistoryRepository');

const CURRENT_VERSION = 1;
const MAX_HISTORY_SNAPSHOTS = 50;

/**
 * A snapshot of the panel layout state at a point in time
 */
export interface LayoutSnapshot {
  root: any; // PanelLayoutNode - using any to avoid circular deps
  panels: Record<string, any>; // Record<string, PanelState>
  focusedPanelId: string | null;
  timestamp: number;
}

/**
 * Persisted panel layout history data
 */
export interface PanelLayoutHistoryData {
  version: number;
  workspaceId: string;
  history: LayoutSnapshot[];
  historyIndex: number;
  lastUpdated: string;
}

/**
 * Repository interface for panel layout history persistence
 */
export interface PanelLayoutHistoryRepository {
  load(workspaceId: WorkspaceId): Promise<PanelLayoutHistoryData | null>;
  save(workspaceId: WorkspaceId, data: PanelLayoutHistoryData): Promise<void>;
}

/**
 * File system implementation
 */
export class FileSystemPanelLayoutHistoryRepository implements PanelLayoutHistoryRepository {
  async load(workspaceId: WorkspaceId): Promise<PanelLayoutHistoryData | null> {
    try {
      const filePath = WorkspaceConfig.paths.panelLayoutHistory(workspaceId);

      try {
        await fs.access(filePath);
      } catch {
        logger.debug(`Panel layout history file does not exist for workspace: ${workspaceId}`);
        return null;
      }

      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Version check
      if (parsed.version !== CURRENT_VERSION) {
        logger.warn('Panel layout history version mismatch, ignoring', {
          expected: CURRENT_VERSION,
          got: parsed.version,
        });
        return null;
      }

      // Validate workspace ID
      if (parsed.workspaceId !== workspaceId) {
        logger.error('Workspace ID mismatch in panel layout history');
        return null;
      }

      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error(`Invalid JSON in panel layout history for workspace: ${workspaceId}`, error);
        return null;
      }
      logger.error(`Failed to load panel layout history for workspace: ${workspaceId}`, error as Error);
      throw new FileReadError(WorkspaceConfig.paths.panelLayoutHistory(workspaceId), error as Error);
    }
  }

  async save(workspaceId: WorkspaceId, data: PanelLayoutHistoryData): Promise<void> {
    try {
      // Limit history size before saving
      const historyToSave = data.history.slice(-MAX_HISTORY_SNAPSHOTS);
      const indexAdjustment = data.history.length - historyToSave.length;
      const adjustedIndex = Math.max(0, data.historyIndex - indexAdjustment);

      const toSave: PanelLayoutHistoryData = {
        ...data,
        history: historyToSave,
        historyIndex: adjustedIndex,
        lastUpdated: new Date().toISOString(),
      };

      // Ensure metadata directory exists
      const metadataDir = WorkspaceConfig.paths.metadata(workspaceId);
      await fs.mkdir(metadataDir, { recursive: true });

      const filePath = WorkspaceConfig.paths.panelLayoutHistory(workspaceId);
      await fs.writeFile(filePath, JSON.stringify(toSave, null, 2), 'utf-8');

      // Sync to disk
      await fsyncFile(filePath);

      logger.debug(`Panel layout history saved for workspace: ${workspaceId}`, {
        historyLength: historyToSave.length,
        historyIndex: adjustedIndex,
      });
    } catch (error) {
      logger.error(`Failed to save panel layout history for workspace: ${workspaceId}`, error as Error);
      if (error instanceof Error) {
        throw new FileWriteError(WorkspaceConfig.paths.panelLayoutHistory(workspaceId), error);
      }
      throw error;
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryPanelLayoutHistoryRepository implements PanelLayoutHistoryRepository {
  private data = new Map<WorkspaceId, PanelLayoutHistoryData>();

  async load(workspaceId: WorkspaceId): Promise<PanelLayoutHistoryData | null> {
    return this.data.get(workspaceId) || null;
  }

  async save(workspaceId: WorkspaceId, data: PanelLayoutHistoryData): Promise<void> {
    this.data.set(workspaceId, data);
  }

  clear(): void {
    this.data.clear();
  }
}

export function createPanelLayoutHistoryRepository(): PanelLayoutHistoryRepository {
  return new FileSystemPanelLayoutHistoryRepository();
}
