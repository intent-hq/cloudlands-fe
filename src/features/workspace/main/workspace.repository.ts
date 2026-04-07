/**
 * Workspace Repository
 *
 * Data access layer for workspaces.
 * Handles all file I/O operations.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { Workspace, WorkspaceId } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';
import { validateWorkspace, safeValidateWorkspace } from '../../../shared/schemas';
import * as Errors from '../../../shared/errors';
import * as LoggerModule from '../../../shared/logger';
import {
  registerWorkspaceSlug,
  unregisterWorkspaceSlug,
} from '../../../shared/services/workspace-slug';
import { writeJsonWithSync } from '../../../shared/main/file-sync-utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { FileNotFoundError, FileReadError, FileWriteError, WorkspaceNotFoundError } = Errors;

const { Logger } = LoggerModule;

const logger = new Logger('WorkspaceRepository');

/**
 * Repository interface for workspace persistence
 */
export interface WorkspaceRepository {
  findById(id: WorkspaceId): Promise<Workspace | null>;
  findAll(): Promise<Workspace[]>;
  save(workspace: Workspace): Promise<void>;
  delete(id: WorkspaceId): Promise<void>;
  exists(id: WorkspaceId): Promise<boolean>;
  cleanup(id: WorkspaceId): Promise<void>;
  saveContext(workspaceId: WorkspaceId, context: any): Promise<void>;
  readContext(workspaceId: WorkspaceId): Promise<any | null>;
  readGitConfig(repoPath: string): Promise<string>;
  scanDirectory(dir: string, depth?: number): Promise<string[]>;
  cleanCache(id: WorkspaceId): Promise<void>;
  clearListCache(): void;
}

/**
 * File system implementation of WorkspaceRepository
 */
