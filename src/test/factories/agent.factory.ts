/**
 * Agent Factory
 *
 * Creates consistent test data for agent-related tests.
 * Uses faker for realistic data generation.
 */

import { v4 as uuidv4 } from 'uuid';
import { createToolCallId } from '$shared/types/branded-ids';
import { faker } from '@faker-js/faker';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { AgentSession, AgentMessage, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';

/**
 * Creates a test agent session with sensible defaults
 */
export function createTestAgent(overrides?: Partial<AgentSession>): AgentSession {
  const now = new Date();
  return {
    id: unifiedIdService.generateAgentId(),
    backendSessionId: null,
    workspaceId: unifiedIdService.generateWorkspaceId(),
    name: `${faker.company.name()} Agent`,
    status: AgentStatus.Active,
    messages: [],
    model: 'claude-3-opus',
    createdAt: now,
    updatedAt: now,
    lastActivity: now,
    isStreaming: false,
    isProcessing: false,
    isInitialAgent: false,
    isBackground: false,
    ...overrides,
  };
}

/**
 * Creates a test agent message with sensible defaults
 */
export function createTestMessage(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: unifiedIdService.generateMessageId(),
    role: 'user',
    contentBlocks: [{ type: 'text' as const, text: faker.lorem.sentence() }],
    timestamp: new Date(),
    turnNumber: 1,
    isStreaming: false,
    ...overrides,
  };
}

/**
 * Creates a test content block
 */
export function createTestContentBlock(overrides?: Partial<ContentBlock>): ContentBlock {
  return {
    type: 'text',
    text: faker.lorem.paragraph(),
    ...overrides,
  };
}

/**
 * Creates a test tool use block
 */
export function createTestToolUseBlock(overrides?: Partial<ContentBlock>): ContentBlock {
  return {
    type: 'tool_use',
    id: createToolCallId(`tool_${uuidv4()}`),
    name: faker.word.verb(),
    input: { description: faker.lorem.sentence() },
    ...overrides,
  };
}

/**
 * Creates a test tool result block
 */
export function createTestToolResultBlock(overrides?: Partial<ContentBlock>): ContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: createToolCallId(`tool_${uuidv4()}`),
    content: faker.lorem.paragraph(),
    is_error: false,
    ...overrides,
  };
}
