/**
 * Browser-safe proxy for consolidated-backend.service.
 * The actual implementation is in main/ and uses Node.js APIs.
 * This file provides a browser-compatible interface that uses IPC.
 */
import { invoke } from '$lib/electron-bridge';
import { AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';
import type { QueuedMessage } from '$shared/types/agent-session';
import type { AgentSession } from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ConsolidatedBackendProxy');

/** Response type for queue operations */
export interface QueueOperationResult {
  success: boolean;
  error?: string;
  queue?: QueuedMessage[];
  queuedMessage?: QueuedMessage;
}

/**
 * Browser-safe proxy for the unified orchestrator.
 * Methods are forwarded to the main process via IPC.
 */
/** Helper to unwrap IPC response that wraps data in { success, data } */
function unwrapIpcResponse<T>(result: {
  success: boolean;
  data?: T;
  error?: { message?: string };
}): T | { success: false; error: string } {
  logger.debug('[unwrapIpcResponse] Input', { result });
  if (result?.success && result?.data) {
    logger.debug('[unwrapIpcResponse] Returning data', { data: result.data });
    return result.data;
  }
  logger.debug('[unwrapIpcResponse] Returning error', {
    success: result?.success,
    hasData: result?.data !== undefined,
  });
  return { success: false, error: result?.error?.message || 'IPC call failed' };
}

export const unifiedOrchestrator = {
  async queueMessage(
    agentId: string,
    content: string,
    context?: unknown[],
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>,
    workspaceId?: string,
  ): Promise<QueueOperationResult> {
    const result = (await invoke(AGENT_BACKEND_CHANNELS.QUEUE_MESSAGE, {
      agentId,
      content,
      contextItems: context,
      imageBlocks,
      workspaceId,
    })) as { success: boolean; data?: QueueOperationResult; error?: { message?: string } };
    return unwrapIpcResponse(result) as QueueOperationResult;
  },

  async editQueuedMessage(
    agentId: string,
    messageId: string,
    content: string,
  ): Promise<QueueOperationResult> {
    const result = (await invoke(AGENT_BACKEND_CHANNELS.EDIT_QUEUED, {
      agentId,
      messageId,
      content,
    })) as { success: boolean; data?: QueueOperationResult; error?: { message?: string } };
    return unwrapIpcResponse(result) as QueueOperationResult;
  },

  async removeQueuedMessage(agentId: string, messageId: string): Promise<QueueOperationResult> {
    const result = (await invoke(AGENT_BACKEND_CHANNELS.REMOVE_QUEUED, {
      agentId,
      messageId,
    })) as { success: boolean; data?: QueueOperationResult; error?: { message?: string } };
    return unwrapIpcResponse(result) as QueueOperationResult;
  },

  async getQueue(agentId: string): Promise<QueueOperationResult> {
    const rawResult = await invoke(AGENT_BACKEND_CHANNELS.GET_QUEUE, { agentId });
    logger.debug('[getQueue] Raw IPC result', { rawResult });

    const result = rawResult as {
      success: boolean;
      data?: QueueOperationResult;
      error?: { message?: string };
    };

    // Check if response is wrapped (has data property) or unwrapped
    // The backend wraps responses with formatIpcSuccess, but we need to handle both cases
    if ('data' in result && result.data !== undefined) {
      // Wrapped response: { success: true, data: { success: true, queue: [] } }
      logger.debug('[getQueue] Unwrapping data property', { data: result.data });
      return result.data;
    } else if ('queue' in (result as any)) {
      // Unwrapped response: { success: true, queue: [] }
      logger.debug('[getQueue] Response already unwrapped', { result });
      return result as unknown as QueueOperationResult;
    } else {
      // Error case
      logger.debug('[getQueue] No data or queue property, returning error');
      return { success: false, error: result?.error?.message || 'IPC call failed' };
    }
  },

  async listAgents(workspaceId: string): Promise<AgentSession[]> {
    return invoke(AGENT_BACKEND_CHANNELS.LIST, { workspaceId }) as Promise<AgentSession[]>;
  },
};

// Alias for backward compatibility
export const unifiedAgentBackend = unifiedOrchestrator;
