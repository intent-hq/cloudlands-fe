/**
 * Tests for ID Generator Service
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { IdGenerator } from '../id-generator';
import * as BrandedIds from '../../types/branded-ids';

describe('IdGenerator', () => {
  describe('Single ID Generation', () => {
    it('should generate valid AgentId', () => {
      const agentId = IdGenerator.generateAgentId();
      expect(BrandedIds.isValidAgentId(agentId)).toBe(true);
    });

    it('should generate valid SessionId', () => {
      const sessionId = IdGenerator.generateSessionId();
      expect(BrandedIds.isValidSessionId(sessionId)).toBe(true);
      expect(sessionId).toContain('sess_');
    });

    it('should generate valid MessageId', () => {
      const messageId = IdGenerator.generateMessageId();
      expect(BrandedIds.isValidMessageId(messageId)).toBe(true);
      expect(messageId).toContain('msg_');
    });

    it('should generate valid WorkspaceId', () => {
      const workspaceId = IdGenerator.generateWorkspaceId();
      expect(BrandedIds.isValidWorkspaceId(workspaceId)).toBe(true);
    });

    it('should generate valid StreamId', () => {
      const streamId = IdGenerator.generateStreamId();
      expect(BrandedIds.isValidStreamId(streamId)).toBe(true);
      expect(streamId).toContain('stream_');
    });

    it('should generate valid ToolCallId', () => {
      const toolCallId = IdGenerator.generateToolCallId();
      expect(BrandedIds.isValidToolCallId(toolCallId)).toBe(true);
      expect(toolCallId).toContain('tool_');
    });

    it('should generate valid UserId', () => {
      const userId = IdGenerator.generateUserId();
      expect(BrandedIds.isValidUserId(userId)).toBe(true);
    });

    it('should generate valid ThreadId', () => {
      const threadId = IdGenerator.generateThreadId();
      expect(BrandedIds.isValidThreadId(threadId)).toBe(true);
      expect(threadId).toContain('thread_');
    });
  });

  describe('Uniqueness', () => {
    it('should generate unique AgentIds', () => {
      const id1 = IdGenerator.generateAgentId();
      const id2 = IdGenerator.generateAgentId();
      expect(id1).not.toBe(id2);
    });

    it('should generate unique SessionIds', () => {
      const id1 = IdGenerator.generateSessionId();
      const id2 = IdGenerator.generateSessionId();
      expect(id1).not.toBe(id2);
    });

    it('should generate unique MessageIds', () => {
      const id1 = IdGenerator.generateMessageId();
      const id2 = IdGenerator.generateMessageId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('Batch Generation', () => {
    it('should generate batch of AgentIds', () => {
      const ids = IdGenerator.generateAgentIdBatch(5);
      expect(ids).toHaveLength(5);
      ids.forEach((id) => {
        expect(BrandedIds.isValidAgentId(id)).toBe(true);
      });
    });

    it('should generate unique AgentIds in batch', () => {
      const ids = IdGenerator.generateAgentIdBatch(10);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    it('should generate batch of SessionIds', () => {
      const ids = IdGenerator.generateSessionIdBatch(5);
      expect(ids).toHaveLength(5);
      ids.forEach((id) => {
        expect(BrandedIds.isValidSessionId(id)).toBe(true);
      });
    });

    it('should generate unique SessionIds in batch', () => {
      const ids = IdGenerator.generateSessionIdBatch(10);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });

    it('should generate batch of MessageIds', () => {
      const ids = IdGenerator.generateMessageIdBatch(5);
      expect(ids).toHaveLength(5);
      ids.forEach((id) => {
        expect(BrandedIds.isValidMessageId(id)).toBe(true);
      });
    });

    it('should generate unique MessageIds in batch', () => {
      const ids = IdGenerator.generateMessageIdBatch(10);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('Format Consistency', () => {
    it('AgentId should have agent- prefix with UUID', () => {
      const agentId = IdGenerator.generateAgentId();
      expect(agentId).toMatch(
        /^agent-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });

    it('SessionId should have sess_ prefix', () => {
      const sessionId = IdGenerator.generateSessionId();
      expect(sessionId).toMatch(
        /^sess_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });

    it('MessageId should have msg_ prefix', () => {
      const messageId = IdGenerator.generateMessageId();
      expect(messageId).toMatch(
        /^msg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });

    it('StreamId should have stream_ prefix', () => {
      const streamId = IdGenerator.generateStreamId();
      expect(streamId).toMatch(
        /^stream_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });

    it('ToolCallId should have tool_ prefix', () => {
      const toolCallId = IdGenerator.generateToolCallId();
      expect(toolCallId).toMatch(
        /^tool_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });

    it('ThreadId should have thread_ prefix', () => {
      const threadId = IdGenerator.generateThreadId();
      expect(threadId).toMatch(
        /^thread_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      );
    });
  });
});
