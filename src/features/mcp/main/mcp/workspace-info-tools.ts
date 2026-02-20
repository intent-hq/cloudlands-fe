/**
 * Workspace info MCP tools.
 *
 * Split out of workspace-tools.ts to keep the main export hub smaller.
 */

import { BaseMCPTool, createInputSchema } from './tool';
import type { ToolCall, ToolResult } from './protocol';

/**
 * Tool to view workspace information
 */
export class GetWorkspaceInfoTool extends BaseMCPTool {
  private workspacePath: string;
  private workspaceId: string;

  constructor(workspacePath: string, workspaceId: string) {
    super(
      'view_workspace',
      'View information about the current workspace including its ID and path',
      createInputSchema({}, []),
    );
    this.workspacePath = workspacePath;
    this.workspaceId = workspaceId;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      const info = {
        id: this.workspaceId,
        path: this.workspacePath,
        timestamp: new Date().toISOString(),
      };

      return this.success(JSON.stringify(info, null, 2), {
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      return this.error(`Failed to get workspace info: ${(error as Error).message}`);
    }
  }
}
