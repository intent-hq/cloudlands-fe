/**
 * Agent Backend Adapter
 *
 * Thin `IAgentBackendService` binding over the intentd JSON-RPC daemon. Each
 * method forwards to the canonical `agent.*` RPC (PROTOCOL.md §5.5) via
 * `getBackendClient().request(...)` and shapes the response to the
 * `unified-agent-handlers` contract; the IPC handler layer then wraps with
 * `formatIpcSuccess`.
 *
 * Replaces the retired `AgentBackendHandler` seam — no local session or
 * provider state is held here.
 */

import type { IAgentBackendService } from './unified-agent-handlers';
import type { AgentIpc } from '$shared/ipc/contracts';
import type { AgentSession } from '$shared/types';
import { Logger } from '$shared/logger';
import * as BrandedIds from '$shared/types/branded-ids';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('AgentBackendAdapter');

/** Daemon `agent.sendMessage` response envelope (PROTOCOL.md §5.5). */
interface DaemonSendMessageResult {
  success?: boolean;
  queued?: boolean;
  messageId?: string;
  error?: string;
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

class AgentBackendAdapter implements IAgentBackendService {
  async createAgent(request: AgentIpc.CreateRequest): Promise<AgentIpc.CreateResponse> {
    logger.info('Adapter: createAgent', {
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      hasAgentId: !!request.agentId,
      agentType: request.agentType,
      hasBehaviorPrompt: !!request.behaviorPrompt,
      behaviorPromptLength: request.behaviorPrompt?.length || 0,
      hasSystemPrompt: !!request.systemPrompt,
    });

    if (!request.workspaceId || typeof request.workspaceId !== 'string') {
      throw new Error('Invalid workspace ID');
    }

    // PROTOCOL.md §5.5 `agent.create` — daemon adopts the FE-supplied agentId
    // verbatim and persists the session; forward the full field set so any
    // widening of the daemon router lands transparently.
    const result = (await getBackendClient().request('agent.create', {
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath,
      name: request.name,
      agentId: request.agentId,
      model: request.model,
      provider: request.provider,
      agentType: request.agentType,
      behaviorPrompt: request.behaviorPrompt,
      systemPrompt: request.systemPrompt,
      initialMessage: request.initialMessage,
      skipInitialPrompt: request.skipInitialPrompt,
      contextReferences: request.contextReferences,
      imageBlocks: request.imageBlocks,
      metadata: request.metadata,
      workspaceContext: request.workspaceContext,
    })) as { agent?: AgentSession };

    const agent = result?.agent;
    if (!agent) {
      throw new Error('Failed to create agent');
    }

    return {
      agent,
      sessionId: ((agent as any).backendSessionId ??
        agent.id) as AgentIpc.CreateResponse['sessionId'],
    };
  }

  async getAgent(request: AgentIpc.GetRequest): Promise<AgentIpc.GetResponse> {
    logger.debug('Adapter: getAgent', { agentId: request.agentId });

    const result = (await getBackendClient().request('agent.get', {
      agentId: request.agentId,
      workspaceId: request.workspaceId,
    })) as { agent?: AgentSession | null };

    return { agent: result?.agent ?? null };
  }

  async sendMessage(request: AgentIpc.SendMessageRequest): Promise<AgentIpc.SendMessageResponse> {
    logger.debug('Adapter: sendMessage', { agentId: request.agentId });

    const result = (await getBackendClient().request('agent.sendMessage', {
      agentId: request.agentId,
      content: request.content,
      contextReferences: request.contextReferences,
      metadata: request.metadata,
    })) as DaemonSendMessageResult;

    if (result?.success === false) {
      throw new Error(result.error || 'Failed to send message');
    }

    return {
      messageId: BrandedIds.MessageId(result?.messageId ?? generateMessageId()),
      streamId: request.agentId,
    };
  }

  async listAgents(request: AgentIpc.ListRequest): Promise<AgentIpc.ListResponse> {
    logger.debug('Adapter: listAgents', { workspaceId: request.workspaceId });

    const result = (await getBackendClient().request('agent.list', {
      workspaceId: request.workspaceId,
      includeDeleted: request.includeDeleted,
    })) as { agents?: AgentSession[] };

    return { agents: result?.agents || [] };
  }

  async deleteAgent(request: AgentIpc.DeleteRequest): Promise<AgentIpc.DeleteResponse> {
    logger.debug('Adapter: deleteAgent', { agentId: request.agentId });

    await getBackendClient().request('agent.delete', {
      agentId: request.agentId,
      workspaceId: request.workspaceId,
    });

    return { success: true };
  }

  async stopSession(request: AgentIpc.StopRequest): Promise<AgentIpc.StopResponse> {
    logger.debug('Adapter: stopSession', { agentId: request.agentId });

    await getBackendClient().request('agent.stop', { agentId: request.agentId });
    return { success: true };
  }

