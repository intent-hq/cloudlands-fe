/**
 * Agent Tool Service for Workspace Events
 *
 * Provides easy-to-use methods for agents to query and subscribe to workspace events.
 * This would be exposed as MCP tools for agents to use.
 */

import { WorkspaceEventBus, EventFilterBuilder } from './workspace-event-bus';
import {
  WorkspaceEvent,
  FileChangedEvent,
  isFileChangedEvent,
  isAgentToolCallEvent,
} from '../types';
import { Logger } from '../../../shared/logger';

const logger = new Logger('AgentEventTools');

export interface FileActivity {
  path: string;
  relativePath: string;
  action: string;
  timestamp: string;
  actor?: string;
  additions?: number;
  deletions?: number;
}

export interface AgentActivity {
  agentId: string;
  agentName?: string;
  eventCount: number;
  toolCalls: number;
  filesModified: string[];
  lastActive: string;
}

export interface WorkspaceActivity {
  recentFiles: FileActivity[];
  activeAgents: AgentActivity[];
  eventRate: number; // events per minute
  topChangedFiles: Array<{ path: string; changeCount: number }>;
}

/**
 * Agent-friendly interface to workspace events
 */
export class AgentEventTools {
  constructor(private eventBus: WorkspaceEventBus) {}

  /**
   * Get the last N files that were touched
   * Example: "What files were recently modified?"
   */
  async getRecentFiles(limit: number = 5): Promise<FileActivity[]> {
    logger.debug('Getting recent files', { limit });

    const events = await this.eventBus.query<FileChangedEvent>(
      new EventFilterBuilder().ofType('file:changed').limit(limit).build(),
    );

    return events.map((e) => ({
      path: e.data.path,
      relativePath: e.data.relativePath,
      action: e.data.action,
      timestamp: e.timestamp,
      actor: `${e.actor.type}:${e.actor.name}`,
      additions: e.data.additions,
      deletions: e.data.deletions,
    }));
  }

  /**
   * Get files changed by a specific agent
   * Example: "What files did agent 'Bug Fixer' modify?"
   */
  async getAgentFiles(agentId: string, limit: number = 10): Promise<FileActivity[]> {
    logger.debug('Getting files changed by agent', { agentId, limit });

    const events = await this.eventBus.query<FileChangedEvent>(
      new EventFilterBuilder()
        .ofType('file:changed')
        .byActor('agent', agentId)
        .limit(limit)
        .build(),
    );

    return events.map((e) => ({
      path: e.data.path,
      relativePath: e.data.relativePath,
      action: e.data.action,
      timestamp: e.timestamp,
      actor: e.actor.name,
      additions: e.data.additions,
      deletions: e.data.deletions,
    }));
  }

  /**
   * Get recent agent activity
   * Example: "What have other agents been doing?"
   */
  async getAgentActivity(minutesAgo: number = 30): Promise<AgentActivity[]> {
    logger.debug('Getting agent activity', { minutesAgo });

    const events = await this.eventBus.query(
      new EventFilterBuilder()
        .byActor('agent')
        .inLast(minutesAgo * 60 * 1000)
        .build(),
    );

    // Group by agent
    const agentMap = new Map<string, AgentActivity>();

    for (const event of events) {
      const agentId = event.actor.id;
      const agentName = event.actor.name;

      // Skip events without actor ID
      if (!agentId) continue;

      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, {
          agentId,
          agentName,
          eventCount: 0,
          toolCalls: 0,
          filesModified: [],
          lastActive: event.timestamp,
        });
      }

      const activity = agentMap.get(agentId)!;
      activity.eventCount++;
      activity.lastActive = event.timestamp;

      if (isAgentToolCallEvent(event)) {
        activity.toolCalls++;
        if (event.data.filesModified) {
          activity.filesModified.push(...event.data.filesModified);
        }
      }

