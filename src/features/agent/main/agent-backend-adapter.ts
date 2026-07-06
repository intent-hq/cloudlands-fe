/**
 * Agent Backend Adapter
 *
 * Adapts the existing AgentBackendHandler to the new IAgentBackendService interface.
 * Enables gradual migration to unified handlers while maintaining backward compatibility.
 *
 * This adapter provides a complete implementation of all agent operations,
 * bridging the old handler methods to the new unified interface.
 */

import type { IAgentBackendService } from './unified-agent-handlers';
import type { AgentIpc } from '$shared/ipc/contracts';
import { AgentBackendHandler } from './agent-backend-handler.service';
import { Logger } from '$shared/logger';
import * as BrandedIds from '$shared/types/branded-ids';
import { WorkspaceConfig } from '$shared/main/config.js';
import { IN_FLIGHT_PROMPT_DROPPED_ERROR } from '$shared/constants/agent-streaming';

const logger = new Logger('AgentBackendAdapter');

function isInFlightPromptDedupResult(result: any): boolean {
  return (
    result?.success === false &&
    typeof result.error === 'string' &&
    result.error.includes(IN_FLIGHT_PROMPT_DROPPED_ERROR)
  );
}

/**
 * Adapter that implements IAgentBackendService using existing AgentBackendHandler
 */
class AgentBackendAdapter implements IAgentBackendService {
  private handler: AgentBackendHandler;

  constructor() {
    this.handler = AgentBackendHandler.getInstance();
  }

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

    // Validate workspace ID
    if (!request.workspaceId || typeof request.workspaceId !== 'string') {
      throw new Error('Invalid workspace ID');
    }

    // Call existing handler method
    const result = await (this.handler as any).handleCreateAgent(null, {
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath,
      name: request.name,
      agentId: request.agentId, // Pass the frontend-generated agent ID if provided
      model: request.model,
      provider: request.provider, // Pass provider so backend uses the correct ACP provider
      agentType: request.agentType, // Pass agentType so backend can build system prompt
      behaviorPrompt: request.behaviorPrompt, // Pass custom behavior instructions from specialist
      systemPrompt: request.systemPrompt,
      initialMessage: request.initialMessage,
      skipInitialPrompt: request.skipInitialPrompt,
      contextReferences: request.contextReferences,
      imageBlocks: request.imageBlocks,
      metadata: request.metadata,
      workspaceContext: request.workspaceContext,
    });

    if (!result.success || !result.agent) {
      throw new Error(result.error || 'Failed to create agent');
    }

