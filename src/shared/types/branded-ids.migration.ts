/**
 * Branded IDs Migration Helpers
 *
 * Utilities for migrating existing string IDs to branded IDs.
 * Handles common ID field names and nested structures.
 */

import * as BrandedIds from './branded-ids';

/**
 * Migrate a single object to use branded IDs
 * Handles common ID field names
 */
export function migrateToBrandedIds(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const migrated = { ...data };

  // Migrate id field (usually AgentId)
  if (migrated.id && typeof migrated.id === 'string') {
    if (BrandedIds.isValidAgentId(migrated.id)) {
      migrated.id = BrandedIds.AgentId(migrated.id);
    }
  }

  // Migrate agentId field
  if (migrated.agentId && typeof migrated.agentId === 'string') {
    if (BrandedIds.isValidAgentId(migrated.agentId)) {
      migrated.agentId = BrandedIds.AgentId(migrated.agentId);
    }
  }

  // Migrate sessionId field
  if (migrated.sessionId && typeof migrated.sessionId === 'string') {
    if (BrandedIds.isValidSessionId(migrated.sessionId)) {
      migrated.sessionId = BrandedIds.SessionId(migrated.sessionId);
    }
  }

  // Migrate messageId field
  if (migrated.messageId && typeof migrated.messageId === 'string') {
    if (BrandedIds.isValidMessageId(migrated.messageId)) {
      migrated.messageId = BrandedIds.MessageId(migrated.messageId);
    }
  }

  // Migrate workspaceId field
  if (migrated.workspaceId && typeof migrated.workspaceId === 'string') {
    if (BrandedIds.isValidWorkspaceId(migrated.workspaceId)) {
      migrated.workspaceId = BrandedIds.WorkspaceId(migrated.workspaceId);
    }
  }

  // Migrate streamId field
  if (migrated.streamId && typeof migrated.streamId === 'string') {
    if (BrandedIds.isValidStreamId(migrated.streamId)) {
      migrated.streamId = BrandedIds.StreamId(migrated.streamId);
    }
  }

  // Migrate toolCallId field
  if (migrated.toolCallId && typeof migrated.toolCallId === 'string') {
    if (BrandedIds.isValidToolCallId(migrated.toolCallId)) {
      migrated.toolCallId = BrandedIds.ToolCallId(migrated.toolCallId);
    }
  }

  // Migrate userId field
  if (migrated.userId && typeof migrated.userId === 'string') {
    if (BrandedIds.isValidUserId(migrated.userId)) {
      migrated.userId = BrandedIds.UserId(migrated.userId);
    }
  }

  // Migrate threadId field
  if (migrated.threadId && typeof migrated.threadId === 'string') {
    if (BrandedIds.isValidThreadId(migrated.threadId)) {
      migrated.threadId = BrandedIds.ThreadId(migrated.threadId);
    }
  }

  // Migrate noteId field
  if (migrated.noteId && typeof migrated.noteId === 'string') {
    if (BrandedIds.isValidNoteId(migrated.noteId)) {
      migrated.noteId = BrandedIds.NoteId(migrated.noteId);
    }
  }

  return migrated;
}

/**
 * Migrate an array of objects to use branded IDs
 */
export function migrateToBrandedIdsArray(data: any[]): any[] {
  if (!Array.isArray(data)) {
    return data;
  }
  return data.map((item) => migrateToBrandedIds(item));
}

/**
 * Migrate nested structures (e.g., messages within an agent)
 */
export function migrateToBrandedIdsDeep(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const migrated = migrateToBrandedIds(data);

  // Recursively migrate messages array
  if (Array.isArray(migrated.messages)) {
    migrated.messages = migrateToBrandedIdsArray(migrated.messages);
  }

  // Recursively migrate nested agents
  if (Array.isArray(migrated.agents)) {
    migrated.agents = migrateToBrandedIdsArray(migrated.agents);
  }

  // Recursively migrate nested sessions
  if (Array.isArray(migrated.sessions)) {
    migrated.sessions = migrateToBrandedIdsArray(migrated.sessions);
  }

  return migrated;
}

/**
 * Validate that an object has properly branded IDs
 */
export function validateBrandedIds(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return true;
  }

  // Check id field
  if (data.id && typeof data.id === 'string') {
    if (!BrandedIds.isValidAgentId(data.id)) {
      return false;
    }
  }

  // Check agentId field
  if (data.agentId && typeof data.agentId === 'string') {
    if (!BrandedIds.isValidAgentId(data.agentId)) {
      return false;
    }
  }

  // Check sessionId field
  if (data.sessionId && typeof data.sessionId === 'string') {
    if (!BrandedIds.isValidSessionId(data.sessionId)) {
      return false;
    }
  }

  // Check messageId field
  if (data.messageId && typeof data.messageId === 'string') {
    if (!BrandedIds.isValidMessageId(data.messageId)) {
      return false;
    }
  }

  // Check workspaceId field
  if (data.workspaceId && typeof data.workspaceId === 'string') {
    if (!BrandedIds.isValidWorkspaceId(data.workspaceId)) {
      return false;
    }
  }

  // Check noteId field
  if (data.noteId && typeof data.noteId === 'string') {
    if (!BrandedIds.isValidNoteId(data.noteId)) {
      return false;
    }
  }

  return true;
}
