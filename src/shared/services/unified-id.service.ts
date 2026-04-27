/**
 * Unified ID Service
 *
 * Centralized service for all ID generation with collision detection,
 * validation, and memory management.
 *
 * Features:
 * - Singleton pattern for thread safety
 * - Collision detection with retry logic
 * - Memory-efficient ID tracking (keeps last 5000)
 * - Format validation for all ID types
 * - ID parsing and extraction utilities
 */

import { v4 as uuidv4 } from 'uuid';
import * as Branded from '../types/branded-ids';
import {
  generateWorkspaceSlug,
  isValidWorkspaceSlug,
  appendSlugSuffix,
  extractBaseSlug,
} from './workspace-slug';

export class UnifiedIdService {
  private static instance: UnifiedIdService;
  private generatedIds = new Set<string>();
  private readonly MAX_TRACKED_IDS = 10000;
  private readonly CLEANUP_THRESHOLD = 5000;

  private constructor() {}

  static getInstance(): UnifiedIdService {
    if (!this.instance) {
      this.instance = new UnifiedIdService();
    }
    return this.instance;
  }

  // ========================================================================
  // ID Generation Methods
  // ========================================================================

  generateAgentId(): Branded.AgentId {
    const id = `agent-${this.generateUniqueId()}`;
    return Branded.AgentId(id);
  }

  generateSessionId(): Branded.SessionId {
    const id = `sess_${this.generateUniqueId()}`;
    return Branded.SessionId(id);
  }

  generateMessageId(): Branded.MessageId {
    const id = `msg_${this.generateUniqueId()}`;
    return Branded.MessageId(id);
  }

  /**
   * Generate a workspace ID using a random adjective-noun combination.
   * Checks for in-memory collisions and adds numeric suffix if needed.
   *
   * Format: adjective-noun (e.g., "amber-forest", "silver-canyon")
   * With collision: adjective-noun-N (e.g., "amber-forest-2")
   *
   * Note: This only checks in-memory collisions. For persistent collision
   * detection (checking existing workspaces), use the workspace service's
   * collision-aware methods.
   *
   * @returns A branded WorkspaceId
   */
  generateWorkspaceId(): Branded.WorkspaceId {
    let attempts = 0;
    while (attempts < 10) {
      const baseSlug = generateWorkspaceSlug();
      if (isValidWorkspaceSlug(baseSlug)) {
        const id = this.resolveWorkspaceSlugCollision(baseSlug);
        this.generatedIds.add(id);
        this.cleanupIfNeeded();
        return Branded.WorkspaceId(id);
      }
      attempts++;
    }
    // Should never happen with filtered dictionaries, but just in case
    throw new Error('Failed to generate valid workspace slug after 10 attempts');
  }

  /**
   * Register a pre-generated workspace ID (e.g., intent-based slug).
   * Used by workspace service when generating IDs from intent.
   * Handles collisions by appending numeric suffix if needed.
   *
   * If the provided slug doesn't match the expected format (word-word or word-word-N),
   * falls back to generating a random adjective-noun slug.
   *
   * @param baseSlug - The base slug (e.g., "auth-refactor") or suffixed slug (e.g., "auth-refactor-2")
   * @returns A branded WorkspaceId (may have suffix if collision detected)
   */
  registerWorkspaceId(baseSlug: string): Branded.WorkspaceId {
    // Validate the slug format before accepting it
    // Must be word-word or word-word-N format (2-15 lowercase letters per word, optional numeric suffix)
    // This matches the schema pattern in schemas.ts
    if (!isValidWorkspaceSlug(baseSlug)) {
      // Invalid format - fall back to random slug
      const validSlug = generateWorkspaceSlug();
      const id = this.resolveWorkspaceSlugCollision(validSlug);
      this.generatedIds.add(id);
      this.cleanupIfNeeded();
      return Branded.WorkspaceId(id);
    }

    const id = this.resolveWorkspaceSlugCollision(baseSlug);
    this.generatedIds.add(id);
    this.cleanupIfNeeded();
    return Branded.WorkspaceId(id);
  }

