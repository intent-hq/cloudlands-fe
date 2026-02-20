/**
 * Unified Event Collector for Agent Observability
 *
 * This module provides a centralized event collection system that captures
 * all agent activities and makes them observable through multiple channels.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../shared/logger';
import type { EventActor } from '../events/types';

const logger = new Logger('EventCollector');

/**
 * Core event types emitted by agents
 */
export enum AgentEventType {
  // Lifecycle events
  AGENT_STARTED = 'agent:started',
  AGENT_COMPLETED = 'agent:completed',
  AGENT_ERROR = 'agent:error',
  AGENT_CANCELLED = 'agent:cancelled',

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

/**
 * Event stream for real-time subscriptions
 */
export class EventStream extends EventEmitter {
  public readonly id: string;
  private filter?: AgentEventFilter;

  constructor(filter?: AgentEventFilter) {
    super();
    this.id = uuidv4();
    this.filter = filter;
  }

  /**
   * Check if an event matches the filter
   */
  matches(event: AgentEvent): boolean {
    if (!this.filter) return true;

    if (this.filter.types && !this.filter.types.includes(event.type)) {
      return false;
    }

    if (this.filter.sessionId && event.sessionId !== this.filter.sessionId) {
      return false;
    }

    if (this.filter.agentId && event.agentId !== this.filter.agentId) {
      return false;
    }

    if (this.filter.workspaceId && event.workspaceId !== this.filter.workspaceId) {
      return false;
    }

    if (this.filter.actorType && event.actor.type !== this.filter.actorType) {
      return false;
    }

    if (this.filter.timeRange) {
      const eventTime = new Date(event.timestamp);
      if (this.filter.timeRange.start && eventTime < this.filter.timeRange.start) {
        return false;
      }
      if (this.filter.timeRange.end && eventTime > this.filter.timeRange.end) {
        return false;
      }
    }

    if (this.filter.search) {
      const searchStr = this.filter.search.toLowerCase();
      const eventStr = JSON.stringify(event).toLowerCase();
      if (!eventStr.includes(searchStr)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Emit an event if it matches the filter
   */
  emitIfMatches(event: AgentEvent): void {
    if (this.matches(event)) {
      this.emit('event', event);
    }
  }
}

/**
 * Unified event collector for all agents
 */
export class UnifiedEventCollector extends EventEmitter {
  private static instance: UnifiedEventCollector;

  private buffer: AgentEvent[] = [];
  private streams: Map<string, EventStream> = new Map();
  private currentSession: string;
  private currentAgent: string;
  private currentWorkspace?: string;
  private correlationStack: string[] = [];

  // Configuration
  private readonly maxBufferSize = 10000;
  private readonly flushInterval = 5000; // 5 seconds
  private flushTimer?: NodeJS.Timeout;

  private constructor() {
    super();
    this.currentSession = uuidv4();
    this.currentAgent = 'unknown';
    this.startFlushTimer();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UnifiedEventCollector {
    if (!UnifiedEventCollector.instance) {
      UnifiedEventCollector.instance = new UnifiedEventCollector();
    }
    return UnifiedEventCollector.instance;
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
   * Collect an event
   */
  collect(event: Partial<AgentEvent>): AgentEvent {
    const fullEvent = this.enrichEvent(event);

    // Add to buffer
    this.buffer.push(fullEvent);

    // Check buffer size
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }

    // Broadcast to streams
    this.broadcast(fullEvent);

    // Emit for local listeners
    this.emit('event', fullEvent);

    logger.debug('Event collected', {
      id: fullEvent.id,
      type: fullEvent.type,
      actor: fullEvent.actor.type,
    });

    return fullEvent;
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

  /**
   * Broadcast event to all matching streams
   */
  private broadcast(event: AgentEvent): void {
    for (const stream of this.streams.values()) {
      stream.emitIfMatches(event);
    }
  }

  /**
   * Subscribe to events with optional filter
   */
  subscribe(filter?: AgentEventFilter): EventStream {
    const stream = new EventStream(filter);
    this.streams.set(stream.id, stream);

    // Clean up on close
    stream.once('close', () => {
      this.streams.delete(stream.id);
    });

    return stream;
  }

  /**
   * Flush buffered events
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    try {
      // Emit batch for persistence
      this.emit('flush', events);

      logger.debug('Flushed events', { count: events.length });
    } catch (error) {
      logger.error('Failed to flush events', error as Error);
      // Re-add to buffer if flush failed
      this.buffer.unshift(...events);
    }
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch((error) => {
        logger.error('Auto-flush failed', error as Error);
      });
    }, this.flushInterval);
  }

  /**
   * Stop and clean up
   */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    await this.flush();

    for (const stream of this.streams.values()) {
      stream.emit('close');
    }

    this.streams.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance
export const eventCollector = UnifiedEventCollector.getInstance();
