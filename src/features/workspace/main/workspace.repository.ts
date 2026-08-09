/**
 * Workspace Repository
 *
 * Data access layer for workspaces. The daemon is the source of truth
 * (PROTOCOL.md §5.1) — no local filesystem probing of workspace roots.
 */

import { type Workspace, type WorkspaceId, WorkspaceStatus } from '../../../shared/types';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
import { WorkspaceConfig } from '../../../shared/main/config';
import { validateWorkspace } from '../../../shared/schemas';
import * as Errors from '../../../shared/errors';
import * as LoggerModule from '../../../shared/logger';
import {
  registerWorkspaceSlug,
  unregisterWorkspaceSlug,
} from '../../../shared/services/workspace-slug';

const { WorkspaceNotFoundError } = Errors;

const { Logger } = LoggerModule;

const logger = new Logger('WorkspaceRepository');

const CHIEF_WORKSPACE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

export function getChiefWorkspace(): Workspace {
  return {
    id: CHIEF_WORKSPACE_ID,
    // i18n-ignore (sentinel title compared against daemon-stored value)
    title: 'Chief of Staff',
    branch: '',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: CHIEF_WORKSPACE_TIMESTAMP,
    updatedAt: CHIEF_WORKSPACE_TIMESTAMP,
    lastActivity: CHIEF_WORKSPACE_TIMESTAMP,
  };
}

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
  readGitConfig(repoPath: string, workspaceId?: WorkspaceId): Promise<string>;
  cleanCache(id: WorkspaceId): Promise<void>;
}

/**
 * Daemon-backed implementation that reads workspace metadata via JSON-RPC
 * (`workspace.get` / `workspace.list`, PROTOCOL.md §5.1).
 * All operations go through the daemon — there is no filesystem fallback.
 */
export class DaemonWorkspaceRepository implements WorkspaceRepository {
  async findById(id: WorkspaceId): Promise<Workspace | null> {
    if (id === CHIEF_WORKSPACE_ID) {
      return getChiefWorkspace();
    }

    if (WorkspaceConfig.isVirtualWorkspace(id)) {
      return null;
    }

    try {
      const { getBackendClient } = await import('../../backend/main/backend.ipc');
      const response = (await getBackendClient().request('workspace.get', {
        workspaceId: id,
      })) as { workspace?: Workspace } | undefined;

      const workspace = response?.workspace;
      if (!workspace) {
        return null;
      }

      // Register the slug so isWorkspaceSlug() recognizes intent-based slugs
      registerWorkspaceSlug(id);

      return workspace;
    } catch (error) {
      logger.error('Failed to fetch workspace from daemon', error as Error, { workspaceId: id });
      return null;
    }
  }

  async findAll(): Promise<Workspace[]> {
    try {
      const { getBackendClient } = await import('../../backend/main/backend.ipc');
      const response = (await getBackendClient().request('workspace.list')) as
        | {
            workspaces?: Workspace[];
          }
        | undefined;

      const workspaces = response?.workspaces || [];

      // Guard against non-array responses
      if (!Array.isArray(workspaces)) {
        logger.warn('workspace.list returned non-array workspaces', {
          type: typeof workspaces,
        });
        return [];
      }

      // Register all workspace slugs
      for (const workspace of workspaces) {
        registerWorkspaceSlug(workspace.id);
      }

      return workspaces;
    } catch (error) {
      logger.error('Failed to list workspaces from daemon', error as Error);
      return [];
    }
  }

  async exists(id: WorkspaceId): Promise<boolean> {
    if (id === CHIEF_WORKSPACE_ID) {
      return true;
    }

    if (WorkspaceConfig.isVirtualWorkspace(id)) {
      return false;
    }

    // Check existence by trying to fetch the workspace
    const workspace = await this.findById(id);
    return workspace !== null;
  }

  async save(workspace: Workspace): Promise<void> {
    // Use workspace.update daemon RPC for metadata
    try {
      const { getBackendClient } = await import('../../backend/main/backend.ipc');
      await getBackendClient().request('workspace.update', {
        workspaceId: workspace.id,
        title: workspace.title,
        tags: workspace.tags,
        branch: workspace.branch,
        status: workspace.status,
      });
    } catch (error) {
      logger.error('Failed to save workspace via daemon', error as Error);
      throw error;
    }
  }

