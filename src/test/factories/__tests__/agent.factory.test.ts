/**
 * Agent Factory Tests
 *
 * Tests for factory functions that create test data.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  createTestAgent,
  createTestMessage,
  createTestContentBlock,
  createTestToolUseBlock,
  createTestToolResultBlock,
} from '../agent.factory';
import { AgentStatus } from '$shared/types';

describe('Agent Factory', () => {
  describe('createTestAgent', () => {
    it('should create a valid agent with defaults', () => {
      const agent = createTestAgent();

      expect(agent.id).toBeDefined();
      expect(agent.backendSessionId).toBeNull();
      expect(agent.workspaceId).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.status).toBe(AgentStatus.Active);
      expect(agent.messages).toEqual([]);
      expect(agent.model).toBe('claude-3-opus');
      expect(agent.createdAt).toBeInstanceOf(Date);
      expect(agent.updatedAt).toBeInstanceOf(Date);
    });

    it('should allow overriding properties', () => {
      const agent = createTestAgent({
        name: 'Custom Agent',
        status: AgentStatus.Error,
      });

      expect(agent.name).toBe('Custom Agent');
      expect(agent.status).toBe(AgentStatus.Error);
    });

    it('should generate unique IDs for each agent', () => {
      const agent1 = createTestAgent();
      const agent2 = createTestAgent();

      expect(agent1.id).not.toBe(agent2.id);
      expect(agent1.workspaceId).not.toBe(agent2.workspaceId);
    });
  });

  describe('createTestMessage', () => {
    it('should create a valid message with defaults', () => {
      const message = createTestMessage();

      expect(message.id).toBeDefined();
      expect(message.id).toMatch(/^msg_/);
      expect(message.role).toBe('user');
      expect(message.contentBlocks).toBeDefined();
      expect(message.contentBlocks?.[0]).toMatchObject({ type: 'text' });
      expect(message.timestamp).toBeInstanceOf(Date);
      expect(message.turnNumber).toBe(1);
      expect(message.isStreaming).toBe(false);
    });

    it('should allow overriding properties', () => {
      const message = createTestMessage({
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Test response' }],
      });

      expect(message.role).toBe('assistant');
      expect(message.contentBlocks?.[0]).toEqual({
        type: 'text',
        text: 'Test response',
      });
    });
  });

  describe('createTestContentBlock', () => {
    it('should create a text content block', () => {
      const block = createTestContentBlock();

      expect(block.type).toBe('text');
      expect(block.text).toBeDefined();
    });
  });

  describe('createTestToolUseBlock', () => {
    it('should create a tool use block', () => {
      const block = createTestToolUseBlock();

      expect(block.type).toBe('tool_use');
      expect(block.id).toBeDefined();
      expect(block.name).toBeDefined();
      expect(block.input).toBeDefined();
    });
  });

  describe('createTestToolResultBlock', () => {
    it('should create a tool result block', () => {
      const block = createTestToolResultBlock();

      expect(block.type).toBe('tool_result');
      expect(block.tool_use_id).toBeDefined();
      expect(block.content).toBeDefined();
      expect(block.is_error).toBe(false);
    });
  });
});
