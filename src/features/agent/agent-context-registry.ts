/**
 * Agent Context Registry
 *
 * Global registry for tracking active agent contexts.
 * This allows the HTTP MCP bridge to access agent information
 * when processing MCP tool calls.
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('AgentContextRegistry');

interface AgentContext {
  agentId: string;
  agentName: string;
  sessionId: string;
  turnNumber?: number;
  workspaceId: string;
  model?: string; // Agent model (used for delegation to inherit parent model)
  updatedAt: Date;
}

class AgentContextRegistry {
  private contexts: Map<string, AgentContext> = new Map();
  private workspaceAgents: Map<string, string> = new Map(); // workspaceId -> agentId
  private sessionContexts: Map<string, AgentContext> = new Map(); // sessionId -> context

  /**
   * Register or update an agent context
   */
  register(context: AgentContext): void {
    this.contexts.set(context.agentId, context);
    this.workspaceAgents.set(context.workspaceId, context.agentId);

    // Also index by session ID for more reliable lookups
    if (context.sessionId) {
      this.sessionContexts.set(context.sessionId, context);
    }

    logger.debug('Registered agent context', {
      agentId: context.agentId,
      agentName: context.agentName,
      sessionId: context.sessionId,
      turnNumber: context.turnNumber,
      workspaceId: context.workspaceId,
      model: context.model,
    });
  }

  /**
   * Get agent context by agent ID
   */
  getByAgentId(agentId: string): AgentContext | undefined {
    return this.contexts.get(agentId);
  }

  /**
   * Get agent context by workspace ID
   */
  getByWorkspaceId(workspaceId: string): AgentContext | undefined {
    const agentId = this.workspaceAgents.get(workspaceId);
    const context = agentId ? this.contexts.get(agentId) : undefined;

    logger.debug('Getting agent context by workspace ID', {
      workspaceId,
      foundAgentId: !!agentId,
      agentId,
      foundContext: !!context,
      turnNumber: context?.turnNumber,
      registeredWorkspaces: Array.from(this.workspaceAgents.keys()),
    });

    return context;
  }

  /**
   * Get agent context by session ID - more reliable than workspace ID
   * since session IDs are unique per agent instance
   */
  getBySessionId(sessionId: string): AgentContext | undefined {
    const context = this.sessionContexts.get(sessionId);

    logger.debug('Getting agent context by session ID', {
      sessionId,
      foundContext: !!context,
      agentId: context?.agentId,
      turnNumber: context?.turnNumber,
      registeredSessions: Array.from(this.sessionContexts.keys()),
    });

    return context;
  }

  /**
   * Update turn number for an agent
   */
  updateTurnNumber(agentId: string, turnNumber: number): void {
    const context = this.contexts.get(agentId);
    if (context) {
      context.turnNumber = turnNumber;
      context.updatedAt = new Date();

      logger.debug('Updated turn number', {
        agentId,
        turnNumber,
      });
    }
  }

  /**
   * Remove an agent context
   */
  unregister(agentId: string): void {
    const context = this.contexts.get(agentId);
    if (context) {
      this.workspaceAgents.delete(context.workspaceId);
      // Also clean up session index
      if (context.sessionId) {
        this.sessionContexts.delete(context.sessionId);
      }
      this.contexts.delete(agentId);

      logger.debug('Unregistered agent context', { agentId });
    }
  }

  /**
   * Clear all contexts
   */
  clear(): void {
    this.contexts.clear();
    this.workspaceAgents.clear();
    this.sessionContexts.clear();
    logger.debug('Cleared all agent contexts');
  }

  /**
   * Clear all agent contexts for a specific workspace.
   * This should be called when a workspace is closed to prevent memory leaks.
   *
   * @param workspaceId The workspace ID to clear contexts for
   * @returns The number of contexts cleared
   */
  clearForWorkspace(workspaceId: string): number {
    let clearedCount = 0;

    // Find all agents for this workspace
    const agentsToRemove: string[] = [];
    for (const [agentId, context] of this.contexts.entries()) {
      if (context.workspaceId === workspaceId) {
        agentsToRemove.push(agentId);
      }
    }

    // Remove each agent
    for (const agentId of agentsToRemove) {
      this.unregister(agentId);
      clearedCount++;
    }

    // Also clean up the workspace mapping
    this.workspaceAgents.delete(workspaceId);

    if (clearedCount > 0) {
      logger.info('Cleared agent contexts for workspace', {
        workspaceId,
        clearedCount,
        remainingContexts: this.contexts.size,
      });
    }

    return clearedCount;
  }

  /**
   * Get diagnostic information about the registry.
   * Useful for debugging agent context issues.
   */
  getStats(): {
    totalContexts: number;
    totalWorkspaces: number;
    totalSessions: number;
    contexts: Array<{
      agentId: string;
      agentName: string;
      workspaceId: string;
      sessionId: string;
      ageMs: number;
    }>;
    } {
    const now = Date.now();
    const contexts = Array.from(this.contexts.entries()).map(([agentId, ctx]) => ({
      agentId,
      agentName: ctx.agentName,
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      ageMs: now - ctx.updatedAt.getTime(),
    }));

    return {
      totalContexts: this.contexts.size,
      totalWorkspaces: this.workspaceAgents.size,
      totalSessions: this.sessionContexts.size,
      contexts,
    };
  }
}

// Singleton instance
let instance: AgentContextRegistry | null = null;

/**
 * Get the singleton agent context registry
 */
export function getAgentContextRegistry(): AgentContextRegistry {
  if (!instance) {
    instance = new AgentContextRegistry();
  }
  return instance;
}