  async delete(id: WorkspaceId): Promise<void> {
    // Use workspace.delete daemon RPC
    try {
      const { getBackendClient } = await import('../../backend/main/backend.ipc');
      await getBackendClient().request('workspace.delete', { workspaceId: id });
    } catch (error) {
      logger.error('Failed to delete workspace via daemon', error as Error);
      throw error;
    }
  }

  async cleanup(id: WorkspaceId): Promise<void> {
    // No-op — daemon owns workspace lifecycle
    logger.debug('DaemonWorkspaceRepository.cleanup no-op (daemon-owned lifecycle)', {
      workspaceId: id,
    });
  }

  async saveContext(workspaceId: WorkspaceId, context: any): Promise<void> {
    if (WorkspaceConfig.isVirtualWorkspace(workspaceId)) {
      logger.debug('Virtual workspace context save skipped', { workspaceId });
      return;
    }

    // Use workspace.updateUiContext RPC (PROTOCOL.md §5.1, intentd#175)
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('workspace.updateUiContext', {
      workspaceId,
      uiContext: context,
    });
    logger.debug('UI context saved to daemon', { workspaceId });
  }

  async readContext(workspaceId: WorkspaceId): Promise<any | null> {
    if (WorkspaceConfig.isVirtualWorkspace(workspaceId)) {
      return null;
    }

    // Use workspace.getUiContext RPC (PROTOCOL.md §5.1, intentd#175)
    try {
      const { getBackendClient } = await import('../../backend/main/backend.ipc');
      const response = (await getBackendClient().request('workspace.getUiContext', {
        workspaceId,
      })) as { uiContext?: any | null } | undefined;

      const daemonContext = response?.uiContext;

      logger.debug('UI context read from daemon', { workspaceId });
      // Return daemon context as-is - no coercion. Undefined becomes null for consistency with return type.
      return daemonContext !== undefined ? daemonContext : null;
    } catch (error) {
      // Context is optional UI state — treat a failed read as "no stored context"
      logger.debug('Failed to read UI context from daemon', {
        workspaceId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async readGitConfig(repoPath: string, workspaceId?: WorkspaceId): Promise<string> {
    // Use git.getConfig RPC (PROTOCOL.md §5.6, intentd#159); workspaceId is required
    if (!workspaceId) {
      // i18n-ignore (developer-facing programming error)
      throw new Error('DaemonWorkspaceRepository.readGitConfig requires a workspaceId');
    }

    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    const response = (await getBackendClient().request('git.getConfig', {
      workspaceId,
    })) as { config?: string } | undefined;

    const config = response?.config || '';
    logger.debug('Git config read from daemon', { workspaceId, repoPath, length: config.length });
    return config;
  }

  async cleanCache(id: WorkspaceId): Promise<void> {
    // No-op — daemon owns cache
    logger.debug('DaemonWorkspaceRepository.cleanCache no-op (daemon-owned cache)', {
      workspaceId: id,
    });
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspaces = new Map<WorkspaceId, Workspace>();

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    if (id === CHIEF_WORKSPACE_ID) {
      return getChiefWorkspace();
    }

    return this.workspaces.get(id) || null;
  }

  async findAll(): Promise<Workspace[]> {
    return Array.from(this.workspaces.values());
  }

  async save(workspace: Workspace): Promise<void> {
    if (WorkspaceConfig.isVirtualWorkspace(workspace.id)) {
      return;
    }

    // Validate before saving
    validateWorkspace(workspace);
    this.workspaces.set(workspace.id, workspace);
    registerWorkspaceSlug(workspace.id);
  }

  async delete(id: WorkspaceId): Promise<void> {
    if (WorkspaceConfig.isVirtualWorkspace(id)) {
      return;
    }

    if (!this.workspaces.has(id)) {
      throw new WorkspaceNotFoundError(id);
    }
    this.workspaces.delete(id);
    unregisterWorkspaceSlug(id);
  }

  async exists(id: WorkspaceId): Promise<boolean> {
    if (id === CHIEF_WORKSPACE_ID) {
      return true;
    }

    if (WorkspaceConfig.isVirtualWorkspace(id)) {
      return false;
    }

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
  async readGitConfig(repoPath: string, _workspaceId?: WorkspaceId): Promise<string> {
    // In-memory implementation returns mock config
    return `[remote "origin"]
    url = git@github.com:test/repo.git`;
  }

  async cleanCache(id: WorkspaceId): Promise<void> {
    // In-memory implementation doesn't have cache
    logger.debug('In-memory cache cleanup called', { workspaceId: id });
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
