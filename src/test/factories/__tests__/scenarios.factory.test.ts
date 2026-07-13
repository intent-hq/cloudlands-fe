/**
 * Scenario Factory Tests
 *
 * Tests for scenario factory functions.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  createAgentWithConversation,
  createErrorAgent,
  createStreamingAgent,
  createInitialAgent,
  createBackgroundAgent,
  createPendingAgent,
  createMultipleAgents,
} from '../scenarios.factory';
import { AgentStatus } from '$shared/types';

describe('Scenario Factory', () => {
  describe('createAgentWithConversation', () => {
    it('should create agent with conversation history', () => {
      const agent = createAgentWithConversation(5);

      expect(agent.messages).toHaveLength(5);
      expect(agent.messages[0].role).toBe('user');
      expect(agent.messages[1].role).toBe('assistant');
    });

    it('should default to 5 messages', () => {
      const agent = createAgentWithConversation();

      expect(agent.messages).toHaveLength(5);
    });
  });

  describe('createErrorAgent', () => {
    it('should create agent in error state', () => {
      const agent = createErrorAgent();

      expect(agent.status).toBe(AgentStatus.Error);
      expect(agent.messages).toHaveLength(1);
      expect(agent.messages[0].error).toBe('Test error occurred');
    });
  });

  describe('createStreamingAgent', () => {
    it('should create streaming agent', () => {
      const agent = createStreamingAgent();

      expect(agent.isStreaming).toBe(true);
      expect(agent.messages[0].isStreaming).toBe(true);
    });
  });

  describe('createInitialAgent', () => {
    it('should create initial agent', () => {
      const agent = createInitialAgent();

      expect(agent.isInitialAgent).toBe(true);
    });
  });

  describe('createBackgroundAgent', () => {
    it('should create background agent', () => {
      const agent = createBackgroundAgent();

      expect(agent.isBackground).toBe(true);
    });
  });

  describe('createPendingAgent', () => {
    it('should create pending agent', () => {
      const agent = createPendingAgent();

      expect(agent.status).toBe(AgentStatus.Pending);
    });
  });

  describe('createMultipleAgents', () => {
    it('should create multiple agents', () => {
      const agents = createMultipleAgents(3);

      expect(agents).toHaveLength(3);
      expect(agents[0].name).toBe('Agent 1');
      expect(agents[1].name).toBe('Agent 2');
      expect(agents[2].name).toBe('Agent 3');
    });

    it('should create unique agents', () => {
      const agents = createMultipleAgents(3);

      expect(agents[0].id).not.toBe(agents[1].id);
      expect(agents[1].id).not.toBe(agents[2].id);
    });
  });
});
