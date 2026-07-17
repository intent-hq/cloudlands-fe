/**
 * IPC Module Exports
 *
 * Central export point for all IPC-related types, functions, and utilities.
 * Provides type-safe IPC communication across the Electron boundary.
 */

// ============================================================================
// Type Contracts
// ============================================================================

export type { IpcRequest, IpcResponse, IpcContractMap } from './contracts';

// Export namespace types for use in type annotations
export type { AgentIpc, WorkspaceIpc, FileIpc, TerminalIpc } from './contracts';

// ============================================================================
// Type-Safe Invoke
// ============================================================================

export { typedInvoke, isSuccessResponse, isErrorResponse, throwOnError } from './typed-invoke';

// ============================================================================
// Request Validation
// ============================================================================

export {
  // Schemas
  AgentCreateRequestSchema,
  AgentGetRequestSchema,
  AgentSendMessageRequestSchema,
  AgentListRequestSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceGetRequestSchema,
  FileReadRequestSchema,
  FileWriteRequestSchema,
  TerminalCreateRequestSchema,
  TerminalWriteRequestSchema,
  // Functions
  validateIpcRequest,
  tryValidateIpcRequest,
} from './request-validation';

// ============================================================================
// Channel Definitions
// ============================================================================

export {
  AGENT_CHANNELS,
  WORKSPACE_CHANNELS,
  FILE_CHANNELS,
  SYSTEM_CHANNELS,
  TERMINAL_CHANNELS,
  WINDOW_CHANNELS,
  APP_CHANNELS,
  CONFIG_CHANNELS,
  GIT_CHANNELS,
  EVENTS_CHANNELS,
  AUGGIE_CHANNELS,
  SOURCES_CHANNELS,
  LOG_CHANNELS,
  AGENT_TESTING_CHANNELS,
  RULES_CHANNELS,
  MEMORIES_CHANNELS,
  REMOTE_FS_CHANNELS,
  SKILLS_CHANNELS,
  SCRIPTS_CHANNELS,
  ALL_CHANNELS,
  type ChannelName,
  createChannelName,
  getAgentChannels,
  getWorkspaceChannels,
  getFileChannels,
  getSystemChannels,
  getTerminalChannels,
  getAllStaticChannels,
} from './channels';

// ============================================================================
// Channel Validation
// ============================================================================

// Agent validator removed - legacy cleanup
export {
  isValidChannel,
  assertValidChannel,
  isDynamicChannel,
  getDynamicChannelPattern,
} from './validation';

// ============================================================================
// Re-export from registry for backward compatibility
// ============================================================================

export {
  IPC_CHANNELS,
  EVENT_CHANNELS,
  DYNAMIC_CHANNEL_PATTERNS,
  getAllowedChannels,
  isDynamicChannel as isRegistryDynamicChannel,
} from '../ipc-registry';
