/**
 * ID Generator Service
 *
 * Centralized service for generating all types of IDs in the system.
 * Uses branded types for compile-time type safety.
 * Delegates to UnifiedIdService for collision detection and validation.
 *
 * Example:
 *   const agentId = unifiedIdService.generateAgentId();
 *   const sessionId = unifiedIdService.generateAgentId();
 */

import { unifiedIdService } from './unified-id.service';
import * as BrandedIds from '../types/branded-ids';

/**
 * Centralized ID generation service
 * All ID generation should go through this service for consistency
 */
export class IdGenerator {
  /**
   * Generate a new Agent ID (agent-<uuid> format)
   */
  static generateAgentId(): BrandedIds.AgentId {
    return unifiedIdService.generateAgentId();
  }

  /**
   * Generate a new Session ID (sess_<uuid> format)
   */
  static generateSessionId(): BrandedIds.SessionId {
    return unifiedIdService.generateSessionId();
  }

  /**
   * Generate a new Message ID (prefixed with 'msg_')
   */
  static generateMessageId(): BrandedIds.MessageId {
    return unifiedIdService.generateMessageId();
  }

  /**
   * Generate a new Workspace ID (raw UUID, no prefix)
   */
  static generateWorkspaceId(): BrandedIds.WorkspaceId {
    return unifiedIdService.generateWorkspaceId();
  }

  /**
   * Generate a new Stream ID (stream_<uuid> format)
   */
  static generateStreamId(): BrandedIds.StreamId {
    return unifiedIdService.generateStreamId();
  }

  /**
   * Generate a new Tool Call ID (prefixed with 'tool_')
   */
  static generateToolCallId(): BrandedIds.ToolCallId {
    return unifiedIdService.generateToolCallId();
  }

  /**
   * Generate a new User ID (UUID format)
   */
  static generateUserId(): BrandedIds.UserId {
    return unifiedIdService.generateUserId();
  }

  /**
   * Generate a new Thread ID (prefixed with 'thread_')
   */
  static generateThreadId(): BrandedIds.ThreadId {
    return unifiedIdService.generateThreadId();
  }

  /**
   * Generate a new Note ID (UUID format)
   */
  static generateNoteId(): BrandedIds.NoteId {
    return unifiedIdService.generateNoteId();
  }

  /**
   * Generate a batch of Agent IDs
   */
  static generateAgentIdBatch(count: number): BrandedIds.AgentId[] {
    return Array.from({ length: count }, () => this.generateAgentId());
  }

  /**
   * Generate a batch of Session IDs
   */
  static generateSessionIdBatch(count: number): BrandedIds.SessionId[] {
    return Array.from({ length: count }, () => this.generateSessionId());
  }

  /**
   * Generate a batch of Message IDs
   */
  static generateMessageIdBatch(count: number): BrandedIds.MessageId[] {
    return Array.from({ length: count }, () => this.generateMessageId());
  }

  /**
   * Validate an ID
   */
  static isValidAgentId(id: string): boolean {
    return unifiedIdService.isValidAgentId(id);
  }

  static isValidSessionId(id: string): boolean {
    return unifiedIdService.isValidSessionId(id);
  }

  static isValidMessageId(id: string): boolean {
    return unifiedIdService.isValidMessageId(id);
  }

  static isValidWorkspaceId(id: string): boolean {
    return unifiedIdService.isValidWorkspaceId(id);
  }
}

/**
 * Singleton instance for convenience
 * Use IdGenerator directly for static methods
 */
export const idGenerator = new IdGenerator();
