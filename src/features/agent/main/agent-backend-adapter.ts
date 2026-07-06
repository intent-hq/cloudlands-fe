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

  // Lifecycle operations
  async activateAgent(request: AgentIpc.ActivateRequest): Promise<AgentIpc.ActivateResponse> {
    logger.debug('Adapter: activateAgent', {
      agentId: request.agentId,
      workspaceId: (request as any).workspaceId,
    });

    const result = await (this.handler as any).handleActivateAgent(null, {
      agentId: request.agentId,
      workspaceId: (request as any).workspaceId, // Pass through the workspaceId if provided
      sessionId: (request as any).sessionId, // Pass through the sessionId if provided
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to activate agent');
    }

    return {
      success: true,
      backendSessionId: result.backendSessionId,
      agent: result.agent, // Pass through the full agent session
    };
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateStreamId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  // Stub implementations for missing interface methods
  async updateSession(): Promise<any> {
    logger.warn('updateSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async exportSession(): Promise<any> {
    logger.warn('exportSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async importSession(): Promise<any> {
    logger.warn('importSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getHistory(): Promise<any> {
    logger.warn('getHistory not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async updateMetadata(): Promise<any> {
    logger.warn('updateMetadata not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async forkSession(): Promise<any> {
    logger.warn('forkSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async mergeSession(): Promise<any> {
    logger.warn('mergeSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getStats(): Promise<any> {
    logger.warn('getStats not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async validateSession(): Promise<any> {
    logger.warn('validateSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async repairSession(): Promise<any> {
    logger.warn('repairSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async clearSession(): Promise<any> {
    logger.warn('clearSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async pauseSession(): Promise<any> {
    logger.warn('pauseSession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getStatus(): Promise<any> {
    logger.warn('getStatus not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async lifecycleStart(request: any): Promise<any> {
    logger.debug('Adapter: lifecycleStart', request);

    const result = await (this.handler as any).handleLifecycleStart(null, request);

    if (!result.success) {
      throw new Error(result.error || 'Failed to start lifecycle');
    }

    return { success: true };
  }

  async lifecycleStop(request: any): Promise<any> {
    logger.debug('Adapter: lifecycleStop', request);

    const result = await (this.handler as any).handleLifecycleStop(null, request);

    if (!result.success) {
      throw new Error(result.error || 'Failed to stop lifecycle');
    }

    return { success: true };
  }

  async messagingSend(request: any): Promise<any> {
    logger.debug('Adapter: messagingSend', request);

    const result = await (this.handler as any).handleMessagingSend(null, request);

    if (!result.success) {
      throw new Error(result.error || 'Failed to send message');
    }

    return { success: true };
  }

  async messagingReceive(request: any): Promise<any> {
    logger.debug('Adapter: messagingReceive', request);

    const result = await (this.handler as any).handleMessagingReceive(null, request);

    if (!result.success) {
      throw new Error(result.error || 'Failed to receive message');
    }

    return { success: true, data: result.data };
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

  async getContext(): Promise<any> {
    logger.warn('getContext not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async updateContext(): Promise<any> {
    logger.warn('updateContext not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getContextByWorkspace(): Promise<any> {
    logger.warn('getContextByWorkspace not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getContextBySession(): Promise<any> {
    logger.warn('getContextBySession not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getCapabilities(): Promise<any> {
    logger.warn('getCapabilities not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async setCapabilities(): Promise<any> {
    logger.warn('setCapabilities not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getMetrics(): Promise<any> {
    logger.warn('getMetrics not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async resetMetrics(): Promise<any> {
    logger.warn('resetMetrics not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async getLogs(): Promise<any> {
    logger.warn('getLogs not implemented');
    return { success: false, error: 'Not implemented' };
  }

  async clearLogs(): Promise<any> {
    logger.warn('clearLogs not implemented');
    return { success: false, error: 'Not implemented' };
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
