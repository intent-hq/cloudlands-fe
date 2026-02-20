/**
 * Cross-workspace MCP tools.
 *
 * Allows agents to access notes from other workspaces within the same repository.
 * This enables knowledge sharing between related workspaces.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { ToolCall, ToolResult } from './protocol';
import { Logger } from '../../../../shared/logger';
import {
  FileSystemWorkspaceRepository,
  type WorkspaceRepository,
} from '../../../workspace/main/workspace.repository';
import type { Workspace } from '../../../../shared/types';
import type { WorkspaceId } from '../../../../shared/types/branded-ids';

const logger = new Logger('CrossWorkspaceTools');

// Singleton repository instance for production use
let repositoryInstance: WorkspaceRepository | null = null;

/**
 * Get the repository singleton lazily to avoid circular dependencies
 */
function getWorkspaceRepository(): WorkspaceRepository {
  if (!repositoryInstance) {
    repositoryInstance = new FileSystemWorkspaceRepository();
  }
  return repositoryInstance;
}

/**
 * Set a custom repository (for testing)
 */
export function setWorkspaceRepository(repo: WorkspaceRepository | null): void {
  repositoryInstance = repo;
}

/**
 * Tool to list sibling workspaces (workspaces in the same repository)
 */
export class ListSiblingWorkspacesTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'list_sibling_workspaces',
      `List other workspaces that share the same repository as the current workspace.

This is useful for:
- Discovering related work happening in parallel
- Finding notes and context from other workspace sessions
- Coordinating with work done in other workspaces

Returns a list of workspaces with their IDs, titles, and brief descriptions.`,
      createInputSchema({}, []),
    );
    this.workspaceId = workspaceId;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      const repository = getWorkspaceRepository();

      // Get current workspace to find its repository path
      const currentWorkspace = await repository.findById(this.workspaceId as WorkspaceId);
      if (!currentWorkspace) {
        return this.error('Current workspace not found');
      }

      if (!currentWorkspace.repositoryPath) {
        return this.error('Current workspace is not associated with a repository');
      }

      // Get all workspaces
      const allWorkspaces = await repository.findAll();

      // Filter to only workspaces with the same repository path (excluding current)
      const siblingWorkspaces = allWorkspaces.filter(
        (w: Workspace) =>
          w.id !== this.workspaceId && w.repositoryPath === currentWorkspace.repositoryPath,
      );

      if (siblingWorkspaces.length === 0) {
        return this.success(
          'No sibling workspaces found. This is the only workspace for this repository.',
          { count: 0, workspaces: [] },
        );
      }

      // Format the results
      const workspaceList = siblingWorkspaces.map((w: Workspace) => ({
        id: w.id,
        title: w.title || 'Untitled',
        branch: w.branch,
        status: w.status,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      }));

      const summary = siblingWorkspaces
        .map((w: Workspace) => `- **${w.title || 'Untitled'}** (ID: ${w.id}) - Branch: ${w.branch}`)
        .join('\n');

      return this.success(
        `Found ${siblingWorkspaces.length} sibling workspace(s) in the same repository:\n\n${summary}\n\nUse \`read_external_note\` to read notes from these workspaces.`,
        { count: siblingWorkspaces.length, workspaces: workspaceList },
      );
    } catch (error) {
      logger.error('Failed to list sibling workspaces', error as Error);
      return this.error(`Failed to list sibling workspaces: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to read a note from another workspace in the same repository
 */
export class ReadExternalNoteTool extends BaseMCPTool {
  private workspaceId: string;
  private workspaceManager: any;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'read_external_note',
      `Read a note from another workspace in the same repository.

This is useful for:
- Reviewing work done in related workspaces
- Getting context from previous workspace sessions
- Understanding decisions made in other branches

Use \`list_sibling_workspaces\` first to discover available workspaces.

Returns the note content with line numbers for reference.`,
      createInputSchema(
        {
          targetWorkspaceId: stringProperty(
            'The ID of the workspace containing the note (use list_sibling_workspaces to find IDs)',
          ),
          noteId: stringProperty(
            "The ID of the note to read (use 'spec' for the workspace specification)",
          ),
        },
        ['targetWorkspaceId', 'noteId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { targetWorkspaceId, noteId } = call.arguments;

      if (!targetWorkspaceId || !noteId) {
        return this.error('Both targetWorkspaceId and noteId are required');
      }

      // Validate this is a sibling workspace (same repository)
      const repository = getWorkspaceRepository();

      const currentWorkspace = await repository.findById(this.workspaceId as WorkspaceId);
      if (!currentWorkspace) {
        return this.error('Current workspace not found');
      }

      if (!currentWorkspace.repositoryPath) {
        return this.error('Current workspace is not associated with a repository');
      }

      const targetWorkspace = await repository.findById(targetWorkspaceId as WorkspaceId);
      if (!targetWorkspace) {
        return this.error(`Target workspace not found: ${targetWorkspaceId}`);
      }

      // Security check: only allow reading from workspaces with the same repository
      if (targetWorkspace.repositoryPath !== currentWorkspace.repositoryPath) {
        return this.error(
          'Access denied: Can only read notes from workspaces in the same repository',
        );
      }

      // Read the note from the target workspace
      const note = await this.workspaceManager.getNote(targetWorkspaceId, noteId);

      if (!note) {
        return this.error(`Note not found: ${noteId} in workspace ${targetWorkspaceId}`);
      }

      // Format with line numbers like ReadNoteTool does
      const content = note.content || '';
      const lines = content.split('\n');
      const numberedContent = lines
        .map((line: string, i: number) => {
          const lineNum = String(i + 1).padStart(4, ' ');
          return `${lineNum} | ${line}`;
        })
        .join('\n');

      const header = `# ${note.title || noteId}\n\n**From workspace:** ${targetWorkspace.title || targetWorkspaceId}\n**Branch:** ${targetWorkspace.branch}\n\n---\n\n`;

      return this.success(header + numberedContent, {
        noteId: note.id,
        title: note.title,
        sourceWorkspaceId: targetWorkspaceId,
        sourceWorkspaceTitle: targetWorkspace.title,
        lineCount: lines.length,
      });
    } catch (error) {
      logger.error('Failed to read external note', error as Error);
      return this.error(`Failed to read external note: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to list notes in a sibling workspace
 */
export class ListExternalNotesTool extends BaseMCPTool {
  private workspaceId: string;
  private workspaceManager: any;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'list_external_notes',
      `List all notes in another workspace in the same repository.

Use this to discover what notes exist in a sibling workspace before reading them.
Use \`list_sibling_workspaces\` first to discover available workspaces.`,
      createInputSchema(
        {
          targetWorkspaceId: stringProperty(
            'The ID of the workspace to list notes from (use list_sibling_workspaces to find IDs)',
          ),
        },
        ['targetWorkspaceId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { targetWorkspaceId } = call.arguments;

      if (!targetWorkspaceId) {
        return this.error('targetWorkspaceId is required');
      }

      // Validate this is a sibling workspace (same repository)
      const repository = getWorkspaceRepository();

      const currentWorkspace = await repository.findById(this.workspaceId as WorkspaceId);
      if (!currentWorkspace) {
        return this.error('Current workspace not found');
      }

      if (!currentWorkspace.repositoryPath) {
        return this.error('Current workspace is not associated with a repository');
      }

      const targetWorkspace = await repository.findById(targetWorkspaceId as WorkspaceId);
      if (!targetWorkspace) {
        return this.error(`Target workspace not found: ${targetWorkspaceId}`);
      }

      // Security check: only allow listing from workspaces with the same repository
      if (targetWorkspace.repositoryPath !== currentWorkspace.repositoryPath) {
        return this.error(
          'Access denied: Can only list notes from workspaces in the same repository',
        );
      }

      // List notes from the target workspace
      const notes = await this.workspaceManager.listNotes(targetWorkspaceId);

      if (!Array.isArray(notes) || notes.length === 0) {
        return this.success(
          `No notes found in workspace "${targetWorkspace.title || targetWorkspaceId}".`,
          { count: 0, notes: [] },
        );
      }

      const notesList = notes.map((note: any) => ({
        id: note.id,
        title: note.title,
        createdAt: note.created_at || note.createdAt,
        updatedAt: note.updated_at || note.updatedAt,
      }));

      const summary = notes.map((n: any) => `- **${n.title || n.id}** (ID: ${n.id})`).join('\n');

      return this.success(
        `Notes in workspace "${targetWorkspace.title || targetWorkspaceId}":\n\n${summary}\n\nUse \`read_external_note\` to read any of these notes.`,
        { count: notes.length, notes: notesList, sourceWorkspaceId: targetWorkspaceId },
      );
    } catch (error) {
      logger.error('Failed to list external notes', error as Error);
      return this.error(`Failed to list external notes: ${(error as Error).message}`);
    }
  }
}
