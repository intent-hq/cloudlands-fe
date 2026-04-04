import * as fs from 'fs/promises';

import type { ProtocolAdapter } from '$features/protocol/main/protocol-adapter';
import { Logger } from '$shared/logger';
import { getSessionPath } from '$shared/constants';
import { WorkspaceConfig } from '$shared/main/config';
import { sanitizeBranchName } from '$lib/utils/workspace-validation';
import { gitService } from '$features/git/main/git.service';
import type { WorkspaceId } from '$shared/types';

import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { createWorkspaceEvent } from '../../../events/types';
import { emitWorkspaceEvent } from '../../../../store/main/slices/workspace-events/workspace-events-slice';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import { AVAILABLE_TOPICS, REFERENCE_DOCS } from './reference-docs';
import type { ToolCall } from './protocol';

const logger = new Logger('WsWorkspaceApi');

interface BuildWorkspaceApiParams {
  workspacePath: string;
  workspaceId: string;
  workspaceManager?: Pick<ProtocolAdapter, 'getWorkspace' | 'getCurrentContext' | 'updateWorkspace'>;
  call: ToolCall;
}

function requireWorkspaceManager(
  workspaceManager?: Pick<ProtocolAdapter, 'getWorkspace' | 'getCurrentContext' | 'updateWorkspace'>,
) {
  if (!workspaceManager) {
    throw new Error('Workspace manager not available');
  }

  return workspaceManager;
}

