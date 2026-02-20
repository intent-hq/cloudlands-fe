/**
 * Tests for Branded ID Types
 */

import { describe, it, expect } from 'vitest';
import * as BrandedIds from '../branded-ids';
import { v4 as uuidv4 } from 'uuid';

describe('Branded ID Types', () => {
  describe('ID Creation Functions', () => {
    it('should create AgentId from string', () => {
      const uuid = uuidv4();
      const agentId = BrandedIds.AgentId(uuid);
      expect(agentId).toBe(uuid);
    });

    it('should create SessionId with prefix', () => {
      const uuid = uuidv4();
      const sessionId = BrandedIds.SessionId(`sess_${uuid}`);
      expect(sessionId).toContain('sess_');
    });

    it('should create MessageId with prefix', () => {
      const uuid = uuidv4();
      const messageId = BrandedIds.MessageId(`msg_${uuid}`);
      expect(messageId).toContain('msg_');
    });

    it('should create WorkspaceId from UUID', () => {
      const uuid = uuidv4();
      const workspaceId = BrandedIds.WorkspaceId(uuid);
      expect(workspaceId).toBe(uuid);
    });

    it('should create StreamId with prefix', () => {
      const uuid = uuidv4();
      const streamId = BrandedIds.StreamId(`stream_${uuid}`);
      expect(streamId).toContain('stream_');
    });

    it('should create ToolCallId with prefix', () => {
      const uuid = uuidv4();
      const toolCallId = BrandedIds.ToolCallId(`tool_${uuid}`);
      expect(toolCallId).toContain('tool_');
    });
  });

  describe('ID Validation Functions', () => {
    it('should validate AgentId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidAgentId(uuid)).toBe(true);
      expect(BrandedIds.isValidAgentId(`agent-${uuid}`)).toBe(true);
      expect(BrandedIds.isValidAgentId('invalid')).toBe(false);
    });

    it('should validate SessionId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidSessionId(`sess_${uuid}`)).toBe(true);
      expect(BrandedIds.isValidSessionId(uuid)).toBe(true);
      expect(BrandedIds.isValidSessionId('invalid')).toBe(false);
    });

    it('should validate MessageId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidMessageId(`msg_${uuid}`)).toBe(true);
      expect(BrandedIds.isValidMessageId(uuid)).toBe(true);
      expect(BrandedIds.isValidMessageId('invalid')).toBe(false);
    });

    it('should validate WorkspaceId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidWorkspaceId(uuid)).toBe(true);
      expect(BrandedIds.isValidWorkspaceId('invalid')).toBe(false);
    });

    it('should validate StreamId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidStreamId(`stream_${uuid}`)).toBe(true);
      expect(BrandedIds.isValidStreamId(uuid)).toBe(true);
      expect(BrandedIds.isValidStreamId('invalid')).toBe(false);
    });

    it('should validate ToolCallId', () => {
      const uuid = uuidv4();
      expect(BrandedIds.isValidToolCallId(`tool_${uuid}`)).toBe(true);
      expect(BrandedIds.isValidToolCallId(uuid)).toBe(true);
      expect(BrandedIds.isValidToolCallId('invalid')).toBe(false);
    });
  });

  describe('Safe ID Creation', () => {
    it('should create valid AgentId', () => {
      const uuid = uuidv4();
      const agentId = BrandedIds.createAgentId(uuid);
      expect(agentId).toBe(uuid);
    });

    it('should throw on invalid AgentId', () => {
      expect(() => BrandedIds.createAgentId('invalid')).toThrow();
    });

    it('should create valid SessionId (deprecated - uses AgentId)', () => {
      const uuid = uuidv4();
      // createSessionId is deprecated and expects agent- prefix
      const sessionId = BrandedIds.createSessionId(`agent-${uuid}`);
      expect(sessionId).toContain('agent-');
    });

    it('should throw on invalid SessionId', () => {
      expect(() => BrandedIds.createSessionId('invalid')).toThrow();
      expect(() => BrandedIds.createSessionId('sess_invalid')).toThrow();
    });

    it('should create valid MessageId', () => {
      const uuid = uuidv4();
      const messageId = BrandedIds.createMessageId(`msg_${uuid}`);
      expect(messageId).toContain('msg_');
    });

    it('should throw on invalid MessageId', () => {
      expect(() => BrandedIds.createMessageId('invalid')).toThrow();
    });
  });

  describe('Type Guards', () => {
    it('should assert valid AgentId', () => {
      const uuid = uuidv4();
      expect(() => BrandedIds.assertAgentId(uuid)).not.toThrow();
    });

    it('should throw on invalid AgentId assertion', () => {
      expect(() => BrandedIds.assertAgentId('invalid')).toThrow();
    });

    it('should assert valid SessionId', () => {
      const uuid = uuidv4();
      expect(() => BrandedIds.assertSessionId(`sess_${uuid}`)).not.toThrow();
    });

    it('should throw on invalid SessionId assertion', () => {
      expect(() => BrandedIds.assertSessionId('invalid')).toThrow();
    });
  });
});
