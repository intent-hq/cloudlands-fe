/**
 * Client-side Event Collector for Agent Observability
 *
 * This is a browser-compatible version that sends events via IPC
 * instead of using Node.js EventEmitter
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger';
import type { EventActor } from '../events/types';

/**
 * Core event types emitted by agents
 */
export enum AgentEventType {
  // Lifecycle events
  AGENT_STARTED = 'agent:started',
  AGENT_COMPLETED = 'agent:completed',
  AGENT_ERROR = 'agent:error',
  AGENT_CANCELLED = 'agent:cancelled',
  AGENT_CREATED = 'agent:created',
  AGENT_DELETED = 'agent:deleted',

  // Session events
  SESSION_CREATED = 'session:created',
  SESSION_RESUMED = 'session:resumed',
  SESSION_DELETED = 'session:deleted',

  // Conversation events
  TURN_STARTED = 'turn:started',
  TURN_COMPLETED = 'turn:completed',
  MESSAGE_RECEIVED = 'message:received',
  MESSAGE_SENT = 'message:sent',
  THINKING_STARTED = 'thinking:started',
  THINKING_STOPPED = 'thinking:stopped',

  // Tool events
  TOOL_CALL_STARTED = 'tool:call:started',
  TOOL_CALL_COMPLETED = 'tool:call:completed',
  TOOL_CALL_ERROR = 'tool:call:error',
  TOOL_OUTPUT_STREAMED = 'tool:output:streamed',

  // File system events
  FILE_CREATED = 'file:created',
  FILE_MODIFIED = 'file:modified',
  FILE_DELETED = 'file:deleted',
  FILE_DIFF_GENERATED = 'file:diff:generated',

  // Git events
  GIT_COMMIT = 'git:commit',
  GIT_PUSH = 'git:push',
  GIT_BRANCH_CREATED = 'git:branch:created',
  GIT_PR_CREATED = 'git:pr:created',

  // Performance events
  TOKEN_USAGE = 'perf:token:usage',
  LATENCY_MEASURED = 'perf:latency',
  COST_CALCULATED = 'perf:cost',
  PERFORMANCE_METRIC = 'perf:metric',

  // Decision events
  DECISION_MADE = 'decision:made',
  PLAN_CREATED = 'plan:created',
  PLAN_UPDATED = 'plan:updated',
  TASK_CREATED = 'task:created',
  TASK_COMPLETED = 'task:completed',

  // Error events
  ERROR_OCCURRED = 'error:occurred',
  ERROR_RECOVERED = 'error:recovered',
  RETRY_ATTEMPTED = 'retry:attempted',

  // Custom events
  AUGGIE_COMMAND_EXECUTED = 'auggie:command:executed',
}

/**
 * Filter for agent observability events.
 * Note: This is different from EventFilter in events/types.ts which is a generic field-based filter.
 */
export interface AgentEventFilter {
  types?: AgentEventType[];
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  actorType?: EventActor['type'];
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  search?: string;
}

// EventActor is imported from '../events/types' - the canonical definition
export type { EventActor } from '../events/types';

/**
 * Core event structure
 */
export interface AgentEvent {
  // Core fields
  id: string;
  type: AgentEventType;
  timestamp: string;
  sessionId: string;
  agentId: string;
  workspaceId?: string;

  // Correlation
  parentEventId?: string;
  correlationId?: string;
  turnId?: string;
  toolCallId?: string;

  // Actor information
  actor: EventActor;

  // Event-specific data
  data: Record<string, any>;

  // Metadata
  metadata?: {
    model?: string;
    temperature?: number;
    cost?: number;
    tokenUsage?: {
      input: number;
      output: number;
      total: number;
    };
    duration?: number;
    error?: string;
    stackTrace?: string;
  };

  // UI hints
  ui?: {
    icon?: string;
    color?: string;
    collapsed?: boolean;
    important?: boolean;
  };
}

/**
 * Client-side event collector that sends events via IPC
 */
export class ClientEventCollector {
  private static instance: ClientEventCollector;

  private currentSession: string;
  private currentAgent: string;
  private currentWorkspace?: string;
  private correlationStack: string[] = [];
  private isEnabled: boolean = true;

  private constructor() {
    this.currentSession = uuidv4();
    this.currentAgent = 'unknown';
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ClientEventCollector {
    if (!ClientEventCollector.instance) {
      ClientEventCollector.instance = new ClientEventCollector();
    }
    return ClientEventCollector.instance;
  }

  /**
   * Set current context
   */
  setContext(context: { sessionId?: string; agentId?: string; workspaceId?: string }): void {
    if (context.sessionId) this.currentSession = context.sessionId;
    if (context.agentId) this.currentAgent = context.agentId;
    if (context.workspaceId) this.currentWorkspace = context.workspaceId;
  }

  /**
   * Push a correlation context
   */
  pushCorrelation(correlationId: string): void {
    this.correlationStack.push(correlationId);
  }

  /**
   * Pop a correlation context
   */
  popCorrelation(): string | undefined {
    return this.correlationStack.pop();
  }

  /**
   * Enable event collection
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * Disable event collection
   */
  disable(): void {
    this.isEnabled = false;
  }

  /**
   * Collect an event and send via IPC
   */
  async collect(event: Partial<AgentEvent>): Promise<AgentEvent> {
    if (!this.isEnabled) {
      // Return a dummy event if disabled
      return this.enrichEvent(event);
    }

    const fullEvent = this.enrichEvent(event);

    // Send to main process via IPC if available
    if (typeof window !== 'undefined' && window.electronAPI) {
      try {
        //         await window.electronAPI.invoke('observability:collect-event', fullEvent); // DISABLED: Channel not registered
      } catch (error) {
        logger.error('Failed to send event via IPC:', error);
      }
    } else {
      // Just log if not in Electron environment
      logger.debug('Observability event:', fullEvent);
    }

    return fullEvent;
  }

  /**
   * Track an event (alias for collect with type and data)
   */
  async track(type: AgentEventType, data?: any): Promise<AgentEvent> {
    return this.collect({
      type,
      data: data || {},
    });
  }

  /**
   * Enrich event with default values and context
   */
  private enrichEvent(event: Partial<AgentEvent>): AgentEvent {
    const currentCorrelation = this.correlationStack[this.correlationStack.length - 1];

    return {
      id: event.id || uuidv4(),
      timestamp: event.timestamp || new Date().toISOString(),
      sessionId: event.sessionId || this.currentSession,
      agentId: event.agentId || this.currentAgent,
      workspaceId: event.workspaceId || this.currentWorkspace,
      correlationId: event.correlationId || currentCorrelation,
      type: event.type || AgentEventType.ERROR_OCCURRED,
      actor: event.actor || { type: 'system', id: 'system' },
      data: event.data || {},
      ...event,
    } as AgentEvent;
  }
}

// Export singleton instance
export const eventCollector = ClientEventCollector.getInstance();
