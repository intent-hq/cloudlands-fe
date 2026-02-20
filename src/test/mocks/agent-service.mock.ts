/**
 * Mock Agent Service for Testing
 *
 * Provides mock implementations of agent services for testing.
 */

import type { AgentSession, AgentMessage, ContentBlock } from '$shared/types';
import { AgentStatus } from '$shared/types';
import * as BrandedIds from '$shared/types/branded-ids';
import { v4 as uuidv4 } from 'uuid';

export interface MockAgentOptions {
  name?: string;
  model?: string;
  systemPrompt?: string;
  workspaceId?: string;
}

export class MockAgentService {
  private agents = new Map<string, AgentSession>();
  private messages = new Map<string, AgentMessage[]>();
  private callLog: Array<{ method: string; args: any; timestamp: number }> = [];

  /**
   * Create a new agent
   */
  async createAgent(options: MockAgentOptions): Promise<AgentSession> {
    const agentId = BrandedIds.AgentId(`agent-${uuidv4()}`);
    const backendSessionId = BrandedIds.AgentId(`agent-${uuidv4()}`);

    const agent: AgentSession = {
      id: agentId,
      backendSessionId,
      workspaceId: BrandedIds.WorkspaceId(options.workspaceId || 'test-workspace'),
      name: options.name || 'Test Agent',
      status: AgentStatus.Active,
      messages: [],
      model: options.model || 'claude-opus',
      systemPrompt: options.systemPrompt || 'You are a helpful assistant.',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.agents.set(agentId, agent);
    this.messages.set(agentId, []);
    this.logCall('createAgent', options);

    return agent;
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<AgentSession | null> {
    this.logCall('getAgent', { agentId });
    return this.agents.get(agentId) || null;
  }

  /**
   * List all agents
   */
  async listAgents(workspaceId?: string): Promise<AgentSession[]> {
    this.logCall('listAgents', { workspaceId });
    const agents = Array.from(this.agents.values());

    if (workspaceId) {
      return agents.filter((a) => a.workspaceId === workspaceId);
    }

    return agents;
  }

  /**
   * Delete an agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    this.logCall('deleteAgent', { agentId });
    this.agents.delete(agentId);
    this.messages.delete(agentId);
  }

  /**
   * Send a message to an agent
   */
  async sendMessage(agentId: string, content: string): Promise<AgentMessage> {
    this.logCall('sendMessage', { agentId, content });

    const message: AgentMessage = {
      id: `msg-${uuidv4()}`,
      role: 'user',
      contentBlocks: [{ type: 'text' as const, text: content }],
      timestamp: new Date(),
    };

    const messages = this.messages.get(agentId) || [];
    messages.push(message);
    this.messages.set(agentId, messages);

    return message;
  }

  /**
   * Get messages for an agent
   */
  async getMessages(agentId: string): Promise<AgentMessage[]> {
    this.logCall('getMessages', { agentId });
    return this.messages.get(agentId) || [];
  }

  /**
   * Add a message to an agent
   */
  async addMessage(agentId: string, message: AgentMessage): Promise<void> {
    this.logCall('addMessage', { agentId, messageId: message.id });
    const messages = this.messages.get(agentId) || [];
    messages.push(message);
    this.messages.set(agentId, messages);
  }

  /**
   * Clear all agents and messages
   */
  clear(): void {
    this.agents.clear();
    this.messages.clear();
    this.callLog = [];
  }

  /**
   * Get call log for testing
   */
  getCallLog() {
    return [...this.callLog];
  }

  /**
   * Record a method call
   */
  private logCall(method: string, args: any): void {
    this.callLog.push({ method, args, timestamp: Date.now() });
  }
}

export function createMockAgentService(): MockAgentService {
  return new MockAgentService();
}
