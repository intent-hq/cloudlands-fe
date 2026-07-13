/**
 * Unit Tests for UnifiedIdService
 *
 * Tests the unified ID management system that simplifies ID strategy
 * to use only AgentId as the primary identifier.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedIdService } from '../../src/shared/services/unified-id.service';

// Mock uuid to generate valid UUID format
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    // Generate a valid UUID v4 format
    const hex = '0123456789abcdef';
    let uuid = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-';
      } else if (i === 14) {
        uuid += '4'; // Version 4
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8]; // Variant
      } else {
        uuid += hex[Math.floor(Math.random() * 16)];
      }
    }
    return uuid;
  }),
}));

// Mock logger
vi.mock('../../src/shared/logger', () => ({
  Logger: class MockLogger {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(name: string) {}
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

describe('UnifiedIdService', () => {
  let service: UnifiedIdService;

  beforeEach(() => {
    service = UnifiedIdService.getInstance();
    // Clear any existing state
    service.clearTrackedIds();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = UnifiedIdService.getInstance();
      const instance2 = UnifiedIdService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Agent ID Generation', () => {
    it('should generate a valid AgentId', () => {
      const agentId = service.generateAgentId();
      expect(agentId).toBeDefined();
      expect(typeof agentId).toBe('string');
      expect(agentId).toContain('agent-');
    });

    it('should generate unique AgentIds', () => {
      const id1 = service.generateAgentId();
      const id2 = service.generateAgentId();
      expect(id1).not.toBe(id2);
    });

    it('should have correct format', () => {
      const agentId = service.generateAgentId();
      expect(agentId).toMatch(/^agent-[a-f0-9-]+$/);
      expect(service.isValidAgentId(agentId)).toBe(true);
    });
  });

  describe('Workspace ID Generation', () => {
    it('should generate a valid WorkspaceId', () => {
      const workspaceId = service.generateWorkspaceId();
      expect(workspaceId).toBeDefined();
      expect(typeof workspaceId).toBe('string');
      // Workspace IDs use friendly slug format: word-word (e.g., "amber-forest")
      // or word-word-N for collision resolution (e.g., "amber-forest-2")
      expect(workspaceId).toMatch(/^[a-z]+-[a-z]+(-[0-9]+)?$/);
    });

    it('should generate unique WorkspaceIds', () => {
      const id1 = service.generateWorkspaceId();
      const id2 = service.generateWorkspaceId();
      expect(id1).not.toBe(id2);
    });

    it('should have correct format', () => {
      const workspaceId = service.generateWorkspaceId();
      // Workspace IDs use friendly slug format: word-word or word-word-N
      expect(workspaceId).toMatch(/^[a-z]+-[a-z]+(-[0-9]+)?$/);
      expect(service.isValidWorkspaceId(workspaceId)).toBe(true);
    });
  });

  describe('ID Validation', () => {
    it('should validate correct AgentId format', () => {
      // Generate a valid agent ID to test
      const validId = service.generateAgentId();
      expect(service.isValidAgentId(validId)).toBe(true);
    });

    it('should reject invalid AgentId format', () => {
      expect(service.isValidAgentId('invalid-id')).toBe(false);
      expect(service.isValidAgentId('agent-short')).toBe(false);
      expect(service.isValidAgentId('notanagent-123')).toBe(false);
    });

    it('should validate correct WorkspaceId format', () => {
      // Workspace IDs use friendly slug format: word-word (e.g., "amber-forest")
      // or word-word-N for collision resolution (e.g., "amber-forest-2")
      const validId = service.generateWorkspaceId();
      expect(service.isValidWorkspaceId(validId)).toBe(true);
    });

    it('should accept legacy UUID format for backward compatibility', () => {
      // Legacy UUID format should still be valid
      expect(service.isValidWorkspaceId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('should reject invalid WorkspaceId format', () => {
      // Single word (needs at least 2 parts)
      expect(service.isValidWorkspaceId('invalid')).toBe(false);
      // First word too short (needs at least 2 chars)
      expect(service.isValidWorkspaceId('a-forest')).toBe(false);
      // Second word too short (needs at least 2 chars)
      expect(service.isValidWorkspaceId('amber-b')).toBe(false);
      // Contains uppercase (must be lowercase)
      expect(service.isValidWorkspaceId('Amber-Forest')).toBe(false);
      // Empty string
      expect(service.isValidWorkspaceId('')).toBe(false);
    });

    it('should accept valid new format WorkspaceIds', () => {
      // New format: word-word
      expect(service.isValidWorkspaceId('amber-forest')).toBe(true);
      expect(service.isValidWorkspaceId('auth-refactor')).toBe(true);
      // New format with numeric suffix: word-word-N
      expect(service.isValidWorkspaceId('amber-forest-2')).toBe(true);
      expect(service.isValidWorkspaceId('auth-refactor-10')).toBe(true);
    });

    it('should accept legacy alphanumeric suffix format', () => {
      // Legacy format: word-word-xxxx (4 alphanumeric chars)
      expect(service.isValidWorkspaceId('amber-forest-a7x2')).toBe(true);
      expect(service.isValidWorkspaceId('silver-canyon-b3m9')).toBe(true);
    });
  });

  describe('Session and Stream ID Generation', () => {
    it('should generate valid SessionId', () => {
      const sessionId = service.generateSessionId();
      expect(sessionId).toContain('sess_');
      expect(service.isValidSessionId(sessionId)).toBe(true);
    });

    it('should generate valid StreamId', () => {
      const streamId = service.generateStreamId();
      expect(streamId).toContain('stream_');
      // Stream IDs don't have a specific validation method, just check format
      expect(streamId).toMatch(/^stream_[a-f0-9-]+$/);
    });
  });

  describe('Clear and Reset', () => {
    it('should clear tracked IDs', () => {
      service.generateAgentId();
      service.generateWorkspaceId();

      // Check that IDs are being tracked
      expect(service.getTrackedIdCount()).toBeGreaterThan(0);

      service.clearTrackedIds();

      // After clear, tracked count should be 0
      expect(service.getTrackedIdCount()).toBe(0);

      // We can still generate new IDs
      const newAgentId = service.generateAgentId();
      const newWorkspaceId = service.generateWorkspaceId();

      expect(newAgentId).toBeDefined();
      expect(newWorkspaceId).toBeDefined();
    });
  });
});