  /**
   * Resolve in-memory collisions for a workspace slug.
   * If the base slug is already used, appends incrementing numbers (2, 3, 4, etc.)
   *
   * @param baseSlug - The base slug to check
   * @returns A unique slug (either the base or with numeric suffix)
   */
  private resolveWorkspaceSlugCollision(baseSlug: string): string {
    // First, try the base slug as-is
    if (!this.generatedIds.has(baseSlug)) {
      return baseSlug;
    }

    // Check existing IDs to find the highest suffix number for this base
    const base = extractBaseSlug(baseSlug);
    let maxSuffix = 1;

    for (const existingId of this.generatedIds) {
      if (existingId === base || existingId.startsWith(`${base}-`)) {
        // Check if it has a numeric suffix
        const match = existingId.match(new RegExp(`^${base}-(\\d+)$`));
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= maxSuffix) {
            maxSuffix = num + 1;
          }
        } else if (existingId === base) {
          // Base exists without suffix, so we need at least -2
          maxSuffix = Math.max(maxSuffix, 2);
        }
      }
    }

    return appendSlugSuffix(base, maxSuffix);
  }

  generateStreamId(): Branded.StreamId {
    const id = `stream_${this.generateUniqueId()}`;
    return Branded.StreamId(id);
  }

  generateToolCallId(): Branded.ToolCallId {
    const id = `tool_${this.generateUniqueId()}`;
    return Branded.ToolCallId(id);
  }

  generateThreadId(): Branded.ThreadId {
    const id = `thread_${this.generateUniqueId()}`;
    return Branded.ThreadId(id);
  }

  generateUserId(): Branded.UserId {
    const id = this.generateUniqueId();
    return Branded.UserId(id);
  }

  generateNoteId(): Branded.NoteId {
    const id = this.generateUniqueId();
    return Branded.NoteId(id);
  }

  generateTerminalId(): string {
    return `terminal-${this.generateUniqueId()}`;
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  private generateUniqueId(): string {
    let id: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      id = uuidv4();
      attempts++;
      if (attempts > maxAttempts) {
        throw new Error('Failed to generate unique ID after 10 attempts');
      }
    } while (this.generatedIds.has(id));

    this.generatedIds.add(id);
    this.cleanupIfNeeded();

    return id;
  }

  private cleanupIfNeeded(): void {
    if (this.generatedIds.size > this.MAX_TRACKED_IDS) {
      const idsArray = Array.from(this.generatedIds);
      this.generatedIds = new Set(idsArray.slice(-this.CLEANUP_THRESHOLD));
    }
  }

  // ========================================================================
  // Validation Methods
  // ========================================================================

  isValidAgentId(id: string): boolean {
    // Check for both formats: with and without prefix
    return id.startsWith('agent-') ? id.length === 42 : Branded.isValidAgentId(id);
  }

  isValidSessionId(id: string): boolean {
    return Branded.isValidSessionId(id);
  }

  isValidMessageId(id: string): boolean {
    return Branded.isValidMessageId(id);
  }

  isValidWorkspaceId(id: string): boolean {
    // Workspace IDs can be:
    // 1. New slug format: word-word (e.g., "amber-forest", "auth-refactor")
    // 2. New slug with collision suffix: word-word-N (e.g., "amber-forest-2")
    // 3. Legacy slug format: word-word-xxxx (e.g., "amber-forest-a7x2")
    // 4. Legacy UUID format for backward compatibility
    return isValidWorkspaceSlug(id);
  }

  // ========================================================================
  // Parsing Methods
  // ========================================================================

  parseAgentId(id: string): Branded.AgentId | null {
    if (this.isValidAgentId(id)) {
      return Branded.AgentId(id);
    }
    return null;
  }

  parseSessionId(id: string): Branded.AgentId | null {
    if (this.isValidSessionId(id)) {
      return Branded.AgentId(id);
    }
    return null;
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================

  formatIdForDisplay(id: string): string {
    if (id.length > 12) {
      return `${id.slice(0, 8)}...`;
    }
    return id;
  }

  extractUuid(id: string): string {
    const match = id.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    return match ? match[0] : id;
  }

  getTrackedIdCount(): number {
    return this.generatedIds.size;
  }

  clearTrackedIds(): void {
    this.generatedIds.clear();
  }
}

// Export singleton instance
export const idService = UnifiedIdService.getInstance();
export const unifiedIdService = idService; // Alias for compatibility
