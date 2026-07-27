/**
 * Branded IDs Index
 *
 * Central export point for all branded ID types and utilities
 */

// Export all branded ID types
export type {
  Branded,
  AgentId,
  SessionId,
  MessageId,
  WorkspaceId,
  StreamId,
  ToolCallId,
  UserId,
  ThreadId,
  NoteId,
} from './branded-ids';

// Export validation functions
export {
  isValidAgentId,
  isValidSessionId,
  isValidMessageId,
  isValidWorkspaceId,
  isValidStreamId,
  isValidToolCallId,
  isValidUserId,
  isValidThreadId,
  isValidNoteId,
} from './branded-ids';

// Export safe creation functions
export {
  createAgentId,
  createSessionId,
  createMessageId,
  createWorkspaceId,
  createStreamId,
  createToolCallId,
  createUserId,
  createThreadId,
  createNoteId,
} from './branded-ids';

// Export type guards
export {
  assertAgentId,
  assertSessionId,
  assertMessageId,
  assertWorkspaceId,
  assertStreamId,
  assertToolCallId,
  assertUserId,
  assertThreadId,
  assertNoteId,
} from './branded-ids';

// Export migration utilities
export {
  migrateToBrandedIds,
  migrateToBrandedIdsArray,
  migrateToBrandedIdsDeep,
  validateBrandedIds,
} from './branded-ids.migration';

// Export type restoration utilities for IPC
export {
  restoreAgentId,
  restoreWorkspaceId,
  restoreMessageId,
  restoreStreamId,
  restoreSessionId,
  restoreToolCallId,
  // restoreContentBlockId, // Not yet implemented
  restoreBrandedIds,
  isAgentId,
  isWorkspaceId,
  isMessageId,
  isStreamId,
  isSessionId,
  isToolCallId,
  // isContentBlockId, // Not yet implemented
} from './type-guards';

// Export agent session types
export type {
  QueuedMessage,
  QueuedMessageContextItem,
  AgentSession,
  PendingAgentSession,
} from './agent-session';

export { AgentActivationState, isPendingAgentSession } from './agent-session';

// Export comment types
export type { NoteComment, NoteCommentsData } from './comment.types';

// Export repo-committed `.intent/config.json` types (daemon parity)
export type {
  RepoConfig,
  RepoScript,
  RepoScriptMode,
  RepoScriptCategory,
} from './repo-config.types';
export {
  RepoConfigSchema,
  RepoScriptSchema,
  RepoScriptModeSchema,
  RepoScriptCategorySchema,
} from './repo-config.types';
