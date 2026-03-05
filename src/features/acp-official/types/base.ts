/**
 * Base types for Agent Client Protocol (ACP)
 * Based on official specification from https://agentclientprotocol.com/protocol/schema
 */

/**
 * Protocol version identifier.
 * This version is only bumped for breaking changes.
 * Non-breaking changes should be introduced via capabilities.
 */
export type ProtocolVersion = number; // uint16

/**
 * The sender or recipient of messages and data in a conversation.
 */
export enum Role {
  Assistant = 'assistant',
  User = 'user',
}

/**
 * A unique identifier for a conversation session between a client and agent.
 * Sessions maintain their own context, conversation history, and state,
 * allowing multiple independent interactions with the same agent.
 */
export type SessionId = string;

/**
 * Unique identifier for a Session Mode.
 */
export type SessionModeId = string;

/**
 * Unique identifier for a Model.
 */
export type ModelId = string;

/**
 * Unique identifier for a tool call within a session.
 */
export type ToolCallId = string;

/**
 * Unique identifier for a permission option.
 */
export type PermissionOptionId = string;

/**
 * Extension point for implementations
 */
export interface Meta {
  [key: string]: unknown;
}

/**
 * Information about the agent implementation.
 */
export interface AgentInfo {
  _meta?: Meta;
  name: string;
  version: string;
  description?: string | null;
}

/**
 * Information about the client implementation.
 */
export interface ClientInfo {
  _meta?: Meta;
  name: string;
  version: string;
  description?: string | null;
}

/**
 * A mode the agent can operate in.
 * See protocol docs: https://agentclientprotocol.com/protocol/session-modes
 */
export interface SessionMode {
  _meta?: Meta;
  id: SessionModeId;
  name: string;
  description?: string | null;
}

/**
 * The set of modes and the one currently active.
 */
export interface SessionModeState {
  _meta?: Meta;
  availableModes: SessionMode[];
  currentModeId: SessionModeId;
}

/**
 * Information about a model.
 */
export interface ModelInfo {
  _meta?: Meta;
  id: ModelId;
  name: string;
  description?: string | null;
}

/**
 * The set of models and the one currently active.
 * UNSTABLE: This capability is not part of the spec yet, and may be removed or changed at any point.
 */
export interface SessionModelState {
  _meta?: Meta;
  availableModels: ModelInfo[];
  currentModelId: ModelId;
}

/**
 * Reasons why an agent stops processing a prompt turn.
 * See protocol docs: https://agentclientprotocol.com/protocol/prompt-turn#stop-reasons
 */
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

/**
 * Exit status of a terminal command.
 */
export interface TerminalExitStatus {
  _meta?: Meta;
  exitCode?: number | null; // The process exit code (may be null if terminated by signal)
  signal?: string | null; // The signal that terminated the process (may be null if exited normally)
}

/**
 * Available command that can be executed.
 */
export interface AvailableCommand {
  _meta?: Meta;
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  enabled: boolean;
}

/**
 * Plan entry representing a task to be accomplished.
 */
export interface PlanEntry {
  _meta?: Meta;
  id: string;
  title: string;
  description?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  children?: PlanEntry[];
}

/**
 * Authentication method supported by the agent.
 */
export interface AuthMethod {
  _meta?: Meta;
  id: string;
  type: 'oauth2' | 'api_key' | 'custom';
  name: string;
  description?: string | null;
  required: boolean;
}

/**
 * Permission option for user selection.
 */
export interface PermissionOption {
  _meta?: Meta;
  id: PermissionOptionId;
  label: string;
  description?: string | null;
  destructive?: boolean;
}

/**
 * The outcome of a permission request.
 */
export type RequestPermissionOutcome =
  | {
      outcome: 'cancelled';
    }
  | {
      outcome: 'selected';
      optionId: PermissionOptionId;
    };

/**
 * Error object for JSON-RPC errors.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Capabilities that the agent supports beyond the base protocol.
 */
export interface AgentCapabilities {
  _meta?: Meta;
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
  };
  sessionCapabilities?: {
    list?: Record<string, unknown>;
  };
}

/**
 * Standard JSON-RPC error codes.
 */
export enum JsonRpcErrorCode {
  // JSON-RPC 2.0 standard error codes
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,

  // ACP-specific error codes
  AuthRequired = -32000,
  SessionNotFound = -32001,
  SessionExpired = -32002,
  PermissionDenied = -32003,
  ResourceNotFound = -32004,
  ResourceConflict = -32005,
  RateLimitExceeded = -32006,
  InvalidSession = -32007,
  ToolExecutionFailed = -32008,
}