export function buildWorkspaceApi({
  workspacePath,
  workspaceId,
  workspaceManager,
  call,
}: BuildWorkspaceApiParams) {
  return {
    async info() {
      logger.info('ws.workspace.info', { workspaceId });
      return { id: workspaceId, path: workspacePath };
    },

    async details() {
      logger.info('ws.workspace.details', { workspaceId });
      const manager = requireWorkspaceManager(workspaceManager);
      const workspace = await manager.getWorkspace(workspaceId);

      if (!workspace) {
        return {
          id: workspaceId,
          title: '(untitled)',
          hasTitle: false,
          status: 'active',
          branch: null,
          repositoryName: null,
          tags: [],
        };
      }

      return {
        id: workspace.id,
        title: workspace.title || '(untitled)',
        hasTitle: !!workspace.title,
        status: workspace.status,
        branch: workspace.branch,
        repositoryName: workspace.repositoryName,
        tags: workspace.tags || [],
      };
    },

    async setTitle(title: string) {
      logger.info('ws.workspace.setTitle', { workspaceId, title });

      if (!title || typeof title !== 'string') {
        throw new Error('title is required');
      }

      const manager = requireWorkspaceManager(workspaceManager);
      const workspace = await manager.getWorkspace(workspaceId);

      if (workspace?.title) {
        const currentTitle = workspace.title.trim();
        if (currentTitle !== '' && currentTitle !== workspace.id) {
          return { ok: true, skipped: true, title: currentTitle, branch: workspace.branch };
        }
      }

      const trimmedTitle = title.trim();
      const newBranch = sanitizeBranchName(trimmedTitle);
      let finalBranch = workspace?.branch || newBranch;

      if (workspace?.repositoryPath && workspace.branch && workspace.branch !== newBranch) {
        try {
          const result = await gitService.renameBranch(
            workspaceId as WorkspaceId,
            workspace.branch,
            newBranch,
          );

          if (result.ok || result.error?.includes('does not exist')) {
            finalBranch = newBranch;
          }
        } catch {
          // Keep the existing branch name if rename fails.
        }
      } else if (!workspace?.branch) {
        finalBranch = newBranch;
      }

      const updated = await manager.updateWorkspace({
        id: workspaceId,
        title: trimmedTitle,
        branch: finalBranch,
      });

      if (!updated.ok) {
        throw new Error(`Failed to update workspace: ${updated.error}`);
      }

      return { ok: true, title: trimmedTitle, branch: finalBranch };
    },

    async setAgentName(name: string) {
      logger.info('ws.workspace.setAgentName', { workspaceId, name });

      if (!name || typeof name !== 'string') {
        throw new Error('name is required');
      }

      const agentId = call.context?.agentId;
      if (!agentId) {
        throw new Error('Could not determine agent ID from request context');
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('name must not be empty or whitespace-only');
      }
      const resolvedBase = WorkspaceConfig.resolveWorkspaceRoot(workspaceId);
      const sessionPath = getSessionPath(workspaceId, agentId, resolvedBase);
      const raw = await fs.readFile(sessionPath, 'utf-8');
      const data = JSON.parse(raw);

      // If the name was already explicitly set (e.g., by a prior user rename or
      // agent tool call), skip the rename to avoid overwriting it.
      const existingData = data.version && data.data ? data.data : data;
      if (existingData.nameExplicitlySet) {
        logger.info('ws.workspace.setAgentName: skipping — name already explicitly set', {
          agentId,
          existingName: existingData.name,
          requestedName: trimmedName,
        });

        // Sync the in-memory backend session with the disk name so
        // backend.getSession() doesn't return a stale pre-rename name.
        try {
          const { ConsolidatedBackendService } = await import(
            '$features/agent/main/consolidated-backend.service'
          );
          const backend = ConsolidatedBackendService.getInstance();
          const session = backend.getSession(agentId);
          if (session) {
            session.name = existingData.name;
            (session as any).nameExplicitlySet = true;
          }
        } catch {
          // Best-effort — disk is the source of truth
        }

        return { ok: true, name: existingData.name, skipped: true };
      }

      if (data.version && data.data) {
        data.data.name = trimmedName;
        data.data.nameExplicitlySet = true;
      } else {
        data.name = trimmedName;
        data.nameExplicitlySet = true;
      }

      await fs.writeFile(sessionPath, JSON.stringify(data, null, 2), 'utf-8');

      // Invalidate persistence cache so loadAgent returns fresh data
      try {
        const { UnifiedPersistence } = await import(
          '$features/agent/main/agent-persistence'
        );
        const workspaceIdStr = workspaceId as string;
        UnifiedPersistence.getInstance().invalidateLoadCache(
          agentId as unknown as import('$shared/types/branded-ids').AgentId,
          workspaceIdStr as unknown as import('$shared/types/branded-ids').WorkspaceId
        );
      } catch (e) {
        // Cache invalidation is best-effort
        logger.warn('Failed to invalidate persistence load cache after rename', { agentId, error: e });
      }

      // Also update the in-memory session in the backend service
      try {
        const { ConsolidatedBackendService } = await import(
          '$features/agent/main/consolidated-backend.service'
        );
        const backend = ConsolidatedBackendService.getInstance();
        const session = backend.getSession(agentId);
        if (session) {
          session.name = trimmedName;
          (session as any).nameExplicitlySet = true;
        }
      } catch (e) {
        // Backend service may not be available; disk write is the primary store
        logger.warn('Failed to update in-memory session for agent name', { agentId, error: e });
      }

      sendToWorkspaceWindows(workspaceId, 'agent:renamed', {
        agentId,
        workspaceId,
        name: trimmedName,
      });

      return { ok: true, name: trimmedName };
    },

    async context() {
      logger.info('ws.workspace.context', { workspaceId });
      const manager = requireWorkspaceManager(workspaceManager);
      const context = await manager.getCurrentContext(workspaceId);
      return context || { mainContentType: 'empty' };
    },

    async timeline(limit?: number, type?: string) {
      logger.info('ws.workspace.timeline', { workspaceId, limit, type });
      const manager = requireWorkspaceManager(workspaceManager);
      const workspace = await manager.getWorkspace(workspaceId);

      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`);
      }

      let entries = workspace.timeline || [];
      if (type) {
        entries = entries.filter((entry: any) => entry.type === type);
      }

      return entries.slice(-(limit ?? 50)).map((entry: any) => ({
        timestamp: entry.timestamp,
        type: entry.type,
        description: entry.description || entry.message,
      }));
    },

    async referenceDocs(topic: string) {
      logger.info('ws.workspace.referenceDocs', { workspaceId, topic });

      if (!topic) {
        throw new Error(`Topic is required. Available: ${AVAILABLE_TOPICS.join(', ')}`);
      }

      const docs = REFERENCE_DOCS[topic.toLowerCase()];
      if (!docs) {
        throw new Error(`Unknown topic: \"${topic}\". Available: ${AVAILABLE_TOPICS.join(', ')}`);
      }

      return docs;
    },

    async emitNotification(topic: string, message: string, metadata?: Record<string, any>) {
      logger.info('ws.workspace.emitNotification', { workspaceId, topic });

      if (!topic || !message) {
        throw new Error('Both topic and message are required');
      }

      const event = createWorkspaceEvent(
        'mcp:notification',
        workspaceId,
        { type: 'external', name: 'notification-daemon' },
        { topic, message, ...(metadata !== undefined && { metadata }) },
      );

      mainDispatch(emitWorkspaceEvent(event));
      return { ok: true, eventId: event.id };
    },
  };
}