/**
 * MCP (Model Context Protocol) Module
 *
 * Provides MCP server and tools for agent-workspace communication
 */

export * from './protocol';
export { BaseMCPTool as Tool } from './tool';
export type { IMCPTool } from './tool';
export * from './server';
export * from './workspace-tools';
export * from './tool-call-extractor';
export * from './agent-tool-executor';

import { MCPServer } from './server';
import {
  GetWorkspaceInfoTool,
  CreateNoteTool,
  ListNotesTool,
  ReadNoteTool,
  ReadAssetTool,
  SetNoteContentTool,
  UpdateNoteMetadataTool,
  UpdateTaskStatusTool,
  UpdateNoteTaskStatusTool,
  UpdateTaskTool,
  GetReferenceDocsTool,
  DeleteNoteTool,
  ReadTimelineTool,
  GetCurrentContextTool,
  AddNoteCommentTool,
  ListNoteCommentsTool,
  GetCommentThreadTool,
  RespondToCommentThreadTool,
  DeleteNoteCommentTool,
} from './workspace-tools';
import {
  GitStatusTool,
  GitStageTool,
  GitCommitTool,
  AgentCommitChangesTool,
  CheckMergeConflictsTool,
} from './git-tools';
// Note: spec-collaboration-tools are deprecated in favor of generic note comment tools
// The spec is now just a note with ID "spec"
import {
  RenameWorkspaceTool,
  GetWorkspaceMetadataTool,
  RenameAgentTool,
} from './workspace-management-tools';
import {
  GetMyTaskTool,
  MarkAsTaskTool,
  CreatePrerequisiteTool,
  ConvertTaskBlocksTool,
  AssignAgentTool,
} from './task-tools';
import {
  GetRecentFilesTool,
  GetAgentActivityTool,
  GetWorkspaceSummaryTool,
  GetDirectoryChangesTool,
  QueryEventsTool,
} from './event-tools';
import {
  AddReferencePrimitiveTool,
  AddCliPrimitiveTool,
  AddPatchPrimitiveTool,
  AddAgentActionPrimitiveTool,
} from './note-primitives-tools';
import { AddToNoteTool, EditNoteTool, EditNoteLinesTool } from './workspace-note-edit-tools';
import {
  CreateAgentTool,
  DelegateTaskTool,
  SendMessageToAgentTool,
  SendMessageToTaskAgentTool,
  SubscribeToEventsTool,
  UnsubscribeFromEventsTool,
  ListAgentsTool,
  GetAgentStatusTool,
  WakeOrCreateTaskAgentTool,
  ReadAgentConversationTool,
  GetAgentSummaryTool,
  ReportToParentTool,
} from './agent-interaction-tools';
import {
  ListSiblingWorkspacesTool,
  ReadExternalNoteTool,
  ListExternalNotesTool,
} from './cross-workspace-tools';
import { BrowserExecTool, BrowserDocsTool } from './browser-tools';
import { ListTerminalsTool, ReadTerminalOutputTool } from './terminal-tools';
import {
  ListPRReviewCommentsTool,
  ReplyToPRReviewCommentTool,
  ResolvePRReviewThreadTool,
  ListPRCommentsTool,
  PostPRCommentTool,
  PR_TOOL_NAMES,
  type PRContext,
} from './pr-comment-tools';
import { MergePRTool, GetPRStatusTool, UpdatePRBranchTool, WaitForPRChangesTool, PR_STATUS_TOOL_NAME } from './pr-tools';
export { PR_TOOL_NAMES, type PRContext } from './pr-comment-tools';
import { Logger } from '$shared/logger';

const logger = new Logger('WorkspaceMCPServer');

/**
 * Register PR comment tools on an MCP server.
 * Used both during initial server creation and for dynamic registration when a PR is created.
 */
export function registerPRTools(server: MCPServer, prContext: PRContext): void {
  server.registerTool(new ListPRReviewCommentsTool(prContext));
  server.registerTool(new ReplyToPRReviewCommentTool(prContext));
  server.registerTool(new ResolvePRReviewThreadTool(prContext));
  server.registerTool(new ListPRCommentsTool(prContext));
  server.registerTool(new PostPRCommentTool(prContext));
  server.registerTool(new MergePRTool(prContext));
  server.registerTool(new GetPRStatusTool(prContext));
  server.registerTool(new UpdatePRBranchTool(prContext));
  server.registerTool(new WaitForPRChangesTool(prContext));
}

