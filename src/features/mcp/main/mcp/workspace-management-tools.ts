/**
 * MCP Tools for Workspace Management
 * Provides tools for managing workspace metadata like title, status, etc.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import type { ProtocolAdapter } from '$features/protocol/main/protocol-adapter';
import { Logger } from '$shared/logger';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';

const logger = new Logger('WorkspaceManagementTools');

// Import file system and path utilities for agent renaming
import * as fs from 'fs/promises';
import { getSessionPath } from '$shared/constants';
import { WorkspaceConfig } from '$shared/main/config';
import { sanitizeBranchName } from '$lib/utils/workspace-validation';
import { gitService } from '$features/git/main/git.service';
import type { WorkspaceId } from '$shared/types';
import { isWorkspaceSlug } from '$shared/services/workspace-slug';

/**
 * Tool to set the workspace title
 */
export class RenameWorkspaceTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;
  private eventEmitter?: any;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string, eventEmitter?: any) {
    super(
      'set_workspace_title',
      'Set or update the workspace title. Keep titles short (1-5 words) and descriptive of the main task or goal. Will skip if workspace already has a custom title unless force=true.',
      createInputSchema(
        {
          title: stringProperty(
            "The new title for the workspace. Should be 1-5 words, descriptive of the main task. Examples: 'Fix Login Bug', 'Add Search Feature', 'Refactor Database', 'Update Documentation'",
          ),
          force: {
            type: 'boolean',
            description:
              'Set to true to override an existing custom workspace title. Defaults to false, which will skip renaming if a custom title already exists.',
          },
        },
        ['title'],
      ),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
    this.eventEmitter = eventEmitter;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { title, force = false } = call.arguments;

      if (!title || typeof title !== 'string') {
        return this.error('Title is required and must be a string');
      }

      // Validate title length (warn if too long but don't fail)
      const wordCount = title.trim().split(/\s+/).length;
      if (wordCount > 5) {
        logger.warn(`Title has ${wordCount} words, recommended is 1-5 words`);
      }

      // Get the current workspace
      // In MCP context, protocolAdapter.getWorkspace returns data directly or null
      const workspace = await this.protocolAdapter.getWorkspace(this.workspaceId);

      // Check if workspace already has a custom title (not empty, not a slug)
      // Only proceed if force=true or workspace needs a title
      if (!force && workspace?.title) {
        const currentTitle = workspace.title.trim();
        const hasCustomTitle = currentTitle !== '' && !isWorkspaceSlug(currentTitle);
        if (hasCustomTitle) {
          return this.success(
            `Workspace already has a custom title: "${currentTitle}". Skipping rename. Use force=true to override.`,
            {
              workspaceId: this.workspaceId,
              currentTitle,
              skipped: true,
            },
          );
        }
      }

      // Generate new branch name from the new title
      const newBranchName = sanitizeBranchName(title.trim());
      const oldBranchName = workspace?.branch;

      // Determine what branch name to use for metadata
      // We'll attempt to rename the git branch first, and only use the new name if it succeeds
      let finalBranchName = oldBranchName || newBranchName;

      // If workspace has a repository and branch name changed, rename the git branch FIRST
      // before updating metadata to avoid metadata/git branch mismatch
      if (workspace?.repositoryPath && oldBranchName && oldBranchName !== newBranchName) {
        try {
          const renameResult = await gitService.renameBranch(
            this.workspaceId as WorkspaceId,
            oldBranchName,
            newBranchName,
          );

          if (!renameResult.ok) {
            logger.warn(`Failed to rename git branch: ${renameResult.error}`);
            // If the old branch doesn't exist in git, update metadata to use the new branch name
            // since there's no actual git branch to stay in sync with
            if (renameResult.error?.includes('does not exist. Cannot rename')) {
              finalBranchName = newBranchName;
            } else {
              // Keep the old branch name in metadata to stay in sync with git
              finalBranchName = oldBranchName;
            }
          } else {
            logger.info('Git branch renamed successfully', {
              workspaceId: this.workspaceId,
              oldBranch: oldBranchName,
              newBranch: newBranchName,
            });
            finalBranchName = newBranchName;
          }
        } catch (gitError) {
          logger.warn('Error renaming git branch:', gitError as Error);
          // Keep the old branch name in metadata to stay in sync with git
          finalBranchName = oldBranchName;
        }
      } else if (!oldBranchName) {
        // No existing branch, use the new branch name
        finalBranchName = newBranchName;
      }

      // Update the workspace title and branch (using the branch name that succeeded)
      const updateResult = await this.protocolAdapter.updateWorkspace({
        id: this.workspaceId,
        title: title.trim(),
        branch: finalBranchName,
      });

      if (!updateResult.ok) {
        return this.error(`Failed to update workspace: ${updateResult.error}`);
      }

      // Event is already emitted by the protocol adapter via Event Bus
      // No need to manually emit here

      const branchChanged = finalBranchName === newBranchName;
      return this.success(
        branchChanged
          ? `Workspace renamed to: "${title}"`
          : `Workspace title updated to: "${title}" (branch kept as "${finalBranchName}" - target branch already exists)`,
        {
          workspaceId: this.workspaceId,
          title: title.trim(),
          branch: finalBranchName,
          wordCount,
          branchRenamed: branchChanged,
        },
      );
    } catch (error) {
      return this.error(`Failed to rename workspace: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to get workspace details
 */
export class GetWorkspaceMetadataTool extends BaseMCPTool {
  private protocolAdapter: ProtocolAdapter;
  private workspaceId: string;

  constructor(protocolAdapter: ProtocolAdapter, workspaceId: string) {
    super(
      'get_workspace_details',
      'Get workspace details including title, creation date, status, and other metadata',
      createInputSchema({}, []),
    );
    this.protocolAdapter = protocolAdapter;
    this.workspaceId = workspaceId;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      // Get the current workspace
      // In MCP context, protocolAdapter.getWorkspace returns data directly or null
      const workspace = await this.protocolAdapter.getWorkspace(this.workspaceId);
      if (!workspace) {
        // Return minimal metadata for new/uninitialized workspaces
        const metadata = {
          id: this.workspaceId,
          title: '(untitled)',
          hasTitle: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
          branch: null,
          repositoryName: null,
          tags: [],
        };
        return this.success(JSON.stringify(metadata, null, 2), metadata);
      }

      const metadata = {
        id: workspace.id,
        title: workspace.title || '(untitled)',
        hasTitle: !!workspace.title,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        status: workspace.status,
        branch: workspace.branch,
        repositoryName: workspace.repositoryName,
        tags: workspace.tags || [],
      };

      return this.success(JSON.stringify(metadata, null, 2), metadata);
    } catch (error) {
      return this.error(`Failed to get workspace metadata: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to rename the current agent
 *
 * Agents use this tool to name themselves based on their task.
 * The agent ID is extracted from the request context.
 */
export class RenameAgentTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'set_agent_name',
      "Set your name to reflect your current task. Call this at the beginning of your first response to name yourself appropriately. Names should be short (1-5 words) and descriptive of the task. Examples: 'Fix Login Bug', 'Add Search', 'Refactor Auth', 'Update Tests'",
      createInputSchema(
        {
          name: stringProperty(
            "Your new name. Should be 1-5 words, descriptive of your task. Examples: 'Fix Login Bug', 'Add Search Feature', 'Refactor Database', 'Update Docs'",
          ),
        },
        ['name'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { name } = call.arguments;

      if (!name || typeof name !== 'string') {
        return this.error('Name is required and must be a string');
      }

      // Get agent ID from the call context (set by HTTP MCP bridge)
      const agentId = call.context?.agentId;

      if (!agentId) {
        return this.error('Could not determine agent ID from request context');
      }

      // Validate name length
      const trimmedName = name.trim();
      const wordCount = trimmedName.split(/\s+/).length;
      if (wordCount > 5) {
        logger.warn(`Agent name has ${wordCount} words, recommended is 1-5 words`);
      }

      // Get the session path and update the agent's name on disk
      // Pass resolved base path so legacy ~/.workspaces workspaces are found correctly
      const resolvedBase = WorkspaceConfig.resolveWorkspaceRoot(this.workspaceId);
      const sessionPath = getSessionPath(this.workspaceId, agentId, resolvedBase);

      try {
        // Read the current session
        const readResult = await fs.readFile(sessionPath, 'utf-8');

        // Parse and update the name
        const sessionData = JSON.parse(readResult);
        if (sessionData.version && sessionData.data) {
          // Versioned format
          sessionData.data.name = trimmedName;
        } else {
          // Legacy format
          sessionData.name = trimmedName;
        }

        // Write back to disk
        await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');

        logger.info(`Agent renamed via MCP tool: ${agentId} -> ${trimmedName}`);

        // Emit event to notify all windows about the rename
        sendToWorkspaceWindows(this.workspaceId, 'agent:renamed', {
          agentId,
          workspaceId: this.workspaceId,
          name: trimmedName,
        });

        return this.success(`Agent renamed to: "${trimmedName}"`, {
          agentId,
          name: trimmedName,
          wordCount,
        });
      } catch (fileError) {
        if ((fileError as NodeJS.ErrnoException).code === 'ENOENT') {
          return this.error(`Agent session file not found for agent: ${agentId}`);
        }
        throw fileError;
      }
    } catch (error) {
      logger.error('Failed to rename agent', error as Error);
      return this.error(`Failed to rename agent: ${(error as Error).message}`);
    }
  }
}