export class FileSystemWorkspaceRepository implements WorkspaceRepository {
  // Simple in-memory cache to avoid redundant file reads
  private cache = new Map<WorkspaceId, { workspace: Workspace; timestamp: number }>();
  private listCache: { workspaces: Workspace[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 1000; // 1 second TTL for cache
  private readonly LIST_CACHE_TTL = 5000; // 5 seconds for list cache
  private readonly ORPHAN_CLEANUP_GRACE_MS = 5000;

  /**
   * Find workspace by ID
   */
  async findById(id: WorkspaceId): Promise<Workspace | null> {
    try {
      // Validate id parameter
      if (!id) {
        logger.error('findById called with undefined or null id');
        return null;
      }

      // Check cache first
      const cached = this.cache.get(id);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        // Don't log cache hits in normal operation - too noisy
        return cached.workspace;
      }

      const metadataPath = WorkspaceConfig.paths.workspaceMetadata(id);

      // Check if file exists
      try {
        await fs.access(metadataPath);
      } catch (accessError) {
        // Log the path that was checked to help debug race conditions
        logger.warn('Workspace metadata file not found', {
          workspaceId: id,
          metadataPath,
          error: (accessError as Error).message,
        });
        // Clear from cache if file doesn't exist
        this.cache.delete(id);
        return null;
      }

      // Read file
      const data = await fs.readFile(metadataPath, 'utf-8');
      const workspace = JSON.parse(data);

      // Validate schema
      const validation = safeValidateWorkspace(workspace);
      if (!validation.success) {
        logger.warn('Invalid workspace schema', {
          workspaceId: id,
          errors: validation.error.issues,
        });
        // Return anyway but log warning
      }

      // Update cache
      this.cache.set(id, { workspace, timestamp: Date.now() });

      // Register the slug so isWorkspaceSlug() recognizes intent-based slugs
      registerWorkspaceSlug(id);

      return workspace;
    } catch (error) {
      // Clear from cache on error
      this.cache.delete(id);

      if (error instanceof SyntaxError) {
        throw new FileReadError(
          WorkspaceConfig.paths.workspaceMetadata(id),
          new Error('Invalid JSON'),
        );
      }
      throw error;
    }
  }

  /**
   * Find all workspaces - scans ~/intent/workspaces, ~/intent, and legacy ~/.workspaces
   */
  async findAll(): Promise<Workspace[]> {
    try {
      // Check list cache first
      if (this.listCache && Date.now() - this.listCache.timestamp < this.LIST_CACHE_TTL) {
        logger.debug('Using cached workspace list');
        return this.listCache.workspaces;
      }

      // Ensure canonical workspaces directory exists
      await fs.mkdir(WorkspaceConfig.WORKSPACES_BASE, { recursive: true });

      // Collect workspace IDs from all roots, deduplicating by id (canonical wins)
      const seenIds = new Set<string>();
      const allValidEntries: { id: string; root: string }[] = [];

      // Scan canonical ~/intent/workspaces/ first
      try {
        const workspacesBaseEntries = await fs.readdir(WorkspaceConfig.WORKSPACES_BASE, {
          withFileTypes: true,
        });
        for (const entry of workspacesBaseEntries) {
          if (
            entry.isDirectory() &&
            WorkspaceConfig.isValidWorkspaceId(entry.name) &&
            !WorkspaceConfig.isVirtualWorkspace(entry.name)
          ) {
            seenIds.add(entry.name);
            allValidEntries.push({ id: entry.name, root: WorkspaceConfig.WORKSPACES_BASE });
          }
        }
      } catch {
        // ~/intent/workspaces/ doesn't exist yet -- that's fine
      }

      // Scan current root ~/intent/ (for any not-yet-migrated workspaces)
      try {
        const currentEntries = await fs.readdir(WorkspaceConfig.WORKSPACE_ROOT, {
          withFileTypes: true,
        });
        for (const entry of currentEntries) {
          if (
            entry.isDirectory() &&
            WorkspaceConfig.isValidWorkspaceId(entry.name) &&
            !WorkspaceConfig.isVirtualWorkspace(entry.name) &&
            !seenIds.has(entry.name)
          ) {
            seenIds.add(entry.name);
            allValidEntries.push({ id: entry.name, root: WorkspaceConfig.WORKSPACE_ROOT });
          }
        }
      } catch {
        // Shouldn't happen but be safe
      }

      // Scan legacy root (~/.workspaces) if it exists
      try {
        const legacyEntries = await fs.readdir(WorkspaceConfig.LEGACY_WORKSPACE_ROOT, {
          withFileTypes: true,
        });
        for (const entry of legacyEntries) {
          if (
            entry.isDirectory() &&
            WorkspaceConfig.isValidWorkspaceId(entry.name) &&
            !WorkspaceConfig.isVirtualWorkspace(entry.name) &&
            !seenIds.has(entry.name)
          ) {
            allValidEntries.push({ id: entry.name, root: WorkspaceConfig.LEGACY_WORKSPACE_ROOT });
          }
        }
      } catch {
        // Legacy directory doesn't exist -- that's fine
      }

      // Load all workspaces in parallel
      const workspacePromises = allValidEntries.map((entry) =>
        this.findById(entry.id as WorkspaceId).catch((err) => {
          logger.warn(`Failed to load workspace ${entry.id}`, err);
          return null;
        }),
      );

      const results = await Promise.all(workspacePromises);

      // Safe orphan cleanup — only delete when metadata is confirmed missing
      // and the directory is old enough that we're unlikely to race workspace creation.
      for (let i = 0; i < results.length; i++) {
        if (results[i] === null) {
          void this.maybeCleanupOrphanWorkspace(allValidEntries[i]);
        }
      }

      // Filter out null results (failed loads)
      const workspaces = results.filter((w): w is Workspace => w !== null);

      // Update list cache
      this.listCache = {
        workspaces,
        timestamp: Date.now(),
      };

      return workspaces;
    } catch (error) {
      logger.error('Failed to list workspaces', error as Error);
      return [];
    }
  }

  private isErrnoCode(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === code
    );
  }