  async setModel(request: {
    agentId: string;
    modelId: string;
    workspaceId: string;
  }): Promise<{ success: boolean; modelId?: string; error?: string }> {
    logger.debug('Adapter: setModel', request);

    try {
      const result = (await getBackendClient().request('agent.setModel', {
        agentId: request.agentId,
        modelId: request.modelId,
        workspaceId: request.workspaceId,
      })) as { success?: boolean; modelId?: string; error?: string };

      return {
        success: result?.success !== false,
        modelId: result?.modelId ?? request.modelId,
        error: result?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Backend channel methods (AGENT_BACKEND_CHANNELS.STREAM_MESSAGE / STOP)
  async streamMessage(request: any): Promise<any> {
    logger.debug('Adapter: streamMessage', { agentId: request?.agentId });

    // PROTOCOL.md §5.5 `agent.sendMessage` — auto-queues when the target is
    // mid-turn, returning `{ success, queued, messageId? }`. Forward the full
    // extended field set the daemon router accepts (matches the browser-side
    // `agent-ipc-bridge-seeder.ts` STREAM_MESSAGE bridge).
    const params: Record<string, unknown> = {
      agentId: request?.agentId,
      workspaceId: request?.workspaceId,
      content: request?.content,
    };
    if (typeof request?.messageId === 'string') params.messageId = request.messageId;
    if (Array.isArray(request?.imageBlocks)) params.imageBlocks = request.imageBlocks;
    if (Array.isArray(request?.fileBlocks)) params.fileBlocks = request.fileBlocks;
    if (typeof request?.model === 'string') params.model = request.model;
    if (request?.messageMetadata && typeof request.messageMetadata === 'object') {
      params.messageMetadata = request.messageMetadata;
    }
    if (Array.isArray(request?.contextReferences)) {
      params.contextReferences = request.contextReferences;
    }
    if (Array.isArray(request?.noteIds)) params.noteIds = request.noteIds;
    if (typeof request?.stdinContext === 'string') params.stdinContext = request.stdinContext;
    if (typeof request?.assistantMessageId === 'string') {
      params.assistantMessageId = request.assistantMessageId;
    }
    if (typeof request?.assistantAppMessageId === 'string') {
      params.assistantAppMessageId = request.assistantAppMessageId;
    }
    if (typeof request?.userAppMessageId === 'string') {
      params.userAppMessageId = request.userAppMessageId;
    }

    const result = (await getBackendClient().request(
      'agent.sendMessage',
      params,
    )) as DaemonSendMessageResult;

    if (result?.success === false) {
      throw new Error(result.error || 'Failed to stream message');
    }
    return result;
  }

  async backendStop(request: any): Promise<any> {
    logger.debug('Adapter: backendStop', { agentId: request?.agentId });

    await getBackendClient().request('agent.stop', { agentId: request?.agentId });
    return { success: true };
  }

  // Message queue operations (PROTOCOL.md §5.5 `agent.queueMessage` /
  // `agent.editQueuedMessage` / `agent.removeQueuedMessage` /
  // `agent.forceMessage` / `agent.getQueue`).
  async queueMessage(request: {
    agentId: string;
    content: string;
    workspaceId?: string;
    contextItems?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  }): Promise<{ success: boolean; queuedMessage?: any; error?: string }> {
    logger.debug('Adapter: queueMessage', {
      agentId: request.agentId,
      workspaceId: request.workspaceId,
      hasImages: !!request.imageBlocks?.length,
    });
    const params: Record<string, unknown> = {
      agentId: request.agentId,
      content: request.content,
    };
    if (Array.isArray(request.imageBlocks)) params.imageBlocks = request.imageBlocks;
    try {
      const result = (await getBackendClient().request('agent.queueMessage', params)) as {
        success?: boolean;
        queuedMessage?: any;
        error?: string;
      };
      return {
        success: result?.success !== false,
        queuedMessage: result?.queuedMessage,
        error: result?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async editQueuedMessage(request: {
    agentId: string;
    messageId: string;
    content: string;
    editing?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    logger.debug('Adapter: editQueuedMessage', {
      agentId: request.agentId,
      messageId: request.messageId,
      editing: request.editing,
    });
    try {
      const params: Record<string, unknown> = {
        agentId: request.agentId,
        messageId: request.messageId,
        content: request.content,
      };
      // STAB-27: Forward optional editing flag to daemon for hold/release
      if (request.editing !== undefined) {
        params.editing = request.editing;
      }
      const result = (await getBackendClient().request('agent.editQueuedMessage', params)) as {
        success?: boolean;
        error?: string
      };
      return { success: result?.success !== false, error: result?.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async removeQueuedMessage(request: {
    agentId: string;
    messageId: string;
  }): Promise<{ success: boolean; error?: string }> {
    logger.debug('Adapter: removeQueuedMessage', {
      agentId: request.agentId,
      messageId: request.messageId,
    });
    try {
      const result = (await getBackendClient().request('agent.removeQueuedMessage', {
        agentId: request.agentId,
        messageId: request.messageId,
      })) as { success?: boolean; error?: string };
      return { success: result?.success !== false, error: result?.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async forceMessage(request: {
    agentId: string;
    messageId: string;
    content: string;
    workspaceId: string;
    imageBlocks?: any[];
    noteIds?: string[];
  }): Promise<{ success: boolean; error?: string }> {
    logger.debug('Adapter: forceMessage', {
      agentId: request.agentId,
      messageId: request.messageId,
    });
    const params: Record<string, unknown> = {
      agentId: request.agentId,
      messageId: request.messageId,
      content: request.content,
      workspaceId: request.workspaceId,
    };
    if (Array.isArray(request.imageBlocks)) params.imageBlocks = request.imageBlocks;
    if (Array.isArray(request.noteIds)) params.noteIds = request.noteIds;
    try {
      const result = (await getBackendClient().request('agent.forceMessage', params)) as {
        success?: boolean;
        error?: string;
      };
      return { success: result?.success !== false, error: result?.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getQueue(request: {
    agentId: string;
  }): Promise<{ success: boolean; queue?: any[]; error?: string }> {
    logger.debug('Adapter: getQueue', { agentId: request.agentId });
    try {
      const result = (await getBackendClient().request('agent.getQueue', {
        agentId: request.agentId,
      })) as { success?: boolean; queue?: any[]; error?: string };
      return {
        success: result?.success !== false,
        queue: result?.queue,
        error: result?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Return the singleton adapter instance
 */
export function getAgentBackendAdapter(): IAgentBackendService {
  return agentBackendAdapter;
}

const agentBackendAdapter = new AgentBackendAdapter();
