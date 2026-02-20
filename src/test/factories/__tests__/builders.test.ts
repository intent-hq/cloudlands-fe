/**
 * Builder Pattern Tests
 *
 * Tests for fluent builder patterns.
 */

import { describe, it, expect } from 'vitest';
import { AgentBuilder, MessageBuilder } from '../builders';
import { AgentStatus } from '$shared/types';

describe('AgentBuilder', () => {
  it('should create an agent with fluent API', () => {
    const agent = new AgentBuilder()
      .withName('Test Agent')
      .withStatus(AgentStatus.Active)
      .withModel('gpt-4')
      .asInitialAgent()
      .build();

    expect(agent.name).toBe('Test Agent');
    expect(agent.status).toBe(AgentStatus.Active);
    expect(agent.model).toBe('gpt-4');
    expect(agent.isInitialAgent).toBe(true);
  });

  it('should add messages to agent', () => {
    const agent = new AgentBuilder().withMessages(3).build();

    expect(agent.messages).toHaveLength(3);
    expect(agent.messages[0].role).toBe('user');
    expect(agent.messages[1].role).toBe('assistant');
    expect(agent.messages[2].role).toBe('user');
  });

  it('should support streaming and processing states', () => {
    const agent = new AgentBuilder().streaming().processing().build();

    expect(agent.isStreaming).toBe(true);
    expect(agent.isProcessing).toBe(true);
  });

  it('should support background agents', () => {
    const agent = new AgentBuilder().asBackgroundAgent().build();

    expect(agent.isBackground).toBe(true);
  });

  it('should allow chaining multiple operations', () => {
    const agent = new AgentBuilder()
      .withName('Complex Agent')
      .withSystemPrompt('You are helpful')
      .withMessages(2)
      .asInitialAgent()
      .streaming()
      .build();

    expect(agent.name).toBe('Complex Agent');
    expect(agent.systemPrompt).toBe('You are helpful');
    expect(agent.messages).toHaveLength(2);
    expect(agent.isInitialAgent).toBe(true);
    expect(agent.isStreaming).toBe(true);
  });
});

describe('MessageBuilder', () => {
  it('should create a message with fluent API', () => {
    const message = new MessageBuilder()
      .withRole('assistant')
      .withContent('Hello!')
      .withTurnNumber(5)
      .build();

    expect(message.role).toBe('assistant');
    expect(message.contentBlocks?.[0]).toEqual({
      type: 'text',
      text: 'Hello!',
    });
    expect(message.turnNumber).toBe(5);
  });

  it('should add content blocks', () => {
    const message = new MessageBuilder().withContentBlocks(2).build();

    expect(message.contentBlocks).toHaveLength(2);
  });

  it('should support streaming messages', () => {
    const message = new MessageBuilder().streaming().build();

    expect(message.isStreaming).toBe(true);
  });

  it('should support error messages', () => {
    const message = new MessageBuilder().withError('Something went wrong').build();

    expect(message.error).toBe('Something went wrong');
  });

  it('should allow chaining multiple operations', () => {
    const message = new MessageBuilder()
      .withRole('assistant')
      .withContent('Complex response')
      .withTurnNumber(3)
      .withContentBlocks(2)
      .withMetadata({ model: 'gpt-4' })
      .build();

    expect(message.role).toBe('assistant');
    expect(message.turnNumber).toBe(3);
    expect(message.contentBlocks).toHaveLength(2);
    expect(message.metadata?.model).toBe('gpt-4');
  });
});
