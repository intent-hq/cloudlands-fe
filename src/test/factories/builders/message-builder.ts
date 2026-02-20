/**
 * Message Builder
 *
 * Fluent builder pattern for creating complex test messages.
 */

import { faker } from '@faker-js/faker';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { AgentMessage, ContentBlock, ToolCall } from '$shared/types';
import { createTestContentBlock, createTestToolUseBlock } from '../agent.factory';

export class MessageBuilder {
  private message: AgentMessage;

  constructor() {
    this.message = {
      id: unifiedIdService.generateMessageId(),
      role: 'user',
      contentBlocks: [{ type: 'text' as const, text: faker.lorem.sentence() }],
      timestamp: new Date(),
      turnNumber: 1,
      isStreaming: false,
      toolCalls: [],
    };
  }

  withRole(role: 'user' | 'assistant' | 'system'): MessageBuilder {
    this.message.role = role;
    return this;
  }

  withContent(content: string): MessageBuilder {
    this.message.contentBlocks = [{ type: 'text' as const, text: content }];
    return this;
  }

  withTurnNumber(turnNumber: number): MessageBuilder {
    this.message.turnNumber = turnNumber;
    return this;
  }

  withContentBlock(block: ContentBlock): MessageBuilder {
    if (!this.message.contentBlocks) {
      this.message.contentBlocks = [];
    }
    this.message.contentBlocks.push(block);
    return this;
  }

  withContentBlocks(count: number): MessageBuilder {
    this.message.contentBlocks = Array.from({ length: count }, () => createTestContentBlock());
    return this;
  }

  withToolCall(toolCall: ToolCall): MessageBuilder {
    if (!this.message.toolCalls) {
      this.message.toolCalls = [];
    }
    this.message.toolCalls.push(toolCall);
    return this;
  }

  streaming(): MessageBuilder {
    this.message.isStreaming = true;
    return this;
  }

  withError(error: string): MessageBuilder {
    this.message.error = error;
    return this;
  }

  withMetadata(metadata: Record<string, any>): MessageBuilder {
    this.message.metadata = metadata;
    return this;
  }

  build(): AgentMessage {
    return { ...this.message };
  }
}
