import { isContentBlock, type ContentBlock } from '$shared/types';
import type { BackendRuntime } from './backend-transport-runtime';

/** Canonical full-block read; a missing or malformed envelope is an error. */
export function createMessageBlockReader({
  backendRequest,
}: Pick<BackendRuntime, 'backendRequest'>) {
  return async (
    agentId: string,
    messageId: string,
    blockId: string,
    workspaceId?: string,
  ): Promise<ContentBlock> => {
    const result = await backendRequest<{ block?: unknown }>('agent.getMessageBlock', {
      agentId,
      messageId,
      blockId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    });
    if (!isContentBlock(result?.block)) {
      throw new Error(
        `agent.getMessageBlock returned no block for message ${messageId} block ${blockId}`,
      );
    }
    return result.block;
  };
}
