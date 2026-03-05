/**
 * Protocol message types for Agent Client Protocol (ACP)
 * Based on official specification from https://agentclientprotocol.com/protocol/schema
 */

import type { AgentId } from '$shared/types/branded-ids';
import type {
  AgentCapabilities,
  AgentInfo,
  AuthMethod,
  AvailableCommand,
  ClientInfo,
  JsonRpcError,
  Meta,
  ModelId,
  PermissionOption,
  PlanEntry,
  ProtocolVersion,
  RequestPermissionOutcome,
  SessionModeId,
  SessionModeState,
  SessionModelState,
  StopReason,
  TerminalExitStatus,
  ToolCallId,
} from './base';
import type {
  ContentBlock,
  Message,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from './content';

/**
 * Base JSON-RPC 2.0 request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: string | number;
}

/**
 * Base JSON-RPC 2.0 response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JsonRpcError;
  id: string | number;
}

/**
 * Base JSON-RPC 2.0 notification
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// ============================================================================
// Agent Methods (Client → Agent)
// ============================================================================

/**
 * Initialize request - Establishes protocol version and capabilities
 */
export interface InitializeRequest extends JsonRpcRequest {
  method: 'initialize';
  params: InitializeParams;
}

export interface InitializeParams {
  _meta?: Meta;
  protocolVersion: ProtocolVersion;
  clientInfo: ClientInfo;
}

export interface InitializeResult {
  _meta?: Meta;
  protocolVersion: ProtocolVersion;
  agentInfo: AgentInfo;
  authMethods?: AuthMethod[];
  instructions?: string | null;
  promptCapabilities?: PromptCapabilities;
  sessionCapabilities?: SessionCapabilities;
  agentCapabilities?: AgentCapabilities;
}

export interface PromptCapabilities {
  _meta?: Meta;
  audio?: boolean;
  embeddedContext?: boolean;
  image?: boolean;
}

export interface SessionCapabilities {
  _meta?: Meta;
  modes?: boolean;
  models?: boolean;
  slashCommands?: boolean;
}

/**
 * Authenticate request - Authenticates the client
 */
export interface AuthenticateRequest extends JsonRpcRequest {
  method: 'authenticate';
  params: AuthenticateParams;
}

export interface AuthenticateParams {
  _meta?: Meta;
  methodId: string;
  [key: string]: unknown; // Method-specific parameters
}

export interface AuthenticateResult {
  _meta?: Meta;
}

/**
 * Session/new request - Creates a new session
 */
export interface NewSessionRequest extends JsonRpcRequest {
  method: 'session/new';
  params: NewSessionParams;
}

export interface NewSessionParams {
  _meta?: Meta;
  metadata?: Record<string, unknown>;
}

export interface NewSessionResult {
  _meta?: Meta;
  sessionId: AgentId;
  modeState?: SessionModeState;
  modelState?: SessionModelState;
}

/**
 * Session/prompt request - Sends a prompt to the agent
 */
export interface PromptRequest extends JsonRpcRequest {
  method: 'session/prompt';
  params: PromptParams;
}

export interface PromptParams {
  _meta?: Meta;
  sessionId: AgentId;
  prompt: Message[];
  metadata?: Record<string, unknown>;
}

export interface PromptResult {
  _meta?: Meta;
  stopReason: StopReason;
  modeState?: SessionModeState;
  modelState?: SessionModelState;
}

/**
 * Session/load request - Loads a previous session
 */
export interface LoadSessionRequest extends JsonRpcRequest {
  method: 'session/load';
  params: LoadSessionParams;
}

export interface LoadSessionParams {
  _meta?: Meta;
  sessionId: AgentId;
  cwd?: string;
  mcpServers?: unknown[];
}

export interface LoadSessionResult {
  _meta?: Meta;
  messages: Message[];
  modeState?: SessionModeState;
  modelState?: SessionModelState;
}

/**
 * Session/set_mode request - Changes the session mode
 */
export interface SetModeRequest extends JsonRpcRequest {
  method: 'session/set_mode';
  params: SetModeParams;
}

export interface SetModeParams {
  _meta?: Meta;
  sessionId: AgentId;
  modeId: SessionModeId;
}

export interface SetModeResult {
  _meta?: Meta;
  modeState: SessionModeState;
}

/**
 * Session/set_model request - Changes the session model
 */
export interface SetModelRequest extends JsonRpcRequest {
  method: 'session/set_model';
  params: SetModelParams;
}

export interface SetModelParams {
  _meta?: Meta;
  sessionId: AgentId;
  modelId: ModelId;
}

export interface SetModelResult {
  _meta?: Meta;
  modelState: SessionModelState;
}

// ============================================================================
// Agent Notifications (Client → Agent)
// ============================================================================

/**
 * Session/cancel notification - Cancels an ongoing prompt turn
 */
export interface CancelNotification extends JsonRpcNotification {
  method: 'session/cancel';
  params: CancelParams;
}

export interface CancelParams {
  _meta?: Meta;
  sessionId: AgentId;
}

// ============================================================================
// Client Methods (Agent → Client)
// ============================================================================

/**
 * Session/request_permission request - Requests permission from the user
 */
export interface RequestPermissionRequest extends JsonRpcRequest {
  method: 'session/request_permission';
  params: RequestPermissionParams;
}

export interface RequestPermissionParams {
  _meta?: Meta;
  sessionId: AgentId;
  title: string;
  description?: string | null;
  options: PermissionOption[];
}

export interface RequestPermissionResult {
  _meta?: Meta;
  outcome: RequestPermissionOutcome;
}

/**
 * File system methods
 */
export interface ReadTextFileRequest extends JsonRpcRequest {
  method: 'fs/read_text_file';
  params: ReadTextFileParams;
}

export interface ReadTextFileParams {
  _meta?: Meta;
  path: string;
}

export interface ReadTextFileResult {
  _meta?: Meta;
  content: string;
}

export interface WriteTextFileRequest extends JsonRpcRequest {
  method: 'fs/write_text_file';
  params: WriteTextFileParams;
}

export interface WriteTextFileParams {
  _meta?: Meta;
  path: string;
  content: string;
}

export interface WriteTextFileResult {
  _meta?: Meta;
}

/**
 * Terminal methods
 */
export interface TerminalCreateRequest extends JsonRpcRequest {
  method: 'terminal/create';
  params: TerminalCreateParams;
}

export interface TerminalCreateParams {
  _meta?: Meta;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string> | null;
}

export interface TerminalCreateResult {
  _meta?: Meta;
  terminalId: string;
}

export interface TerminalOutputRequest extends JsonRpcRequest {
  method: 'terminal/output';
  params: TerminalOutputParams;
}

export interface TerminalOutputParams {
  _meta?: Meta;
  terminalId: string;
  data: string;
}

export interface TerminalOutputResult {
  _meta?: Meta;
}

export interface TerminalWaitForExitRequest extends JsonRpcRequest {
  method: 'terminal/wait_for_exit';
  params: TerminalWaitForExitParams;
}

export interface TerminalWaitForExitParams {
  _meta?: Meta;
  terminalId: string;
}

export interface TerminalWaitForExitResult {
  _meta?: Meta;
  exitStatus: TerminalExitStatus;
}

// ============================================================================
// Client Notifications (Agent → Client)
// ============================================================================

/**
 * Session/update notification - Updates during session processing
 */
export interface SessionUpdateNotification extends JsonRpcNotification {
  method: 'session/update';
  params: SessionUpdateParams;
}

export interface SessionUpdateParams {
  _meta?: Meta;
  sessionId: AgentId;
  sessionUpdate: SessionUpdate;
}

/**
 * Different types of updates that can be sent during session processing.
 * These updates provide real-time feedback about the agent's progress.
 */
export type SessionUpdate =
  | UserMessageChunkUpdate
  | AgentMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate
  | ToolCallUpdateUpdate
  | PlanUpdate
  | AvailableCommandsUpdate
  | CurrentModeUpdate
  | CurrentModelUpdate;

export interface UserMessageChunkUpdate {
  sessionUpdate: 'user_message_chunk';
  _meta?: Meta;
  content: ContentBlock;
}

export interface AgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  _meta?: Meta;
  content: ContentBlock;
}

export interface AgentThoughtChunkUpdate {
  sessionUpdate: 'agent_thought_chunk';
  _meta?: Meta;
  content: ContentBlock;
}

export interface ToolCallUpdate {
  sessionUpdate: 'tool_call';
  _meta?: Meta;
  toolCallId: ToolCallId;
  title: string;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  content?: ToolCallContent[];
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ToolCallUpdateUpdate {
  sessionUpdate: 'tool_call_update';
  _meta?: Meta;
  toolCallId: ToolCallId;
  title?: string | null;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  content?: ToolCallContent[] | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface PlanUpdate {
  sessionUpdate: 'plan';
  _meta?: Meta;
  entries: PlanEntry[];
}

export interface AvailableCommandsUpdate {
  sessionUpdate: 'available_commands_update';
  _meta?: Meta;
  availableCommands: AvailableCommand[];
}

export interface CurrentModeUpdate {
  sessionUpdate: 'current_mode_update';
  _meta?: Meta;
  currentModeId: SessionModeId;
}

export interface CurrentModelUpdate {
  sessionUpdate: 'current_model_update';
  _meta?: Meta;
  currentModelId: ModelId;
}
