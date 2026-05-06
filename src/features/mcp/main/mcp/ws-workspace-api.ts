import type { ProtocolAdapter } from '$features/protocol/main/protocol-adapter';
import { Logger } from '$shared/logger';
import { sanitizeBranchName } from '$lib/utils/workspace-validation';
import { gitService } from '$features/git/main/git.service';
import { renameAgentOnDisk } from '$features/agent/main/agent-rename';
import { WORKSPACE_STATUS_MESSAGE_MAX_LENGTH, type WorkspaceId } from '$shared/types';

import { createWorkspaceEvent } from '../../../events/types';
import { emitWorkspaceEvent } from '../../../../store/main/slices/workspace-events/workspace-events-slice';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import { AVAILABLE_TOPICS, REFERENCE_DOCS } from './reference-docs';
import type { ToolCall } from './protocol';

const logger = new Logger('WsWorkspaceApi');

interface BuildWorkspaceApiParams {
  workspacePath: string;
  workspaceId: string;
  workspaceManager?: Pick<
    ProtocolAdapter,
    'getWorkspace' | 'getCurrentContext' | 'updateWorkspace'
  >;
  call: ToolCall;
}

function requireWorkspaceManager(
  workspaceManager?: Pick<
    ProtocolAdapter,
    'getWorkspace' | 'getCurrentContext' | 'updateWorkspace'
  >,
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
          statusMessage: null,
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
        statusMessage: workspace.statusMessage ?? null,
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

    async setStatusMessage(statusMessage: string | null) {
      logger.info('ws.workspace.setStatusMessage', { workspaceId });

      if (statusMessage !== null && typeof statusMessage !== 'string') {
        throw new Error('statusMessage must be a string or null');
      }

      const trimmedStatusMessage = statusMessage?.trim() || undefined;
      if (
        trimmedStatusMessage &&
        trimmedStatusMessage.length > WORKSPACE_STATUS_MESSAGE_MAX_LENGTH
      ) {
        throw new Error(
          `statusMessage must be ${WORKSPACE_STATUS_MESSAGE_MAX_LENGTH} characters or fewer`,
        );
      }

      const manager = requireWorkspaceManager(workspaceManager);
      const updated = await manager.updateWorkspace({
        id: workspaceId,
        statusMessage: trimmedStatusMessage,
      });

      if (!updated.ok) {
        throw new Error(`Failed to update workspace status message: ${updated.error}`);
      }

      return { ok: true, statusMessage: trimmedStatusMessage ?? null };
    },

    async setAgentName(name: string) {
      logger.info('ws.workspace.setAgentName', { workspaceId, name });

      const agentId = call.context?.agentId;
      if (!agentId) {
        throw new Error('Could not determine agent ID from request context');
      }

      return renameAgentOnDisk({
        workspaceId,
        agentId,
        name,
        skipIfExplicitlySet: true,
      });
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