    return {
      agent: result.agent,
      sessionId: (result.agent as any).backendSessionId,
    };
  }

  async getAgent(request: AgentIpc.GetRequest): Promise<AgentIpc.GetResponse> {
    logger.debug('Adapter: getAgent', { agentId: request.agentId });

    // Call existing handler method
    const result = await (this.handler as any).handleGetAgent(null, {
      agentId: request.agentId,
      workspaceId: request.workspaceId,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to get agent');
    }

    return {
      agent: result.agent || null,
    };
  }

  async sendMessage(request: AgentIpc.SendMessageRequest): Promise<AgentIpc.SendMessageResponse> {
    logger.debug('Adapter: sendMessage', { agentId: request.agentId });

    // Generate IDs for the message
    const messageId = this.generateMessageId();
    const streamId = this.generateStreamId();

    // Call existing handler method
    const result = await (this.handler as any).handleSendMessage(null, {
      agentId: request.agentId,
      content: request.content,
      contextReferences: request.contextReferences,
      metadata: request.metadata,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to send message');
    }

    // NOTE: The adapter intentionally does NOT emit `agent:user-message:sent` itself —
    // `handleSendMessage` (the canonical site) is responsible for both the workspace
    // event dispatch and the cross-client renderer IPC broadcast. See Audit 4 /
    // Track F Bundle 3 (single-emit invariant).

    return {
      messageId: BrandedIds.MessageId(messageId),
      streamId: BrandedIds.AgentId(streamId),
    };
  }

  async listAgents(request: AgentIpc.ListRequest): Promise<AgentIpc.ListResponse> {
    logger.debug('Adapter: listAgents', { workspaceId: request.workspaceId });

    // Call existing handler method
    const result = await (this.handler as any).handleListAgents(null, {
      workspaceId: request.workspaceId,
      includeDeleted: request.includeDeleted,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to list agents');
    }

    return {
      agents: result.agents || [],
    };
  }

  async deleteAgent(request: AgentIpc.DeleteRequest): Promise<AgentIpc.DeleteResponse> {
    logger.debug('Adapter: deleteAgent', { agentId: request.agentId });

    const result = await (this.handler as any).handleDeleteAgent(null, {
      agentId: request.agentId,
      workspaceId: request.workspaceId,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete agent');
    }

    return { success: true };
  }

  async stopSession(request: AgentIpc.StopRequest): Promise<AgentIpc.StopResponse> {
    logger.debug('Adapter: stopSession', { agentId: request.agentId });

    const result = await (this.handler as any).handleStopSession(null, {
      agentId: request.agentId,
      _stopTrigger: 'user_action',
      _stopReason: 'adapter_stopSession',
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to stop session');
    }

    return { success: true };
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateStreamId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async setModel(request: {
    agentId: string;
    modelId: string;
    workspaceId: string;
  }): Promise<{ success: boolean; modelId?: string; error?: string }> {
    logger.debug('Adapter: setModel', request);

    const result = await this.handler.handleSetModel(null, request);
    return result;
  }

  // Backend channel methods (for streaming)
  async streamMessage(request: any): Promise<any> {
    logger.debug('Adapter: streamMessage', { agentId: request.agentId });

    // Call the existing backend stream message handler
    const result = await (this.handler as any).handleBackendStreamMessage(null, request);

    if (!result.success) {
      if (isInFlightPromptDedupResult(result)) {
        return result;
      }
      throw new Error(result.error || 'Failed to stream message');
    }

    return result;
  }

  async backendStop(request: any): Promise<any> {
    logger.debug('Adapter: backendStop', { agentId: request.agentId });

    // Call the existing stop session handler
    // Preserve any _stopTrigger from the request, default to user_action (renderer IPC)
    const result = await (this.handler as any).handleStopSession(null, {
      ...request,
      _stopTrigger: request._stopTrigger || 'user_action',
      _stopReason: request._stopReason || 'adapter_backendStop',
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to stop session');
    }

    return result;
  }

  // Message queue operations
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
    return await (this.handler as any).handleQueueMessage(null, request);
  }

  async editQueuedMessage(request: {
    agentId: string;
    messageId: string;
    content: string;
  }): Promise<{ success: boolean; error?: string }> {
    logger.debug('Adapter: editQueuedMessage', {
      agentId: request.agentId,
      messageId: request.messageId,
    });
    return await (this.handler as any).handleEditQueuedMessage(null, request);
  }

  async removeQueuedMessage(request: {
    agentId: string;
    messageId: string;
  }): Promise<{ success: boolean; error?: string }> {
    logger.debug('Adapter: removeQueuedMessage', {
      agentId: request.agentId,
      messageId: request.messageId,
    });
    return await (this.handler as any).handleRemoveQueuedMessage(null, request);
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
    // Stop the current stream, then send the new message
    await this.handler.stopAgent(request.agentId, 'force_message');
    return await this.handler.sendMessage(null as any, {
      sessionId: request.agentId,
      message: request.content,
      workspaceId: request.workspaceId,
      imageBlocks: request.imageBlocks,
      noteIds: request.noteIds,
      queuedMessageId: request.messageId,
    });
  }

  async getQueue(request: {
    agentId: string;
  }): Promise<{ success: boolean; queue?: any[]; error?: string }> {
    logger.debug('Adapter: getQueue', { agentId: request.agentId });
    return await (this.handler as any).handleGetQueue(null, request);
  }
}

/**
 * Return the singleton adapter instance
 */
export function getAgentBackendAdapter(): IAgentBackendService {
  return agentBackendAdapter;
}

// AgentBackendAdapter is already exported at the class declaration

/**
 * Export a singleton instance
 */
const agentBackendAdapter = new AgentBackendAdapter();
