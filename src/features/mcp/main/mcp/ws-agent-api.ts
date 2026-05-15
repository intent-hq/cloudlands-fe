import { Logger } from '$shared/logger';

import type { ToolCall, ToolResult } from './protocol';
import type { AgentInfo } from './agent-interaction-tools';
import {
  CreateAgentTool,
  DelegateTaskTool,
  SendMessageToAgentTool,
  SendMessageToTaskAgentTool,
  SubscribeToEventsTool,
  UnsubscribeFromEventsTool,
  WakeOrCreateTaskAgentTool,
  ReportToParentTool,
} from './agent-interaction-tools';
import { agentPersistence } from '$features/agent/main/agent-persistence';
import {
  AgentId,
  WorkspaceId,
} from '$shared/types/branded-ids';
import { getMainState } from '../../../../store/main/redux-store-bridge';
import { selectAgentStatus } from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';

const logger = new Logger('WsAgentApi');

type MessagePriority = 'high' | 'normal' | 'interrupt';
type WaitMode = 'immediate' | 'after_all';

interface CreateAgentOptions {
  taskNoteId?: string;
  specialist?: string;
  model?: string;
  behaviorPrompt?: string;
  createLinkedNote?: boolean;
  noteContent?: string;
  parentNoteId?: string;
  isBackground?: boolean;
}

interface DelegateAgentOptions {
  taskNoteId?: string;
  noteId?: string;
  taskText?: string;
  agentInstructions?: string;
  specialist?: string;
  model?: string;
  behaviorPrompt?: string;
  waitMode?: WaitMode;
  skipAutoCommit?: boolean;
}

interface SubscribeOptions {
  excludeSelf?: boolean;
  batchWindow?: number;
}

interface ReadConversationOptions {
  lastN?: number;
  startTurn?: number;
  endTurn?: number;
  includeToolCalls?: boolean;
}

interface ExecutableTool {
  execute(call: ToolCall): Promise<ToolResult>;
}

