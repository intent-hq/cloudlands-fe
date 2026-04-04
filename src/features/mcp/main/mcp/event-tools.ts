/**
 * MCP Event Tools
 *
 * Provides MCP tool wrappers for the workspace event system.
 * These tools allow agents to query workspace events and activity.
 */

import { Tool } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { EventStore } from '../../../events/main/event-store';
import { EventQueryEngine } from '../../../events/main/event-query-engine';
import { AgentEventTools } from '../../../events/main/agent-event-tools';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('MCPEventTools');

function getAgentTools(workspaceId: string): AgentEventTools {
  const store = new EventStore(workspaceId);
  const queryEngine = new EventQueryEngine(store);
  return new AgentEventTools(queryEngine);
}

/**
 * Tool to get recently modified files
 */
export class GetRecentFilesTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'get_recent_files',
      description: 'Get the most recently modified files in the workspace',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of files to return (default: 10)',
            default: 10,
          },
        },
        required: [],
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const limit = call.arguments?.limit || 10;

      const agentTools = getAgentTools(this.workspaceId);
      const files = await agentTools.getRecentFiles(limit);

      return this.success(JSON.stringify({ files }, null, 2), { count: files.length });
    } catch (error) {
      logger.error('Failed to get recent files', error as Error);
      return this.error(`Failed to get recent files: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get agent activity
 */
export class GetAgentActivityTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'get_agent_activity',
      description: 'Get recent agent activity in the workspace',
      inputSchema: {
        type: 'object' as const,
        properties: {
          minutesAgo: {
            type: 'number',
            description: 'How many minutes back to look (default: 30)',
            default: 30,
          },
          agentId: {
            type: 'string',
            description: 'Optional: Filter by specific agent ID',
          },
        },
        required: [],
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const minutesAgo = call.arguments?.minutesAgo || 30;
      const agentId = call.arguments?.agentId;

      const agentTools = getAgentTools(this.workspaceId);

      if (agentId) {
        const files = await agentTools.getAgentFiles(agentId, 100);
        return this.success(JSON.stringify({ agentId, files }, null, 2), { agentId, count: files.length });
      } else {
        const activity = await agentTools.getAgentActivity(minutesAgo);
        return this.success(JSON.stringify({ activity }, null, 2), { minutesAgo });
      }
    } catch (error) {
      logger.error('Failed to get agent activity', error as Error);
      return this.error(`Failed to get agent activity: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get workspace activity summary
 */
export class GetWorkspaceSummaryTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'get_workspace_summary',
      description: 'Get a summary of workspace activity',
      inputSchema: {
        type: 'object' as const,
        properties: {
          minutesAgo: {
            type: 'number',
            description: 'How many minutes back to look (default: 60)',
            default: 60,
          },
        },
        required: [],
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const minutesAgo = call.arguments?.minutesAgo || 60;

      const agentTools = getAgentTools(this.workspaceId);
      const summary = await agentTools.getWorkspaceSummary(minutesAgo);

      return this.success(JSON.stringify({ summary }, null, 2), { minutesAgo });
    } catch (error) {
      logger.error('Failed to get workspace summary', error as Error);
      return this.error(`Failed to get workspace summary: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get changes in a directory
 */
export class GetDirectoryChangesTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'get_directory_changes',
      description: 'Get recent changes in a specific directory',
      inputSchema: {
        type: 'object' as const,
        properties: {
          directory: {
            type: 'string',
            description: 'Directory path to check for changes',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of changes to return (default: 20)',
            default: 20,
          },
        },
        required: ['directory'],
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const directory = call.arguments?.directory;
      const limit = call.arguments?.limit || 20;

      if (!directory) {
        return this.error('Directory path is required');
      }

      const agentTools = getAgentTools(this.workspaceId);
      const changes = await agentTools.getDirectoryChanges(directory, limit);

      return this.success(JSON.stringify({ directory, changes }, null, 2), {
        directory,
        count: changes.length,
      });
    } catch (error) {
      logger.error('Failed to get directory changes', error as Error);
      return this.error(`Failed to get directory changes: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to query events with filters
 */
export class QueryEventsTool extends Tool {
  constructor(private workspaceId: string) {
    super();
  }

  getDefinition() {
    return {
      name: 'query_events',
      description: 'Query workspace events with advanced filters',
      inputSchema: {
        type: 'object' as const,
        properties: {
          eventType: {
            type: 'string',
            description: "Filter by event type (e.g., 'file:changed', 'agent:tool:call')",
          },
          actorType: {
            type: 'string',
            description: "Filter by actor type (e.g., 'user', 'agent', 'system')",
          },
          actorId: {
            type: 'string',
            description: 'Filter by specific actor ID',
          },
          path: {
            type: 'string',
            description: 'Filter by file/directory path (supports prefix matching)',
          },
          minutesAgo: {
            type: 'number',
            description: 'Filter events from the last N minutes',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of events to return (default: 50)',
            default: 50,
          },
        },
        required: [],
      },
    };
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const store = new EventStore(this.workspaceId);
      const queryEngine = new EventQueryEngine(store);

      // Build filters
      const filters: any[] = [];

      if (call.arguments?.eventType) {
        filters.push({
          field: 'type',
          operator: 'equals',
          value: call.arguments.eventType,
        });
      }

      if (call.arguments?.actorType) {
        filters.push({
          field: 'actor.type',
          operator: 'equals',
          value: call.arguments.actorType,
        });
      }

      if (call.arguments?.actorId) {
        filters.push({
          field: 'actor.id',
          operator: 'equals',
          value: call.arguments.actorId,
        });
      }

      if (call.arguments?.path) {
        filters.push({
          field: 'data.path',
          operator: 'starts_with',
          value: call.arguments.path,
        });
      }

      if (call.arguments?.minutesAgo) {
        const since = new Date(Date.now() - call.arguments.minutesAgo * 60 * 1000).toISOString();
        filters.push({
          field: 'timestamp',
          operator: 'greater_than',
          value: since,
        });
      }

      // Add limit to filters
      const limit = call.arguments?.limit || 50;
      filters.push({
        field: '_limit',
        operator: 'equals',
        value: limit,
      });

      const events = await queryEngine.query(filters);

      return this.success(JSON.stringify({ count: events.length, events }, null, 2), {
        count: events.length,
      });
    } catch (error) {
      logger.error('Failed to query events', error as Error);
      return this.error(`Failed to query events: ${(error as Error).message}`);
    }
  }
}