/**
 * Unregister PR comment tools from an MCP server.
 * Used for dynamic unregistration when a PR is closed/merged.
 */
export function unregisterPRTools(server: MCPServer): void {
  for (const name of PR_TOOL_NAMES) {
    server.unregisterTool(name);
  }
  server.unregisterTool(PR_STATUS_TOOL_NAME);
}

/**
 * Create a workspace MCP server with default tools.
 * These tools provide access to workspace primitives (notes, tasks, comments, etc.)
 * that agents wouldn't otherwise have access to via their built-in tools.
 */
export async function createWorkspaceMCPServer(
  workspacePath: string,
  workspaceId: string,
  workspaceManager?: any,
  timelineManager?: any,
  workspaceMetadataPath?: string,
  eventEmitter?: any,
): Promise<MCPServer> {
  const server = new MCPServer({
    name: 'Workspace MCP Server',
    version: '1.0.0',
  });

  // Register workspace info tool
  server.registerTool(new GetWorkspaceInfoTool(workspacePath, workspaceId));

  // Register reference docs tool (no dependencies, always available)
  server.registerTool(new GetReferenceDocsTool());

  // Register notes tools if workspace manager is provided
  if (workspaceManager) {
    server.registerTool(new CreateNoteTool(workspaceManager, workspaceId));
    server.registerTool(new ListNotesTool(workspaceManager, workspaceId));
    server.registerTool(new ReadNoteTool(workspaceManager, workspaceId));
    server.registerTool(new ReadAssetTool(workspaceId));
    server.registerTool(new SetNoteContentTool(workspaceManager, workspaceId));
    server.registerTool(new AddToNoteTool(workspaceManager, workspaceId));
    server.registerTool(new EditNoteTool(workspaceManager, workspaceId));
    server.registerTool(new EditNoteLinesTool(workspaceManager, workspaceId));
    server.registerTool(new UpdateNoteMetadataTool(workspaceManager, workspaceId));
    server.registerTool(new UpdateTaskStatusTool(workspaceManager, workspaceId));
    server.registerTool(new UpdateNoteTaskStatusTool(workspaceManager, workspaceId));
    server.registerTool(new UpdateTaskTool(workspaceManager, workspaceId));
    server.registerTool(new DeleteNoteTool(workspaceManager, workspaceId));

    // Note: spec is now just a regular note with ID "spec"
    // Use read_note, set_note_content, etc. with noteId="spec" instead of read_spec/write_spec

    // Register generic comment tools for any note
    server.registerTool(new AddNoteCommentTool(workspaceManager, workspaceId));
    server.registerTool(new ListNoteCommentsTool(workspaceManager, workspaceId));
    server.registerTool(new GetCommentThreadTool(workspaceManager, workspaceId));
    server.registerTool(new RespondToCommentThreadTool(workspaceManager, workspaceId));
    server.registerTool(new DeleteNoteCommentTool(workspaceManager, workspaceId));

    // Register context tools
    server.registerTool(new GetCurrentContextTool(workspaceManager, workspaceId));

    // Register workspace management tools
    server.registerTool(new RenameWorkspaceTool(workspaceManager, workspaceId, eventEmitter));
    server.registerTool(new GetWorkspaceMetadataTool(workspaceManager, workspaceId));

    // Register agent self-naming tool
    server.registerTool(new RenameAgentTool(workspaceId));

    // Register task management tools (Phase 1C)
    // Task blocks are auto-converted to Task Notes when any note is updated via agent tools.
    server.registerTool(new GetMyTaskTool(workspaceManager, workspaceId));
    server.registerTool(new MarkAsTaskTool(workspaceManager, workspaceId));
    server.registerTool(new ConvertTaskBlocksTool(workspaceManager, workspaceId));
    server.registerTool(new CreatePrerequisiteTool(workspaceManager, workspaceId));
    server.registerTool(new AssignAgentTool(workspaceManager, workspaceId));

    // Register note primitive tools for rich content blocks
    server.registerTool(new AddReferencePrimitiveTool(workspaceManager, workspaceId));
    server.registerTool(new AddCliPrimitiveTool(workspaceManager, workspaceId));
    server.registerTool(new AddPatchPrimitiveTool(workspaceManager, workspaceId));
    server.registerTool(new AddAgentActionPrimitiveTool(workspaceManager, workspaceId));
  }

  // Note: Spec-specific collaboration tools have been removed in favor of generic note comment tools
  // The spec is now just a note with ID "spec" and can be commented on using:
  // - add_note_comment (to add comments to any note including spec)
  // - list_note_comments (to list comments on any note including spec)
  // - add_note_comment_workspace (alias for compatibility)
  //
  // The old spec-specific tools are deprecated because:
  // 1. They create confusion by treating spec as special when it's just a note
  // 2. The generic note comment tools already handle all notes including spec
  // 3. Having both sets of tools causes agents to be confused about which to use

  // Register timeline tool if timeline manager is provided
  // (can be the same as workspaceManager)
  if (timelineManager) {
    server.registerTool(new ReadTimelineTool(timelineManager, workspaceId));
  }

  // Register event tools for querying workspace activity
  server.registerTool(new GetRecentFilesTool(workspaceId));
  server.registerTool(new GetAgentActivityTool(workspaceId));
  server.registerTool(new GetWorkspaceSummaryTool(workspaceId));
  server.registerTool(new GetDirectoryChangesTool(workspaceId));
  server.registerTool(new QueryEventsTool(workspaceId));

  // Register git tools for version control operations
  server.registerTool(new GitStatusTool(workspaceId));
  server.registerTool(new GitStageTool(workspaceId));
  server.registerTool(new GitCommitTool(workspaceId)); // Deprecated - kept for backward compatibility
  server.registerTool(new AgentCommitChangesTool(workspaceId)); // Recommended commit tool for agents
  server.registerTool(new CheckMergeConflictsTool(workspaceId));

  // Register agent interaction tools for agent-to-agent communication
  server.registerTool(new CreateAgentTool(workspaceId, workspacePath));
  server.registerTool(new DelegateTaskTool(workspaceId, workspacePath));
  server.registerTool(new SendMessageToAgentTool(workspaceId));
  server.registerTool(new SendMessageToTaskAgentTool(workspaceId));
  server.registerTool(new SubscribeToEventsTool(workspaceId));
  server.registerTool(new UnsubscribeFromEventsTool(workspaceId));
  server.registerTool(new ListAgentsTool(workspaceId));
  server.registerTool(new GetAgentStatusTool(workspaceId));
  server.registerTool(new WakeOrCreateTaskAgentTool(workspaceId, workspacePath));
  server.registerTool(new ReadAgentConversationTool(workspaceId));
  server.registerTool(new GetAgentSummaryTool(workspaceId));
  server.registerTool(new ReportToParentTool(workspaceId));

  // Register cross-workspace tools for accessing notes from sibling workspaces
  server.registerTool(new ListSiblingWorkspacesTool(workspaceId));
  if (workspaceManager) {
    server.registerTool(new ReadExternalNoteTool(workspaceManager, workspaceId));
    server.registerTool(new ListExternalNotesTool(workspaceManager, workspaceId));
  }

  // Register browser tools for CDP access to embedded browser tabs
  server.registerTool(new BrowserExecTool());
  server.registerTool(new BrowserDocsTool());

  // Register terminal tools for agent access to user terminal sessions
  server.registerTool(new ListTerminalsTool(workspaceId));
  server.registerTool(new ReadTerminalOutputTool(workspaceId));

  // Register PR comment tools if workspace has an active PR
  if (workspaceManager) {
    try {
      const workspace = await workspaceManager.getWorkspace(workspaceId);
      if (
        workspace?.activePullRequest &&
        workspace.repositoryOwner &&
        workspace.repositoryName &&
        (workspace.activePullRequest.status === 'Open' || workspace.activePullRequest.status === 'Draft')
      ) {
        const prContext: PRContext = {
          owner: workspace.repositoryOwner,
          repo: workspace.repositoryName,
          prNumber: workspace.activePullRequest.number,
        };
        registerPRTools(server, prContext);
      }
    } catch (error) {
      // PR tool registration is best-effort — don't fail server creation
      logger.warn('Failed to check PR status for tool registration', error as Error);
    }
  }

  return server;
}
