/**
 * Provenance Context Manager
 *
 * Manages execution context stack for tracking the origin of changes.
 * Maintains a stack of contexts (for nested operations) and provides
 * access to the current context for all subsystems.
 */

import { ProvenanceInfo } from '$shared/types';
import { Logger } from '../../../../shared/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('ProvenanceContextManager');
export interface ProvenanceContext extends ProvenanceInfo {
  contextId: string;
  createdAt: string;
}

/**
 * Manages provenance context stack
 */
export class ProvenanceContextManager {
  private contextStack: ProvenanceContext[] = [];
  private contextMap: Map<string, ProvenanceContext> = new Map();
  private debug: boolean = false;

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
  }

  /**
   * Get singleton instance
   * Note: Delegates to getProvenanceContextManager() to ensure single instance
   */
  static getInstance(options?: { debug?: boolean }): ProvenanceContextManager {
    return getProvenanceContextManager(options);
  }

  /**
   * Push a new context onto the stack
   */
  pushContext(context: ProvenanceContext): string {
    this.contextStack.push(context);
    this.contextMap.set(context.contextId, context);

    if (this.debug) {
      logger.info(`[ProvenanceContextManager] Pushed context ${context.contextId}`, {
        source: context.source,
        agentName: context.agent?.name,
        stackDepth: this.contextStack.length,
      });
    }

    return context.contextId;
  }

  /**
   * Pop the current context from the stack
   */
  popContext(): ProvenanceContext | undefined {
    const context = this.contextStack.pop();

    if (context && this.debug) {
      logger.info(`[ProvenanceContextManager] Popped context ${context.contextId}`, {
        stackDepth: this.contextStack.length,
      });
    }

    return context;
  }

  /**
   * Get the current context (top of stack)
   */
  getCurrentContext(): ProvenanceContext | undefined {
    return this.contextStack[this.contextStack.length - 1];
  }

  /**
   * Get context by ID
   */
  getContext(contextId: string): ProvenanceContext | undefined {
    return this.contextMap.get(contextId);
  }

  /**
   * Get the current stack depth
   */
  getStackDepth(): number {
    return this.contextStack.length;
  }

  /**
   * Create and push a new agent context
   */
  createAgentContext(options: {
    agentId: string;
    agentName: string;
    messageId: string;
    sessionId?: string;
    turnNumber?: number;
    model?: string;
    temperature?: number;
    reasoning?: string;
  }): string {
    const context: ProvenanceContext = {
      contextId: `ctx-${Date.now()}-${uuidv4().substring(0, 8)}`,
      source: 'agent',
      agent: {
        id: options.agentId,
        name: options.agentName,
        sessionId: options.sessionId,
        model: options.model,
        temperature: options.temperature,
      },
      chat: {
        messageId: options.messageId,
        turnNumber: options.turnNumber,
      },
      execution: {
        reasoning: options.reasoning,
      },
      createdAt: new Date().toISOString(),
    };

    return this.pushContext(context);
  }

  /**
   * Create and push a new user context
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createUserContext(options?: { userId?: string; email?: string; name?: string }): string {
    const context: ProvenanceContext = {
      contextId: `ctx-${Date.now()}-${uuidv4().substring(0, 8)}`,
      source: 'user',
      createdAt: new Date().toISOString(),
    };

    return this.pushContext(context);
  }

  /**
   * Create and push a system context
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createSystemContext(options?: { reason?: string }): string {
    const context: ProvenanceContext = {
      contextId: `ctx-${Date.now()}-${uuidv4().substring(0, 8)}`,
      source: 'system',
      createdAt: new Date().toISOString(),
    };

    return this.pushContext(context);
  }

  /**
   * Get the current actor information
   */
  getCurrentActor():
    | {
        type: string;
        id: string;
        name: string;
        turnNumber?: number;
        messageId?: string;
      }
    | undefined {
    const context = this.getCurrentContext();
    if (!context) return undefined;

    if (context.source === 'agent' && context.agent) {
      return {
        type: 'agent',
        id: context.agent.id,
        name: context.agent.name,
        turnNumber: context.chat?.turnNumber,
        messageId: context.chat?.messageId,
      };
    } else if (context.source === 'user') {
      return {
        type: 'user',
        id: 'user',
        name: 'User',
      };
    } else {
      return {
        type: 'system',
        id: 'system',
        name: 'System',
      };
    }
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | undefined {
    const context = this.getCurrentContext();
    return context?.agent?.sessionId;
  }

  /**
   * Get the current correlation ID
   */
  getCurrentCorrelationId(): string | undefined {
    const context = this.getCurrentContext();
    return context?.contextId;
  }

  /**
   * Clear all contexts (for testing or cleanup)
   */
  clear(): void {
    this.contextStack = [];
    this.contextMap.clear();

    if (this.debug) {
      logger.info('[ProvenanceContextManager] Cleared all contexts');
    }
  }

  /**
   * Validate that the context stack is in a good state
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.contextStack.length > 10) {
      errors.push(
        `Context stack depth (${this.contextStack.length}) exceeds recommended maximum (10)`,
      );
    }

    // Check for orphaned contexts in map
    const stackIds = new Set(this.contextStack.map((c) => c.contextId));
    for (const id of this.contextMap.keys()) {
      if (!stackIds.has(id)) {
        errors.push(`Orphaned context in map: ${id}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Global singleton instance
 */
let globalManager: ProvenanceContextManager | null = null;

/**
 * Get or create the global provenance context manager
 */
export function getProvenanceContextManager(options?: {
  debug?: boolean;
}): ProvenanceContextManager {
  if (!globalManager) {
    globalManager = new ProvenanceContextManager(options);
  }
  return globalManager;
}

/**
 * Reset the global manager (for testing)
 */
export function resetProvenanceContextManager(): void {
  globalManager = null;
}
