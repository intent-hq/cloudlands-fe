/**
 * Streaming Types
 *
 * Type definitions for agent streaming functionality.
 * Replaces various `any` types throughout the streaming system.
 */

import type { ContentBlock } from '$shared/types';

/**
 * Chunk data sent during streaming
 */
export interface StreamChunk {
  content: string;
  timestamp: string | Date; // Accept both for flexibility (ISO string preferred for serialization)
  sequenceNumber?: number;
  metadata?: StreamMetadata;
}

/**
 * Metadata associated with streaming
 */
export interface StreamMetadata {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  [key: string]: unknown;
}

/**
 * Tool call during streaming
 */
export interface StreamToolCall {
  id: string;
  toolName: string;
  toolKind?: string;
  command?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  status: 'started' | 'running' | 'completed' | 'error';
  error?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

/**
 * Complete streaming message
 */
export interface StreamMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentBlocks?: ContentBlock[];
  toolCalls?: StreamToolCall[];
  metadata?: StreamMetadata;
  timestamp: string | Date; // Accept both for flexibility (ISO string preferred for serialization)
}

/**
 * Streaming event types
 */
export type StreamEventType =
  | 'start'
  | 'chunk'
  | 'content-block'
  | 'tool-call'
  | 'error'
  | 'complete'
  | 'abort';

/**
 * Streaming event data
 */
export interface StreamEvent {
  type: StreamEventType;
  sessionId: string;
  agentId?: string;
  data?: StreamChunk | ContentBlock | StreamToolCall | StreamMessage | Error;
  timestamp: string | Date; // Accept both for flexibility (ISO string preferred for serialization)
}

/**
 * Streaming session state
 */
export interface StreamSession {
  sessionId: string;
  agentId: string;
  startTime: Date;
  lastActivityTime: Date;
  isActive: boolean;
  isComplete: boolean;
  hasError: boolean;
  error?: Error;
  metrics?: StreamMetrics;
}

/**
 * Streaming performance metrics
 */
export interface StreamMetrics {
  totalChunks: number;
  totalBytes: number;
  duration: number;
  bytesPerSecond: number;
  averageChunkSize: number;
  largestChunk: number;
  smallestChunk: number;
}

/**
 * Streaming callbacks with proper types
 * Note: onComplete can be async to allow for persistence operations before cleanup
 */
export interface StreamCallbacks {
  onChunk?: (chunk: StreamChunk) => void;
  onContentBlocks?: (blocks: ContentBlock[]) => void;
  onToolCall?: (toolCall: StreamToolCall) => void;
  onComplete?: (message: StreamMessage) => void | Promise<void>;
  onError?: (error: Error) => void;
  onAbort?: () => void;
  onMetrics?: (metrics: StreamMetrics) => void;
}

/**
 * Streaming options
 */
export interface StreamOptions extends StreamCallbacks {
  frontendSessionId?: string;
  workspaceId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

/**
 * IPC streaming data
 */
export interface IPCStreamData {
  sessionId: string;
  type: 'chunk' | 'content-blocks' | 'complete' | 'error';
  data: StreamChunk | ContentBlock[] | StreamMessage | Error;
}

/**
 * Agent activity event data
 */
export interface AgentActivityData {
  agentName?: string;
  content?: string;
  toolCall?: StreamToolCall;
  mcpCall?: {
    toolName: string;
    arguments?: Record<string, unknown>;
    result?: unknown;
  };
  error?: string;
  context?: Record<string, unknown>;
  message?: string;
  response?: unknown;
}

/**
 * Event handler function types
 */
export type StreamEventHandler = (event: StreamEvent) => void;
export type ChunkHandler = (chunk: StreamChunk) => void;
export type BlockHandler = (blocks: ContentBlock[]) => void;
export type ToolCallHandler = (toolCall: StreamToolCall) => void;
export type MessageHandler = (message: StreamMessage) => void;
export type ErrorHandler = (error: Error) => void;

/**
 * Provider-specific message format
 */
export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  toolCalls?: StreamToolCall[];
}

/**
 * Agent context for streaming
 */
export interface StreamingAgentContext {
  agentId: string;
  agentName?: string;
  workspaceId: string;
  sessionId?: string;
  turnNumber?: number;
  model?: string;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Error context for streaming errors
 */
export interface StreamErrorContext {
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  component?: string;
  operation?: string;
  attemptNumber?: number;
  [key: string]: unknown;
}