function getTextContent(result: ToolResult): string {
  return result.content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

async function executeTool(
  tool: ExecutableTool,
  name: string,
  args: Record<string, unknown>,
  call: ToolCall,
): Promise<ToolResult> {
  const result = await tool.execute({ name, arguments: args, context: call.context });

  if (result.isError) {
    throw new Error(getTextContent(result) || `Tool ${name} failed`);
  }

  return result;
}

function buildToolResponse(result: ToolResult, fallback: Record<string, unknown> = {}) {
  const text = getTextContent(result);
  return {
    ...fallback,
    ...(result.metadata ?? {}),
    ...(text ? { text } : {}),
  };
}

function filterMessageContentBlocks(message: any, includeToolCalls: boolean) {
  if (includeToolCalls || !Array.isArray(message.contentBlocks)) {
    return message;
  }

  return {
    ...message,
    contentBlocks: message.contentBlocks.filter(
      (block: any) => block.type !== 'tool_use' && block.type !== 'tool_result',
    ),
  };
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

export function buildAgentApi(workspaceId: string, workspacePath: string, call: ToolCall) {
  return {
    async create(name: string, message: string, opts: CreateAgentOptions = {}) {
      logger.info('ws.agent.create', { workspaceId, name, taskNoteId: opts.taskNoteId });

      const result = await executeTool(
        new CreateAgentTool(workspaceId, workspacePath),
        'create_agent',
        {
          name,
          initialMessage: message,
          ...opts,
        },
        call,
      );

      return buildToolResponse(result, { id: result.metadata?.agentId, ok: true });
    },

    async delegate(opts: DelegateAgentOptions) {
      logger.info('ws.agent.delegate', {
        workspaceId,
        taskNoteId: opts.taskNoteId,
        noteId: opts.noteId,
        taskText: opts.taskText,
      });

      const result = await executeTool(
        new DelegateTaskTool(workspaceId, workspacePath),
        'delegate_task',
        {
          ...opts,
          ...(opts.waitMode ? { wait_mode: opts.waitMode } : {}),
        },
        call,
      );

      return buildToolResponse(result, { ok: true });
    },

    async send(agentId: string, message: string, priority: MessagePriority = 'normal') {
      logger.info('ws.agent.send', { workspaceId, agentId, priority });

      const result = await executeTool(
        new SendMessageToAgentTool(workspaceId),
        'send_message_to_agent',
        { agentId, message, priority },
        call,
      );

      return buildToolResponse(result, { ok: true, agentId });
    },

    async sendToTask(
      taskNoteId: string,
      message: string,
      priority: MessagePriority = 'normal',
    ) {
      logger.info('ws.agent.sendToTask', { workspaceId, taskNoteId, priority });

      const result = await executeTool(
        new SendMessageToTaskAgentTool(workspaceId),
        'send_message_to_task_agent',
        { taskNoteId, message, priority },
        call,
      );

      return buildToolResponse(result, { ok: true, taskNoteId });
    },

    async subscribe(eventTypes: string[], opts: SubscribeOptions = {}) {
      logger.info('ws.agent.subscribe', { workspaceId, eventTypes });

      const result = await executeTool(
        new SubscribeToEventsTool(workspaceId),
        'subscribe_to_events',
        {
          eventTypes,
          ...opts,
        },
        call,
      );

      return buildToolResponse(result, { ok: true });
    },

    async unsubscribe(subscriptionId: string) {
      logger.info('ws.agent.unsubscribe', { workspaceId, subscriptionId });

      await executeTool(
        new UnsubscribeFromEventsTool(workspaceId),
        'unsubscribe_from_events',
        { subscriptionId },
        call,
      );

      return { ok: true, subscriptionId };
    },

    async list(includeCompleted: boolean = false): Promise<AgentInfo[]> {
      logger.info('ws.agent.list', { workspaceId, includeCompleted });

      const { AgentBackendHandler } = await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();
      const agents = await handler.listAllAgents(workspaceId);

      return agents
        .map((agent: any) => ({
          id: agent.id,
          name: agent.name,
          status: selectAgentStatus.select(getMainState(), workspaceId, agent.id) || agent.status,
          messageCount: agent.messages?.length || 0,
          taskNoteId: agent.metadata?.taskNoteId,
          createdAt: toOptionalString(agent.createdAt),
          lastActivity: toOptionalString(agent.lastActivity),
        }))
        .filter((agent: AgentInfo) => includeCompleted || !['completed', 'failed'].includes(agent.status));
    },

    async status(agentId: string): Promise<AgentInfo> {
      logger.info('ws.agent.status', { workspaceId, agentId });

      const { AgentBackendHandler } = await import('../../../agent/main/agent-backend-handler.service');
      const handler = AgentBackendHandler.getInstance();
      const agent = await handler.getAgent(agentId);

      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      return {
        id: agent.id,
        name: agent.name,
        status: selectAgentStatus.select(getMainState(), workspaceId, agentId) || agent.status,
        messageCount: agent.messages?.length || 0,
        taskNoteId: agent.metadata?.taskNoteId,
        createdAt: toOptionalString(agent.createdAt),
        lastActivity: toOptionalString(agent.lastActivity),
      };
    },

    async wakeOrCreate(taskNoteId: string, contextMessage: string, model?: string) {
      logger.info('ws.agent.wakeOrCreate', { workspaceId, taskNoteId, hasModel: !!model });

      const result = await executeTool(
        new WakeOrCreateTaskAgentTool(workspaceId, workspacePath),
        'wake_or_create_task_agent',
        { taskNoteId, contextMessage, model },
        call,
      );

      return buildToolResponse(result, { ok: true, taskNoteId });
    },

    async readConversation(agentId: string, opts: ReadConversationOptions = {}) {
      logger.info('ws.agent.readConversation', { workspaceId, agentId, ...opts });

      const loadResult = await agentPersistence.loadAgent(AgentId(agentId), WorkspaceId(workspaceId));
      if (!loadResult.success || !loadResult.data) {
        throw new Error(`Agent "${agentId}" not found or could not be loaded`);
      }

      const agent = loadResult.data;
      const includeToolCalls = opts.includeToolCalls !== false;
      let messages = agent.messages || [];

      if (opts.startTurn !== undefined || opts.endTurn !== undefined) {
        const start = (opts.startTurn || 1) - 1;
        const end = opts.endTurn || messages.length;
        messages = messages.slice(start, end);
      } else if (opts.lastN !== undefined && opts.lastN > 0) {
        messages = messages.slice(-opts.lastN);
      }

      const filteredMessages = messages.map((message: any) =>
        filterMessageContentBlocks(message, includeToolCalls),
      );

      return {
        agentId,
        agentName: agent.name,
        totalMessages: agent.messages?.length || 0,
        returnedMessages: filteredMessages.length,
        taskNoteId: agent.metadata?.taskNoteId,
        messages: filteredMessages,
      };
    },

    async summary(agentId: string) {
      logger.info('ws.agent.summary', { workspaceId, agentId });

      const loadResult = await agentPersistence.loadAgent(AgentId(agentId), WorkspaceId(workspaceId));
      if (!loadResult.success || !loadResult.data) {
        throw new Error(`Agent "${agentId}" not found or could not be loaded`);
      }

      const agent = loadResult.data;
      const messages = agent.messages || [];

      let lastResponse = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role !== 'assistant' || !Array.isArray(message.contentBlocks)) {
          continue;
        }

        lastResponse = message.contentBlocks
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text || '')
          .join(' ');
        break;
      }

      const toolCallCounts: Record<string, number> = {};
      for (const message of messages) {
        if (!Array.isArray(message.contentBlocks)) {
          continue;
        }

        for (const block of message.contentBlocks) {
          if (block.type !== 'tool_use') {
            continue;
          }

          const toolName = (block as any).name || 'unknown';
          toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
        }
      }

      return {
        agentId,
        agentName: agent.name,
        status: agent.status,
        messageCount: messages.length,
        toolCallCounts,
        taskNoteId: agent.metadata?.taskNoteId,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
        ...(lastResponse ? { lastResponse } : {}),
      };
    },

    async reportToParent(report: string) {
      logger.info('ws.agent.reportToParent', { workspaceId, reportLength: report?.length || 0 });

      const result = await executeTool(
        new ReportToParentTool(workspaceId),
        'report_to_parent',
        { report },
        call,
      );

      return buildToolResponse(result, { ok: true });
    },
  };
}