  private async maybeCleanupOrphanWorkspace(entry: { id: string; root: string }): Promise<void> {
    const workspacePath = path.join(entry.root, entry.id);
    const metadataDir = path.join(workspacePath, WorkspaceConfig.METADATA_FOLDER);
    const metadataPath = path.join(metadataDir, WorkspaceConfig.WORKSPACE_METADATA_FILE);

    try {
      await fs.access(metadataPath);
      logger.warn('Workspace metadata exists but failed to load, skipping cleanup', {
        workspaceId: entry.id,
        metadataPath,
      });
      return;
    } catch (error) {
      if (!this.isErrnoCode(error, 'ENOENT')) {
        logger.warn('Failed to verify workspace metadata before cleanup, skipping orphan cleanup', {
          workspaceId: entry.id,
          metadataPath,
          error: (error as Error).message,
        });
        return;
      }
    }

    let candidateAgeMs: number | null = null;
    for (const statPath of [metadataDir, workspacePath]) {
      try {
        const stat = await fs.stat(statPath);
        candidateAgeMs = Date.now() - stat.mtimeMs;
        break;
      } catch (error) {
        if (!this.isErrnoCode(error, 'ENOENT')) {
          logger.warn('Failed to inspect orphan workspace candidate, skipping cleanup', {
            workspaceId: entry.id,
            path: statPath,
            error: (error as Error).message,
          });
          return;
        }
      }
    }

    if (candidateAgeMs === null) {
      logger.debug('Workspace orphan candidate disappeared before cleanup', {
        workspaceId: entry.id,
      });
      return;
    }

    if (candidateAgeMs < this.ORPHAN_CLEANUP_GRACE_MS) {
      logger.debug('Skipping orphan cleanup during workspace creation grace period', {
        workspaceId: entry.id,
        ageMs: Math.round(candidateAgeMs),
      });
      return;
    }

    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      logger.info('Cleaned up orphan workspace directory', { workspaceId: entry.id });
    } catch (error) {
      if (this.isErrnoCode(error, 'ENOENT')) {
        logger.debug('Workspace orphan candidate already removed before cleanup completed', {
          workspaceId: entry.id,
        });
        return;
      }

      logger.warn('Failed to clean up orphan directory', {
        workspaceId: entry.id,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Save workspace
   */
  async save(workspace: Workspace): Promise<void> {
    try {
      // Validate workspace before saving
      validateWorkspace(workspace);

      // Invalidate list cache when saving
      this.listCache = null;

      // Check if workspace directory exists before creating
      const workspaceDir = WorkspaceConfig.paths.workspace(workspace.id);
      try {
        await fs.access(workspaceDir);
        logger.debug('Workspace directory exists', { workspaceDir });
      } catch  {
        // Directory doesn't exist, create it
        logger.debug('Creating workspace directory', { workspaceDir });
        try {
          await fs.mkdir(workspaceDir, { recursive: true });
          logger.debug('Workspace directory created successfully', { workspaceDir });
        } catch (mkdirError) {
          logger.error('Failed to create workspace directory', mkdirError as Error, {
            workspaceDir,
            workspaceId: workspace.id,
          });
          throw mkdirError;
        }
      }

      // Check if metadata directory exists before creating
      const metadataDir = WorkspaceConfig.paths.metadata(workspace.id);
      try {
        await fs.access(metadataDir);
        logger.debug('Metadata directory exists', { metadataDir });
      } catch  {
        // Directory doesn't exist, create it
        logger.debug('Creating metadata directory', { metadataDir });
        try {
          await fs.mkdir(metadataDir, { recursive: true });
          logger.debug('Metadata directory created successfully', { metadataDir });
        } catch (mkdirError) {
          logger.error('Failed to create metadata directory', mkdirError as Error, {
            metadataDir,
            workspaceId: workspace.id,
          });
          throw mkdirError;
        }
      }

      // Check if metadata has actually changed before writing
      const metadataPath = WorkspaceConfig.paths.workspaceMetadata(workspace.id);
      let shouldWrite = true;

      try {
        const existingContent = await fs.readFile(metadataPath, 'utf-8');
        const existingWorkspace = JSON.parse(existingContent);

        // Compare the serialized JSON to see if anything actually changed
        // We compare the stringified versions to avoid issues with object ordering
        const newContent = JSON.stringify(workspace, null, 2);
        const existingContentNormalized = JSON.stringify(existingWorkspace, null, 2);

        if (newContent === existingContentNormalized) {
          shouldWrite = false;
          // Don't log skipped writes in normal operation - too noisy
        }
      } catch {
        // File doesn't exist or can't be read, we should write it
        shouldWrite = true;
      }

      if (shouldWrite) {
        logger.debug('Writing workspace metadata with atomic pattern', { metadataPath });
        try {
          // Use atomic write pattern: write to temp file, sync, then rename
          // This is much safer than writing directly and trying to sync afterwards
          await writeJsonWithSync(metadataPath, workspace, { spaces: 2 });
          logger.debug('Workspace metadata written and synced successfully', { metadataPath });
        } catch (writeError) {
          logger.error('Failed to write workspace metadata file', writeError as Error, {
            metadataPath,
            workspaceId: workspace.id,
            errorCode: (writeError as NodeJS.ErrnoException).code,
          });
          throw writeError;
        }

        logger.debug('Workspace saved successfully', { workspaceId: workspace.id });

        // Update cache with the new workspace data
        this.cache.set(workspace.id, { workspace, timestamp: Date.now() });

        // Register the slug so isWorkspaceSlug() recognizes intent-based slugs
        registerWorkspaceSlug(workspace.id);
      }
    } catch (error) {
      const errnoError = error as NodeJS.ErrnoException;
      logger.error('Failed to save workspace', error as Error, {
        workspaceId: workspace.id,
        errorCode: errnoError.code,
        errorPath: errnoError.path,
        metadataPath: WorkspaceConfig.paths.workspaceMetadata(workspace.id),
      });
      if (error instanceof Error) {
        throw new FileWriteError(WorkspaceConfig.paths.workspaceMetadata(workspace.id), error);
      }
      throw error;
    }
  }

  /**
   * Delete workspace
   */
  async delete(id: WorkspaceId): Promise<void> {
    try {
      const workspacePath = WorkspaceConfig.paths.workspace(id);

      // Check if workspace exists
      try {
        await fs.access(workspacePath);
      } catch {
        throw new WorkspaceNotFoundError(id);
      }

      // Delete entire workspace directory
      // maxRetries handles ENOTEMPTY errors from concurrent file writes during deletion
      await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

      // Clear from cache
      this.cache.delete(id);
      // Invalidate list cache
      this.listCache = null;
      // Unregister from slug registry
      unregisterWorkspaceSlug(id);

      logger.info('Workspace deleted', { workspaceId: id });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        throw error;
      }
      logger.error('Failed to delete workspace', error as Error, { workspaceId: id });
      throw error;
    }
  }

  /**
   * Check if workspace exists
   */
  async exists(id: WorkspaceId): Promise<boolean> {
    try {
      const metadataPath = WorkspaceConfig.paths.workspaceMetadata(id);
      await fs.access(metadataPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up workspace directory (for failed creation)
   */
  async cleanup(id: WorkspaceId): Promise<void> {
    try {
      const workspacePath = WorkspaceConfig.paths.workspace(id);
      await fs.rm(workspacePath, { recursive: true, force: true });
      logger.debug('Workspace directory cleaned up', { workspaceId: id });
    } catch  {
      // Directory might not exist, that's okay
      logger.debug('Workspace cleanup - directory might not exist', { workspaceId: id });
    }
  }

  /**
   * Save workspace UI context
   */
  async saveContext(workspaceId: WorkspaceId, context: any): Promise<void> {
    try {
      const metadataPath = WorkspaceConfig.paths.metadata(workspaceId);
      const contextPath = path.join(metadataPath, 'current-context.json');

      // Ensure metadata directory exists
      await fs.mkdir(metadataPath, { recursive: true });

      // Use atomic write pattern for durability
      await writeJsonWithSync(contextPath, context, { spaces: 2 });

      logger.debug('Context saved', { workspaceId });
    } catch (error) {
      logger.error('Failed to save context', error as Error, { workspaceId });
      throw new FileWriteError(
        path.join(WorkspaceConfig.paths.metadata(workspaceId), 'current-context.json'),
        error as Error,
      );
    }
  }

  /**
   * Read workspace UI context
   */
  async readContext(workspaceId: WorkspaceId): Promise<any | null> {
    try {
      const metadataPath = WorkspaceConfig.paths.metadata(workspaceId);
      const contextPath = path.join(metadataPath, 'current-context.json');

      // Check if file exists
      try {
        await fs.access(contextPath);
      } catch {
        // File doesn't exist
        return null;
      }

      // Read and parse the context file
      const data = await fs.readFile(contextPath, 'utf-8');
      const context = JSON.parse(data);

      logger.debug('Context read from disk', { workspaceId });
      return context;
    } catch (error) {
      logger.error('Failed to read context', error as Error, { workspaceId });
      // Return null instead of throwing - context file is optional
      return null;
    }
  }

  /**
   * Read git config to extract repository info.
   * Handles both direct git repos and subdirectories of git repos.
   */
  async readGitConfig(repoPath: string): Promise<string> {
    try {
      // First try the direct path
      const gitConfigPath = path.join(repoPath, '.git', 'config');
      try {
        return await fs.readFile(gitConfigPath, 'utf-8');
      } catch {
        // .git/config doesn't exist at this path, try finding parent git root
      }

      // If direct path fails, walk up to find parent git root
      const { findParentGitDir } = await import('../../../shared/git/git-utils');
      const parentGitRoot = await findParentGitDir(repoPath);

      if (parentGitRoot && parentGitRoot !== repoPath) {
        const parentGitConfigPath = path.join(parentGitRoot, '.git', 'config');
        logger.debug('Found parent git root for config', {
          repoPath,
          parentGitRoot,
        });
        return await fs.readFile(parentGitConfigPath, 'utf-8');
      }

      // No git config found
      throw new Error(`No .git/config found at ${repoPath} or any parent directory`);
    } catch (error) {
      logger.debug('Failed to read git config', { repoPath });
      throw new FileReadError(path.join(repoPath, '.git', 'config'), error as Error);
    }
  }

  /**
   * Scan directory for git repositories
   */
  async scanDirectory(dir: string, depth: number = 0): Promise<string[]> {
    const repositories: string[] = [];
    if (depth > 3) return repositories; // Limit depth

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // Check if this directory is a git repository
      if (entries.some((e) => e.name === '.git' && e.isDirectory())) {
        repositories.push(dir);
        return repositories; // Don't scan subdirectories of git repos
      }

      // Recursively scan subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const subRepos = await this.scanDirectory(path.join(dir, entry.name), depth + 1);
          repositories.push(...subRepos);
        }
      }
    } catch (error) {
      logger.debug('Failed to scan directory', { dir, error });
    }

    return repositories;
  }

  /**
   * Clean cache directory
   */
  async cleanCache(id: WorkspaceId): Promise<void> {
    try {
      const cachePath = WorkspaceConfig.paths.cache(id);
      await fs.rm(cachePath, { recursive: true, force: true });

      // Also clear the in-memory cache for this workspace
      this.cache.delete(id);

      logger.debug('Cache directory and memory cache cleaned', { workspaceId: id });
    } catch {
      // Directory might not exist, that's okay
      // Still clear the in-memory cache
      this.cache.delete(id);
      logger.debug('Cache cleanup - directory might not exist', { workspaceId: id });
    }
  }

  clearListCache(): void {
    this.listCache = null;
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspaces = new Map<WorkspaceId, Workspace>();

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.get(id) || null;
  }

  async findAll(): Promise<Workspace[]> {
    return Array.from(this.workspaces.values());
  }

  async save(workspace: Workspace): Promise<void> {
    // Validate before saving
    validateWorkspace(workspace);
    this.workspaces.set(workspace.id, workspace);
    registerWorkspaceSlug(workspace.id);
  }

  async delete(id: WorkspaceId): Promise<void> {
    if (!this.workspaces.has(id)) {
      throw new WorkspaceNotFoundError(id);
    }
    this.workspaces.delete(id);
    unregisterWorkspaceSlug(id);
  }

  async exists(id: WorkspaceId): Promise<boolean> {
    return this.workspaces.has(id);
  }

  async cleanup(id: WorkspaceId): Promise<void> {
    // In-memory implementation doesn't need cleanup
    logger.debug('In-memory cleanup called', { workspaceId: id });
  }

  async saveContext(workspaceId: WorkspaceId, context: any): Promise<void> {
    // In-memory implementation stores context in workspace object
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) {
      (workspace as any).currentContext = context;
    }
  }

  async readContext(workspaceId: WorkspaceId): Promise<any | null> {
    // In-memory implementation reads context from workspace object
    const workspace = this.workspaces.get(workspaceId);
    return workspace ? (workspace as any).currentContext || null : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readGitConfig(repoPath: string): Promise<string> {
    // In-memory implementation returns mock config
    return `[remote "origin"]
    url = git@github.com:test/repo.git`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async scanDirectory(dir: string, depth: number = 0): Promise<string[]> {
    // In-memory implementation returns empty array
    return [];
  }

  async cleanCache(id: WorkspaceId): Promise<void> {
    // In-memory implementation doesn't have cache
    logger.debug('In-memory cache cleanup called', { workspaceId: id });
  }

  clearListCache(): void {
    // No-op: in-memory implementation doesn't have a list cache
  }

  // Test helpers
  clear(): void {
    this.workspaces.clear();
  }

  count(): number {
    return this.workspaces.size;
  }

  getAll(): Workspace[] {
    return Array.from(this.workspaces.values());
  }
}
