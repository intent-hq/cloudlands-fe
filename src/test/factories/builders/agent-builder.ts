/**
 * Agent Builder
 *
 * Fluent builder pattern for creating complex test agents.
 */

import { faker } from '@faker-js/faker';
import { unifiedIdService } from '$shared/services/unified-id.service';
import type { AgentSession, AgentMessage } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { createTestMessage } from '../agent.factory';

export class AgentBuilder {
  private agent: AgentSession;

  constructor() {
    const now = new Date();
    this.agent = {
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
    };
  }

  withName(name: string): AgentBuilder {
    this.agent.name = name;
    return this;
  }

  withStatus(status: AgentStatus): AgentBuilder {
    this.agent.status = status;
    return this;
  }

  withMessages(count: number): AgentBuilder {
    this.agent.messages = Array.from({ length: count }, (_, i) =>
      createTestMessage({ role: i % 2 === 0 ? 'user' : 'assistant', turnNumber: i + 1 }),
    );
    return this;
  }

  withMessage(message: AgentMessage): AgentBuilder {
    this.agent.messages.push(message);
    return this;
  }

  withModel(model: string): AgentBuilder {
    this.agent.model = model;
    return this;
  }

  withSystemPrompt(prompt: string): AgentBuilder {
    this.agent.systemPrompt = prompt;
    return this;
  }

  asInitialAgent(): AgentBuilder {
    this.agent.isInitialAgent = true;
    return this;
  }

  asBackgroundAgent(): AgentBuilder {
    this.agent.isBackground = true;
    return this;
  }

  streaming(): AgentBuilder {
    this.agent.isStreaming = true;
    return this;
  }

  processing(): AgentBuilder {
    this.agent.isProcessing = true;
    return this;
  }

  build(): AgentSession {
    return { ...this.agent };
  }
}
