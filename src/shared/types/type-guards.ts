/**
 * Type Guards and Type Restoration for IPC Boundaries
 *
 * When branded IDs cross IPC boundaries, they lose their type information
 * and become plain strings. These utilities restore the proper types.
 */

import {
  createAgentId,
  createWorkspaceId,
  createMessageId,
  createToolCallId,
  SessionId as createSessionIdBrand,
  StreamId as createStreamIdBrand,
  type AgentId,
  type WorkspaceId,
  type MessageId,
  type StreamId,
  type SessionId,
  type ToolCallId,
} from './branded-ids';

/**
 * Restore an AgentId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreAgentId(id: string | undefined | null): AgentId | undefined {
  if (!id) return undefined;
  return createAgentId(id);
}

/**
 * Restore a WorkspaceId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreWorkspaceId(id: string | undefined | null): WorkspaceId | undefined {
  if (!id) return undefined;
  return createWorkspaceId(id);
}

/**
 * Restore a MessageId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreMessageId(id: string | undefined | null): MessageId | undefined {
  if (!id) return undefined;
  return createMessageId(id);
}

/**
 * Restore a StreamId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreStreamId(id: string | undefined | null): StreamId | undefined {
  if (!id) return undefined;
  return createStreamIdBrand(id);
}

/**
 * Restore a SessionId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreSessionId(id: string | undefined | null): SessionId | undefined {
  if (!id) return undefined;
  return createSessionIdBrand(id);
}

/**
 * Restore a ToolCallId from a plain string
 * Use this after receiving data from IPC
 */
export function restoreToolCallId(id: string | undefined | null): ToolCallId | undefined {
  if (!id) return undefined;
  return createToolCallId(id);
}

// ContentBlockId is not yet implemented in branded-ids
// Commenting out until it's added
// /**
//  * Restore a ContentBlockId from a plain string
//  * Use this after receiving data from IPC
//  */
// export function restoreContentBlockId(id: string | undefined | null): ContentBlockId | undefined {
//   if (!id) return undefined;
//   return createContentBlockId(id);
// }

/**
 * Type guard to check if a value is a valid AgentId
 */
export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && value.startsWith('agent_');
}

/**
 * Type guard to check if a value is a valid WorkspaceId
 */
export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && value.startsWith('workspace_');
}

/**
 * Type guard to check if a value is a valid MessageId
 */
export function isMessageId(value: unknown): value is MessageId {
  return typeof value === 'string' && value.startsWith('msg_');
}

/**
 * Type guard to check if a value is a valid StreamId
 */
export function isStreamId(value: unknown): value is StreamId {
  return typeof value === 'string' && value.startsWith('stream_');
}

/**
 * Type guard to check if a value is a valid SessionId
 */
export function isSessionId(value: unknown): value is SessionId {
  return typeof value === 'string' && value.startsWith('session_');
}

/**
 * Type guard to check if a value is a valid ToolCallId
 */
export function isToolCallId(value: unknown): value is ToolCallId {
  return typeof value === 'string' && value.startsWith('tool_');
}

// ContentBlockId is not yet implemented in branded-ids
// /**
//  * Type guard to check if a value is a valid ContentBlockId
//  */
// export function isContentBlockId(value: unknown): value is ContentBlockId {
//   return typeof value === 'string' && value.startsWith('block_');
// }

/**
 * Restore all branded IDs in an object
 * Useful for restoring types after IPC for complex objects
 */
export function restoreBrandedIds<T extends Record<string, any>>(obj: T): T {
  const restored = { ...obj };

  // Restore common ID fields
  if ('id' in restored && typeof restored.id === 'string') {
    const id = restored.id;
    if (isAgentId(id)) (restored as any).id = restoreAgentId(id);
    else if (isMessageId(id)) (restored as any).id = restoreMessageId(id);
    else if (isStreamId(id)) (restored as any).id = restoreStreamId(id);
  }

  if ('agentId' in restored && typeof restored.agentId === 'string') {
    (restored as any).agentId = restoreAgentId(restored.agentId);
  }

  if ('workspaceId' in restored && typeof restored.workspaceId === 'string') {
    (restored as any).workspaceId = restoreWorkspaceId(restored.workspaceId);
  }

  if ('sessionId' in restored && typeof restored.sessionId === 'string') {
    (restored as any).sessionId = restoreSessionId(restored.sessionId);
  }

  return restored;
}