      if (isFileChangedEvent(event)) {
        activity.filesModified.push(event.data.path);
      }
    }

    // Deduplicate files
    for (const activity of agentMap.values()) {
      activity.filesModified = [...new Set(activity.filesModified)];
    }

    return Array.from(agentMap.values());
  }

  /**
   * Get files changed in a specific directory
   * Example: "What changed in the src/components folder?"
   */
  async getDirectoryChanges(directory: string, limit: number = 20): Promise<FileActivity[]> {
    logger.debug('Getting directory changes', { directory, limit });

    const events = await this.eventBus.query<FileChangedEvent>(
      new EventFilterBuilder().ofType('file:changed').inPath(directory).limit(limit).build(),
    );

    return events.map((e) => ({
      path: e.data.path,
      relativePath: e.data.relativePath,
      action: e.data.action,
      timestamp: e.timestamp,
      actor: `${e.actor.type}:${e.actor.name}`,
      additions: e.data.additions,
      deletions: e.data.deletions,
    }));
  }

  /**
   * Get workspace activity summary
   * Example: "Give me a summary of recent workspace activity"
   */
  async getWorkspaceSummary(minutesAgo: number = 60): Promise<WorkspaceActivity> {
    logger.debug('Getting workspace summary', { minutesAgo });

    const allEvents = await this.eventBus.query(
      new EventFilterBuilder().inLast(minutesAgo * 60 * 1000).build(),
    );

    // Get recent files
    const fileEvents = allEvents.filter(isFileChangedEvent);
    const recentFiles = fileEvents.slice(0, 5).map((e) => ({
      path: e.data.path,
      relativePath: e.data.relativePath,
      action: e.data.action,
      timestamp: e.timestamp,
      actor: `${e.actor.type}:${e.actor.name}`,
      additions: e.data.additions,
      deletions: e.data.deletions,
    }));

    // Get active agents
    const agentActivity = await this.getAgentActivity(minutesAgo);

    // Calculate event rate
    const eventRate = allEvents.length / minutesAgo;

    // Get top changed files
    const fileChangeCount = new Map<string, number>();
    for (const event of fileEvents) {
      const path = event.data.path;
      fileChangeCount.set(path, (fileChangeCount.get(path) || 0) + 1);
    }

    const topChangedFiles = Array.from(fileChangeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, changeCount: count }));

    return {
      recentFiles,
      activeAgents: agentActivity,
      eventRate,
      topChangedFiles,
    };
  }

  /**
   * Watch for changes to specific files
   * Example: "Tell me when package.json changes"
   */
  watchFile(filePath: string, callback: (event: FileChangedEvent) => void): () => void {
    logger.debug('Setting up file watch', { filePath });

    const subscription = this.eventBus.subscribe<FileChangedEvent>({
      filters: new EventFilterBuilder().ofType('file:changed').matchingPattern(filePath).build(),
      callback: (event) => {
        if (event.data.path === filePath || event.data.path.endsWith(filePath)) {
          callback(event);
        }
      },
    });

    return () => subscription.unsubscribe?.();
  }

  /**
   * Watch for other agent activities
   * Example: "Let me know when other agents make changes"
   */
  watchAgentActivity(
    excludeAgentId: string,
    callback: (event: WorkspaceEvent) => void,
  ): () => void {
    logger.debug('Setting up agent activity watch', { excludeAgentId });

    const subscription = this.eventBus.subscribe({
      filters: new EventFilterBuilder().byActor('agent').build(),
      callback: (event) => {
        if (event.actor.id !== excludeAgentId) {
          callback(event);
        }
      },
    });

    return () => subscription.unsubscribe?.();
  }

  /**
   * Get correlated events (events that happened together)
   * Example: "What other changes happened with this commit?"
   */
  async getCorrelatedEvents(correlationId: string): Promise<WorkspaceEvent[]> {
    logger.debug('Getting correlated events', { correlationId });

    return this.eventBus.query(new EventFilterBuilder().withCorrelation(correlationId).build());
  }

  /**
   * Search events by metadata
   * Example: "Find all events related to 'authentication'"
   */
  async searchEvents(searchTerm: string, limit: number = 20): Promise<WorkspaceEvent[]> {
    logger.debug('Searching events', { searchTerm, limit });

    // This would need a more sophisticated search implementation
    // For now, we can search in file paths
    const events = await this.eventBus.query(
      new EventFilterBuilder().matchingPattern(searchTerm).limit(limit).build(),
    );

    return events;
  }
}

/**
 * MCP Tool definitions for agents
 */
export const workspaceEventTools = {
  name: 'workspace_events',
  description: 'Query and monitor workspace events and activity',

  methods: {
    getRecentFiles: {
      description: 'Get the most recently modified files',
      parameters: {
        limit: { type: 'number', description: 'Number of files to return', default: 5 },
      },
    },

    getAgentFiles: {
      description: 'Get files modified by a specific agent',
      parameters: {
        agentId: { type: 'string', description: 'ID of the agent', required: true },
        limit: { type: 'number', description: 'Number of files to return', default: 10 },
      },
    },

    getAgentActivity: {
      description: 'Get recent activity from all agents',
      parameters: {
        minutesAgo: { type: 'number', description: 'How many minutes back to look', default: 30 },
      },
    },

    getDirectoryChanges: {
      description: 'Get changes in a specific directory',
      parameters: {
        directory: { type: 'string', description: 'Directory path', required: true },
        limit: { type: 'number', description: 'Number of changes to return', default: 20 },
      },
    },

    getWorkspaceSummary: {
      description: 'Get a summary of recent workspace activity',
      parameters: {
        minutesAgo: { type: 'number', description: 'Time window in minutes', default: 60 },
      },
    },

    searchEvents: {
      description: 'Search for events containing a term',
      parameters: {
        searchTerm: { type: 'string', description: 'Term to search for', required: true },
        limit: { type: 'number', description: 'Maximum results', default: 20 },
      },
    },
  },
};
