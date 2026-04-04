/**
 * Tests for Unified ID Service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { idService, UnifiedIdService } from '../unified-id.service';

describe('UnifiedIdService', () => {
  beforeEach(() => {
    // Clear tracked IDs before each test
    idService.clearTrackedIds();
  });

  describe('ID Generation', () => {
    it('generates unique agent IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(idService.generateAgentId());
      }
      expect(ids.size).toBe(100);
    });

    it('generates unique session IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(idService.generateSessionId());
      }
      expect(ids.size).toBe(100);
    });

    it('generates unique message IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(idService.generateMessageId());
      }
      expect(ids.size).toBe(100);
    });

    it('generates correctly formatted IDs', () => {
      const sessionId = idService.generateSessionId();
      const messageId = idService.generateMessageId();
      const streamId = idService.generateStreamId();
      const toolCallId = idService.generateToolCallId();
      const threadId = idService.generateThreadId();

      expect(sessionId).toMatch(/^sess_/);
      expect(messageId).toMatch(/^msg_/);
      expect(streamId).toMatch(/^stream_/);
      expect(toolCallId).toMatch(/^tool_/);
      expect(threadId).toMatch(/^thread_/);
    });

    it('generates all ID types', () => {
      const agentId = idService.generateAgentId();
      const sessionId = idService.generateSessionId();
      const messageId = idService.generateMessageId();
      const workspaceId = idService.generateWorkspaceId();
      const streamId = idService.generateStreamId();
      const toolCallId = idService.generateToolCallId();
      const threadId = idService.generateThreadId();
      const userId = idService.generateUserId();
      const noteId = idService.generateNoteId();

      expect(agentId).toBeTruthy();
      expect(sessionId).toBeTruthy();
      expect(messageId).toBeTruthy();
      expect(workspaceId).toBeTruthy();
      expect(streamId).toBeTruthy();
      expect(toolCallId).toBeTruthy();
      expect(threadId).toBeTruthy();
      expect(userId).toBeTruthy();
      expect(noteId).toBeTruthy();
    });
  });

  describe('ID Validation', () => {
    it('validates agent IDs correctly', () => {
      const agentId = idService.generateAgentId();
      expect(idService.isValidAgentId(agentId)).toBe(true);
      expect(idService.isValidAgentId('invalid')).toBe(false);
      // Agent IDs with proper format are valid
      expect(idService.isValidAgentId('agent-550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      // Invalid format even with prefix
      expect(idService.isValidAgentId('agent-test')).toBe(false);
    });

    it('validates session IDs correctly', () => {
      const sessionId = idService.generateSessionId();
      expect(idService.isValidSessionId(sessionId)).toBe(true);
      expect(idService.isValidSessionId('invalid')).toBe(false);
    });

    it('validates message IDs correctly', () => {
      const messageId = idService.generateMessageId();
      expect(idService.isValidMessageId(messageId)).toBe(true);
      expect(idService.isValidMessageId('invalid')).toBe(false);
    });

    it('validates workspace IDs correctly', () => {
      const workspaceId = idService.generateWorkspaceId();
      expect(idService.isValidWorkspaceId(workspaceId)).toBe(true);
      expect(idService.isValidWorkspaceId('invalid')).toBe(false);
    });
  });

  describe('ID Parsing', () => {
    it('parses valid agent IDs', () => {
      const agentId = idService.generateAgentId();
      const parsed = idService.parseAgentId(agentId);
      expect(parsed).toBe(agentId);
    });

    it('returns null for invalid agent IDs', () => {
      const parsed = idService.parseAgentId('invalid');
      expect(parsed).toBeNull();
    });

    it('parses valid session IDs', () => {
      const sessionId = idService.generateSessionId();
      const parsed = idService.parseSessionId(sessionId);
      expect(parsed).toBe(sessionId);
    });

    it('returns null for invalid session IDs', () => {
      const parsed = idService.parseSessionId('invalid');
      expect(parsed).toBeNull();
    });
  });

  describe('Utility Methods', () => {
    it('formats IDs for display', () => {
      const agentId = idService.generateAgentId();
      const formatted = idService.formatIdForDisplay(agentId);
      expect(formatted).toMatch(/\.\.\./);
      expect(formatted.length).toBeLessThan(agentId.length);
    });

    it('extracts UUID from prefixed IDs', () => {
      const sessionId = idService.generateSessionId();
      const uuid = idService.extractUuid(sessionId);
      expect(uuid).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
    });

    it('tracks ID count', () => {
      const initialCount = idService.getTrackedIdCount();
      idService.generateAgentId();
      idService.generateSessionId();
      const newCount = idService.getTrackedIdCount();
      expect(newCount).toBeGreaterThan(initialCount);
    });
  });

  describe('Singleton Pattern', () => {
    it('returns same instance', () => {
      const instance1 = UnifiedIdService.getInstance();
      const instance2 = UnifiedIdService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('uses singleton for exported idService', () => {
      const instance = UnifiedIdService.getInstance();
      expect(idService).toBe(instance);
    });
  });

  describe('registerWorkspaceId', () => {
    it('accepts valid two-word slugs', () => {
      const id = idService.registerWorkspaceId('auth-refactor');
      expect(id).toBe('auth-refactor');
    });

    it('accepts valid slugs with numeric suffix', () => {
      const id = idService.registerWorkspaceId('auth-refactor-2');
      expect(id).toBe('auth-refactor-2');
    });

    it('handles collisions by appending numeric suffix', () => {
      const id1 = idService.registerWorkspaceId('test-slug');
      const id2 = idService.registerWorkspaceId('test-slug');
      expect(id1).toBe('test-slug');
      expect(id2).toBe('test-slug-2');
    });

    it('rejects invalid multi-word slugs and generates random slug', () => {
      // "end-of-file-fix" has 4 words, which is invalid
      const id = idService.registerWorkspaceId('end-of-file-fix');
      // Should NOT be the invalid slug
      expect(id).not.toBe('end-of-file-fix');
      // Should be a valid word-word format
      expect(id).toMatch(/^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/);
    });

    it('rejects slugs with numbers in words and generates random slug', () => {
      const id = idService.registerWorkspaceId('test123-slug');
      expect(id).not.toBe('test123-slug');
      expect(id).toMatch(/^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/);
    });

    it('rejects single-word slugs and generates random slug', () => {
      const id = idService.registerWorkspaceId('singleword');
      expect(id).not.toBe('singleword');
      expect(id).toMatch(/^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/);
    });

    it('rejects empty string and generates random slug', () => {
      const id = idService.registerWorkspaceId('');
      expect(id).not.toBe('');
      expect(id).toMatch(/^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/);
    });

    it('accepts legacy 4-char suffix format for backward compatibility', () => {
      const id = idService.registerWorkspaceId('amber-forest-ab12');
      expect(id).toBe('amber-forest-ab12');
    });

    it('accepts UUID format for backward compatibility', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const id = idService.registerWorkspaceId(uuid);
      expect(id).toBe(uuid);
    });
  });
});
