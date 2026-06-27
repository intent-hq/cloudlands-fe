/**
 * Metadata Watcher Manager
 *
 * Manages metadata watching for workspaces.
 * Uses fs.watchFile for polling since metadata files are stored OUTSIDE the repo
 * (e.g., ~/.config/amelia/workspaces/<id>/metadata.json), and the unified watcher
 * only watches the repo root.
 */

import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config';
import * as fs from 'fs';
import {
  watchFile,
  unwatchFile,
} from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

const logger = new Logger('MetadataWatcherManager');

interface WorkspaceMetadata {
  id: string;
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  settings?: Record<string, any>;
  [key: string]: any;
}

export class MetadataWatcherManager extends EventEmitter {
  private static instance: MetadataWatcherManager;
  private watchedPaths: Map<string, string> = new Map();
  private metadataCache: Map<string, WorkspaceMetadata> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): MetadataWatcherManager {
    if (!MetadataWatcherManager.instance) {
      MetadataWatcherManager.instance = new MetadataWatcherManager();
    }
    return MetadataWatcherManager.instance;
  }

  async startWatching(workspaceId: string, metadataPath?: string): Promise<void> {
    logger.debug('Starting metadata watching', { workspaceId, metadataPath });

    // Stop existing watcher if any
    await this.stopWatching(workspaceId);

    // Determine metadata file path
    const watchPath = metadataPath || this.getDefaultMetadataPath(workspaceId);

    if (!watchPath) {
      logger.warn('No metadata path provided for workspace', { workspaceId });
      return;
    }

    // Ensure metadata file exists
    await this.ensureMetadataFile(watchPath, workspaceId);

    // Use fs.watchFile for polling since the metadata file is OUTSIDE the repo
    // (the unified watcher only watches the repo root, not external config files)
    watchFile(watchPath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        this.handleMetadataChange(workspaceId, watchPath, 'changed');
      } else if (curr.nlink === 0 && prev.nlink !== 0) {
        // File was deleted
        this.handleMetadataChange(workspaceId, watchPath, 'deleted');
      }
    });

    this.watchedPaths.set(workspaceId, watchPath);
    logger.info('Metadata watching started', { workspaceId, path: watchPath });
  }

  async stopWatching(workspaceId: string): Promise<void> {
    logger.debug('Stopping metadata watching', { workspaceId });
    const watchPath = this.watchedPaths.get(workspaceId);
    if (watchPath) {
      unwatchFile(watchPath);
      this.watchedPaths.delete(workspaceId);
      this.metadataCache.delete(workspaceId);
      logger.info('Metadata watching stopped', { workspaceId });
    }
  }

  async getMetadata(workspaceId: string): Promise<WorkspaceMetadata | null> {
    // Return cached metadata if available
    const cached = this.metadataCache.get(workspaceId);
    if (cached !== undefined) {
      return cached;
    }

    // Try to load from file
    const metadataPath = this.getDefaultMetadataPath(workspaceId);
    if (metadataPath && fs.existsSync(metadataPath)) {
      try {
        const content = await fs.promises.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(content) as WorkspaceMetadata;
        this.metadataCache.set(workspaceId, metadata);
        return metadata;
      } catch (error) {
        logger.error('Failed to read metadata', { workspaceId, error });
      }
    }

    return null;
  }

  private getDefaultMetadataPath(workspaceId: string): string | null {
    // Resolve workspace root (supports both ~/intent and legacy ~/.workspaces)
    return path.join(
      WorkspaceConfig.resolveWorkspaceRoot(workspaceId),
      workspaceId,
      '.workspace',
      'metadata.json',
    );
  }

  private async ensureMetadataFile(metadataPath: string, workspaceId: string): Promise<void> {
    const dir = path.dirname(metadataPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Create default metadata if file doesn't exist
    if (!fs.existsSync(metadataPath)) {
      const defaultMetadata: WorkspaceMetadata = {
        id: workspaceId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        settings: {},
      };

      await fs.promises.writeFile(metadataPath, JSON.stringify(defaultMetadata, null, 2), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(metadataPath);

      logger.info('Created default metadata file', { workspaceId, path: metadataPath });
    }
  }

  private async handleMetadataChange(
    workspaceId: string,
    filePath: string,
    event: string,
  ): Promise<void> {
    logger.debug('Metadata change detected', { workspaceId, event, filePath });

    // Check if the path is a directory - if so, ignore it
    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.isDirectory()) {
        logger.debug('Ignoring directory change event', { workspaceId, filePath });
        return;
      }
    } catch (error) {
      // File might have been deleted, continue processing
      if (event !== 'deleted') {
        logger.debug('Could not stat file', { workspaceId, filePath, error });
        return;
      }
    }

    // Only process metadata.json files
    if (!filePath.endsWith('metadata.json')) {
      logger.debug('Ignoring non-metadata file', { workspaceId, filePath });
      return;
    }

    if (event === 'deleted') {
      this.metadataCache.delete(workspaceId);
      this.emit('metadata:deleted', { workspaceId });
      return;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const metadata = JSON.parse(content) as WorkspaceMetadata;

      // Update cache
      this.metadataCache.set(workspaceId, metadata);

      // Emit change event
      this.emit('metadata:changed', { workspaceId, metadata });

      logger.debug('Metadata updated', { workspaceId, metadata });
    } catch (error) {
      logger.error('Failed to process metadata change', { workspaceId, error });
      this.emit('error', { workspaceId, error });
    }
  }
}
