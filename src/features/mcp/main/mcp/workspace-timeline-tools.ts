/**
 * Workspace timeline MCP tools.
 *
 * Split out of workspace-tools.ts to keep the main export hub smaller.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';

/**
 * Tool to read the workspace timeline
 */
export class ReadTimelineTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'read_timeline',
      'Read the workspace timeline to see recent activities, file changes, and agent actions',
      createInputSchema(
        {
          limit: stringProperty(
            'Optional: maximum number of timeline entries to return (default: 50)',
          ),
          type: stringProperty(
            "Optional: filter by entry type (e.g., 'FileModified', 'AgentMessage', 'CommandExecuted')",
          ),
        },
        [],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { limit, type } = call.arguments;
      const maxEntries = limit ? parseInt(limit as string, 10) : 50;

      // Get workspace
      const workspace = await this.workspaceManager.getWorkspace(this.workspaceId);

      if (!workspace) {
        return this.error(`Workspace not found: ${this.workspaceId}`);
      }

      // Get timeline entries
      let timeline = workspace.timeline || [];

      // Filter by type if specified
      if (type) {
        timeline = timeline.filter((entry: any) => entry.type === type);
      }

      // Limit entries
      const limitedTimeline = timeline.slice(-maxEntries);

      // Format timeline for readability
      const formattedTimeline = limitedTimeline.map((entry: any) => ({
        timestamp: entry.timestamp,
        type: entry.type,
        description: entry.description || entry.message,
        details: entry.details,
      }));

      return this.success(JSON.stringify(formattedTimeline, null, 2), {
        count: formattedTimeline.length,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      return this.error(`Failed to read timeline: ${(error as Error).message}`);
    }
  }
}
