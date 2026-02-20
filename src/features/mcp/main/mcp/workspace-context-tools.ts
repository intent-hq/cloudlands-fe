/**
 * Workspace context MCP tools.
 *
 * Split out of workspace-tools.ts to keep that module as a small export hub.
 */

import { BaseMCPTool, createInputSchema } from './tool';
import type { WorkspaceUIContext } from '../../../../shared/types';
import { ToolCall, ToolResult } from './protocol';

/**
 * Tool to get the current UI context (what the user is viewing)
 */
export class GetCurrentContextTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'get_current_context',
      `Get the current UI context - what the user is currently viewing (file, note, diff, etc).

Returns a WorkspaceUIContext object with:
- mainContentType: The type of content being viewed ("file", "note", "diff", "empty", etc)
- mainContentId: The ID of the content (note ID or file path)
- mainContentPath: The file path (for files and diffs)
- diffInfo: Additional information when viewing a diff (additions, deletions, staged status, git status)

This helps agents understand what the user is looking at and work on the correct content.`,
      createInputSchema({}, []),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      const context = await this.workspaceManager.getCurrentContext(this.workspaceId);

      if (!context) {
        return this.success(
          JSON.stringify(
            {
              workspaceId: this.workspaceId,
              mainContentType: 'empty',
              lastUpdated: new Date().toISOString(),
            } as WorkspaceUIContext,
            null,
            2,
          ),
          {
            workspaceId: this.workspaceId,
            hasContext: false,
          },
        );
      }

      // Build helpful metadata for the agent
      const metadata: Record<string, any> = {
        workspaceId: this.workspaceId,
        contentType: context.mainContentType,
        hasContext: true,
      };

      // Add file path to metadata for easy access
      if (context.mainContentPath) {
        metadata.filePath = context.mainContentPath;
      }

      // Add note ID to metadata for easy access
      if (context.mainContentType === 'note' && context.mainContentId) {
        metadata.noteId = context.mainContentId;
      }

      // Add diff status to metadata
      if (context.mainContentType === 'diff' && context.diffInfo) {
        metadata.isDiff = true;
        metadata.isStaged = context.diffInfo.isStaged;
        metadata.gitStatus = context.diffInfo.gitStatus;
      }

      return this.success(JSON.stringify(context, null, 2), metadata);
    } catch (error) {
      return this.error(`Failed to get current context: ${(error as Error).message}`);
    }
  }
}
