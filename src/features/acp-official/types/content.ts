/**
 * Content types for Agent Client Protocol (ACP)
 * Based on official specification from https://agentclientprotocol.com/protocol/schema
 */

import type { Meta, Role } from './base';

/**
 * Base content block type.
 * Content blocks are the building blocks of messages.
 */
export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceContent;

/**
 * Text content block.
 */
export interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Image content block.
 */
export interface ImageContent {
  type: 'image';
  data: string; // Base64-encoded image data
  mimeType: string;
}

/**
 * Audio content block.
 */
export interface AudioContent {
  type: 'audio';
  data: string; // Base64-encoded audio data
  mimeType: string;
  transcript?: string | null;
}

/**
 * Resource content block for embedded context.
 * Used to include pieces of context that are referenced in the message.
 */
export interface ResourceContent {
  type: 'resource';
  resource: TextResourceContents | BlobResourceContents;
}

/**
 * Text-based resource contents.
 */
export interface TextResourceContents {
  _meta?: Meta;
  uri: string;
  mimeType?: string | null;
  text: string;
}

/**
 * Binary resource contents.
 */
export interface BlobResourceContents {
  _meta?: Meta;
  uri: string;
  mimeType?: string | null;
  blob: string; // Base64-encoded data
}

/**
 * A message in a conversation (ACP-specific).
 * Named AcpMessage to avoid conflicts with the general Message type.
 */
export interface AcpMessage {
  _meta?: Meta;
  role: Role;
  content: ContentBlock[];
}

// Export with original name for backward compatibility within ACP module
export type Message = AcpMessage;

/**
 * Content produced by a tool call.
 * Tool calls can produce different types of content including
 * standard content blocks (text, images) or file diffs.
 */
export type ToolCallContent =
  | {
      type: 'content';
      content: ContentBlock;
    }
  | {
      type: 'diff';
      _meta?: Meta;
      path: string;
      oldText?: string | null;
      newText: string;
    }
  | {
      type: 'terminal';
      terminalId: string;
    };

/**
 * A file location being accessed or modified by a tool.
 * Enables clients to implement "follow-along" features that track
 * which files the agent is working with in real-time.
 */
export interface ToolCallLocation {
  _meta?: Meta;
  path: string;
  line?: number | null;
}

/**
 * Execution status of a tool call.
 * Tool calls progress through different statuses during their lifecycle.
 */
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Categories of tools that can be invoked.
 * Tool kinds help clients choose appropriate icons and optimize how they
 * display tool execution progress.
 */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';
