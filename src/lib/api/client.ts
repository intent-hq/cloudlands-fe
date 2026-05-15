// Use window.electronAPI for IPC communication in Electron
import { Logger } from '$shared/logger';
import type { CommandResponse, DiffChunk, Workspace } from '$shared/types';

const logger = new Logger('APIClient');

// Check if we're in Electron environment
function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

// Helper function to invoke IPC methods
async function invoke<T>(channel: string, args?: any): Promise<CommandResponse<T>> {
  if (isElectron()) {
    return await window.electronAPI.invoke(channel, args ?? undefined);
  }
  // Fallback for development/testing - return success: false instead of throwing
  logger.warn(`Electron IPC not available for channel: ${channel}`);
  return {
    success: false,
    error: 'Electron IPC not available - running in browser mode',
  };
}

class ApiClient {
  // Workspace operations
  async createWorkspace(
    title: string,
    baseRef?: string,
    repoPath?: string,
    environmentConfig?: any,
  ): Promise<Workspace> {
    const response = await invoke<Workspace>('create_workspace', {
      title,
      baseRef,
      repoPath,
      environmentConfig,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to create workspace');
    }

    return response.data!;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await invoke<Workspace[]>('list_workspaces');

    if (!response.success) {
      throw new Error(response.error || 'Failed to list workspaces');
    }

    return response.data || [];
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    const response = await invoke<Workspace | null>('get_workspace', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get workspace');
    }

    return response.data || null;
  }

  async updateWorkspace(workspace: Workspace): Promise<void> {
    // Use JSON.parse(JSON.stringify()) to deep clone and ensure serializability
    // This removes any non-serializable properties like functions, undefined values, etc.
    let cleanWorkspace: any;
    try {
      cleanWorkspace = JSON.parse(JSON.stringify(workspace));
    } catch (e) {
      logger.error('Failed to serialize workspace, trying minimal update', e);
      // Fallback to minimal update
      cleanWorkspace = {
        id: workspace.id,
        title: workspace.title,
        branch: workspace.branch,
        baseRef: workspace.baseRef,
        status: workspace.status,
        tags: workspace.tags,
      };
    }

    const response = await invoke<void>('update_workspace', {
      workspace: cleanWorkspace,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to update workspace');
    }
  }

  async updateWorkspaceTitle(id: string, title: string): Promise<void> {
    // Minimal update for just the title
    const response = await invoke<void>('update_workspace', {
      workspace: {
        id,
        title,
      },
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to update workspace title');
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const response = await invoke<void>('delete_workspace', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to delete workspace');
    }
  }

  async cleanupOrphanedWorkspaces(): Promise<void> {
    const response = await invoke<void>('workspace:cleanup');

    if (!response.success) {
      throw new Error(response.error || 'Failed to cleanup orphaned workspaces');
    }
  }

  async archiveWorkspace(workspaceId: string): Promise<void> {
    const response = await invoke<void>('archive_workspace', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to archive workspace');
    }
  }

  async unarchiveWorkspace(workspaceId: string): Promise<void> {
    const response = await invoke<void>('workspace:unarchive', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to unarchive workspace');
    }
  }

  async updateWorkspaceGitInfo(workspaceId: string): Promise<any> {
    const response = await invoke<any>('workspace:update_git_info', workspaceId);

    if (!response.success) {
      throw new Error(response.error || 'Failed to update git info');
    }

    return response.data;
  }

  async findGitRepositories(searchPath: string): Promise<string[]> {
    const response = await invoke<string[]>('workspace:find-repositories', {
      searchPath,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to find git repositories');
    }

    return response.data || [];
  }

  async getRecentRepositories(limit?: number): Promise<string[]> {
    const response = await invoke<string[]>('workspace:get-recent-repositories', {
      limit: limit || 10,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get recent repositories');
    }

    return response.data || [];
  }

  async addRecentRepository(repoPath: string): Promise<void> {
    const response = await invoke<void>('workspace:add-recent-repository', {
      repoPath,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to add recent repository');
    }
  }

  async clearRecentRepositories(): Promise<void> {
    const response = await invoke<void>('workspace:clear-recent-repositories');

    if (!response.success) {
      throw new Error(response.error || 'Failed to clear recent repositories');
    }
  }

  async setCurrentWorkspace(workspaceId: string): Promise<void> {
    const response = await invoke<void>('set_current_workspace', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to set current workspace');
    }
  }

  async getCurrentWorkspace(): Promise<string | null> {
    const response = await invoke<string>('get_current_workspace');

    if (!response.success) {
      throw new Error(response.error || 'Failed to get current workspace');
    }

    return response.data || null;
  }

  // Agent operations removed - use direct renderer agent APIs

  // Diff operations
  async createDiff(workspaceId: string, diff: DiffChunk): Promise<void> {
    const response = await invoke<CommandResponse<void>>('diffs:create', {
      workspaceId,
      diff,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to create diff');
    }
  }

  async listDiffs(workspaceId: string): Promise<DiffChunk[]> {
    const response = await invoke<DiffChunk[]>('diffs:list', {
      workspaceId,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to list diffs');
    }

    return response.data || [];
  }

  async updateDiff(workspaceId: string, diff: DiffChunk): Promise<void> {
    const response = await invoke<void>('diffs:update', {
      workspaceId,
      diff,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to update diff');
    }
  }

  // Change tracking operations
  async trackAgentChanges(
    workspaceId: string,
    files: any[],
    agentName: string,
    messageId?: string,
    threadId?: string,
    turnNumber?: number,
    sessionId?: string,
    model?: string,
    temperature?: number,
    reasoning?: string,
  ): Promise<DiffChunk> {
    const response = await invoke<DiffChunk>('changes:track-agent', {
      workspaceId,
      files,
      agentName,
      messageId,
      threadId,
      turnNumber,
      sessionId,
      model,
      temperature,
      reasoning,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to track agent changes');
    }

    return response.data!;
  }

  async markAgentActive(
    workspaceId: string,
    agentName: string,
    durationMs?: number,
  ): Promise<boolean> {
    const response = await invoke<boolean>('changes:mark-agent-active', {
      workspaceId,
      agentName,
      durationMs,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to mark agent active');
    }

    return response.data ?? true;
  }

  async getCurrentChanges(workspaceId: string): Promise<DiffChunk | null> {
    const response = await invoke<DiffChunk | null>('changes:get-current', { workspaceId });

    if (!response.success) {
      throw new Error(response.error || 'Failed to get current changes');
    }

    return response.data || null;
  }
}

export const api = new ApiClient();
