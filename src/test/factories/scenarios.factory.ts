/**
 * Scenario Factory
 *
 * Creates complete test scenarios with multiple related entities.
 * Useful for integration and end-to-end tests.
 */

import { AgentBuilder, MessageBuilder } from './builders';
import { AgentStatus } from '$shared/types';
import type { AgentSession } from '$shared/types';

/**
 * Creates a complete agent with a conversation history
 */
export function createAgentWithConversation(messageCount: number = 5): AgentSession {
  return new AgentBuilder()
    .withName('Test Agent with Conversation')
    .withMessages(messageCount)
    .build();
}

/**
 * Creates an agent in error state
 */
export function createErrorAgent(): AgentSession {
  return new AgentBuilder()
    .withName('Error Agent')
    .withStatus(AgentStatus.Error)
    .withMessage(
      new MessageBuilder().withRole('assistant').withError('Test error occurred').build(),
    )
    .build();
}

/**
 * Creates an agent that is currently streaming
 */
export function createStreamingAgent(): AgentSession {
  return new AgentBuilder()
    .withName('Streaming Agent')
    .streaming()
    .withMessage(new MessageBuilder().withRole('assistant').streaming().build())
    .build();
}

/**
 * Creates an initial agent (created with workspace)
 */
export function createInitialAgent(): AgentSession {
  return new AgentBuilder().withName('Initial Agent').asInitialAgent().build();
}

/**
 * Creates a background agent
 */
export function createBackgroundAgent(): AgentSession {
  return new AgentBuilder().withName('Background Agent').asBackgroundAgent().build();
}

/**
 * Creates a pending agent (not yet activated)
 */
export function createPendingAgent(): AgentSession {
  return new AgentBuilder().withName('Pending Agent').withStatus(AgentStatus.Pending).build();
}

/**
 * Creates multiple agents for batch testing
 */
export function createMultipleAgents(count: number): AgentSession[] {
  return Array.from({ length: count }, (_, i) =>
    new AgentBuilder().withName(`Agent ${i + 1}`).build(),
  );
}
