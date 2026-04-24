import { eventCollector, AgentEventType } from './event-collector-client';
import { Logger } from '../../shared/logger';

export class ObservabilityService {
  private logger = new Logger('ObservabilityService');

   
  async ensureWorkspaceInitialized(_workspaceId: string): Promise<void> {
    // No-op: Redux handles event initialization now
  }

  async trackAgentStart(params: {
    workspaceId: string;
    agentId: string;
    name: string;
    model?: string;
    provider?: string;
    instruction?: string;
    systemPrompt?: string;
  }): Promise<void> {
    await this.ensureWorkspaceInitialized(params.workspaceId);
    // Sessions are now handled by provenance context


    eventCollector.setContext({ agentId: params.agentId, workspaceId: params.workspaceId });

    // Include instruction/rules in the data
    const data: any = {};

    // Check both instruction and systemPrompt for rules
    const hasInstructionRules = params.instruction && params.instruction.length > 500;
    const hasSystemPromptRules = params.systemPrompt && params.systemPrompt.length > 500;

    if (params.instruction) {
      // Truncate instruction for preview if it's too long (likely rules content)
      data.instructionPreview = params.instruction.slice(0, 200);
      data.instruction = params.instruction;
    }
    if (params.systemPrompt) {
      data.systemPromptPreview = params.systemPrompt.slice(0, 200);
      data.systemPrompt = params.systemPrompt;
    }

    // Set hasRules if either instruction or systemPrompt contains rules
    data.hasRules = hasInstructionRules || hasSystemPromptRules;

    await eventCollector.collect({
      type: AgentEventType.AGENT_STARTED,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      actor: { type: 'agent', id: params.agentId, name: params.name, model: params.model },
      data,
      metadata: {},
    });
  }

  async trackAgentCompleted(params: { workspaceId: string; agentId: string }): Promise<void> {
    try {
      // Sessions are now handled by provenance context
    } catch (e) {
      this.logger.error('Error in trackAgentCompleted', e as Error);
    }

    await eventCollector.collect({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      actor: { type: 'agent', id: params.agentId },
      data: {},
    });
  }

  async trackMessage(params: {
    workspaceId: string;
    agentId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
  }): Promise<void> {
    await eventCollector.collect({
      type: params.role === 'user' ? AgentEventType.MESSAGE_SENT : AgentEventType.MESSAGE_RECEIVED,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      actor: { type: params.role === 'user' ? 'user' : 'agent', id: params.agentId },
      data: { contentPreview: params.content.slice(0, 200) },
    });
  }

  async trackError(params: { workspaceId: string; agentId: string; error: Error }): Promise<void> {
    await eventCollector.collect({
      type: AgentEventType.AGENT_ERROR,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      actor: { type: 'agent', id: params.agentId },
      data: { message: params.error.message },
      metadata: { error: params.error.message, stackTrace: params.error.stack },
    });
  }

  async trackToolCall(params: {
    workspaceId: string;
    agentId: string;
    toolName: string;
    toolKind?: string;
    command?: string;
    input?: any;
    status: 'started' | 'completed' | 'error';
    output?: any;
    error?: string;
  }): Promise<void> {
    const eventType =
      params.status === 'started'
        ? AgentEventType.TOOL_CALL_STARTED
        : params.status === 'completed'
          ? AgentEventType.TOOL_CALL_COMPLETED
          : AgentEventType.TOOL_CALL_ERROR;

    const data: any = {
      toolName: params.toolName,
      toolKind: params.toolKind,
    };

    // Include terminal command if present
    if (params.command) {
      data.command = params.command;
    }

    // Include full input/output in data field for visibility
    if (params.status === 'started' && params.input) {
      data.input = params.input;
    } else if (params.status === 'completed' && params.output) {
      data.output =
        typeof params.output === 'string' && params.output.length > 500
          ? `${params.output.substring(0, 500)}...`
          : params.output;
      // Store full output separately if truncated
      if (typeof params.output === 'string' && params.output.length > 500) {
        data.fullOutput = params.output;
      }
    } else if (params.status === 'error' && params.error) {
      data.error = params.error;
    }

    // Use proper metadata fields
    const metadata: any = {};
    if (params.status === 'error' && params.error) {
      metadata.error = params.error;
    }

    await eventCollector.collect({
      type: eventType,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      actor: { type: 'agent', id: params.agentId },
      data,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }
}

export const observability = new ObservabilityService();
