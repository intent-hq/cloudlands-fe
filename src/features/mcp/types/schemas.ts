/**
 * MCP Tool Schemas
 *
 * JSON Schema definitions for all MCP tools.
 * These schemas define the input/output contracts for tools.
 */

import { z } from 'zod';

// ============================================================================
// Common Schemas
// ============================================================================

// i18n-ignore (MCP tool schema descriptions consumed by agents)
export const WorkspaceIdSchema = z.string().describe('Workspace identifier');
export const VersionSchema = z
  .string()
  .optional()
  // i18n-ignore (MCP tool schema descriptions consumed by agents)
  .describe('Resource version for optimistic concurrency');
// i18n-ignore (MCP tool schema descriptions consumed by agents)
export const RequestIdSchema = z.string().optional().describe('Idempotency key for retries');

export const ActorSchema = z.object({
  type: z.enum(['agent', 'user']),
  id: z.string(),
  name: z.string(),
});

// ============================================================================
// Workspace Tool Schemas
// ============================================================================

export const WorkspaceGetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceUpdateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  version: VersionSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  requestId: RequestIdSchema,
});

export const WorkspaceListSessionsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceCreateSessionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  agentName: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  requestId: RequestIdSchema,
});

// ============================================================================
// Notes Tool Schemas
// ============================================================================

export const NotesListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const NotesGetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
});

export const NotesCreateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  requestId: RequestIdSchema,
});

export const NotesUpdateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  version: VersionSchema,
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requestId: RequestIdSchema,
});

export const NotesAddCommentSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  version: VersionSchema,
  comment: z.object({
    text: z.string().min(1),
    author: z.string().optional(),
    at: z.string().datetime().optional(),
  }),
  requestId: RequestIdSchema,
});

export const NotesListCommentsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  status: z.enum(['open', 'resolved', 'pending']).optional(),
  type: z.string().optional(),
  author: z.string().optional(),
});

export const NotesDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  version: VersionSchema,
  requestId: RequestIdSchema,
});

export const NotesSuggestChangeSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  description: z.string(),
  original: z.string(),
  proposed: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  author: z.string(),
  authorType: z.enum(['user', 'agent']),
  section: z.string().optional(),
  reason: z.string().optional(),
  tags: z.string().optional(), // Comma-separated tags
});

export const NotesUpdateCommentStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  commentId: z.string(),
  status: z.enum(['open', 'resolved', 'pending']),
  resolvedBy: z.string().optional(),
});

export const NotesDeleteCommentSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  commentId: z.string(),
});

// ============================================================================
// Task Management Tool Schemas (Phase 1C)
// ============================================================================

export const TasksGetMyTaskSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  taskNoteId: z.string(),
});

export const TasksMarkAsTaskSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  taskMetadata: z.object({
    status: z.enum([
      'not_started',
      'waiting',
      'discussion_needed',
      'blocked',
      'in_progress',
      'review_required',
      'complete',
      'cancelled',
    ]),
    acceptanceCriteria: z.array(z.string()).optional(),
    estimatedEffort: z.string().optional(),
    actualEffort: z.string().optional(),
    blockedReason: z.string().optional(),
    peerOrder: z.number().optional(),
  }),
});

export const TasksCreatePrerequisiteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  dependentNoteId: z.string(),
  prerequisite: z.object({
    title: z.string(),
    content: z.string().optional(),
    taskMetadata: z
      .object({
        status: z.enum([
          'not_started',
          'waiting',
          'discussion_needed',
          'blocked',
          'in_progress',
          'review_required',
          'complete',
          'cancelled',
        ]),
        acceptanceCriteria: z.array(z.string()).optional(),
        estimatedEffort: z.string().optional(),
        peerOrder: z.number().optional(),
      })
      .optional(),
  }),
  spawnAgent: z.boolean().optional(),
  agentConfig: z
    .object({
      agentType: z.string().optional(),
      initialMessage: z.string().optional(),
    })
    .optional(),
});

export const TasksAssignAgentSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string(),
  agentId: z.string(),
});

// ============================================================================
// Git/FS Tool Schemas
// ============================================================================

export const GitStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string().optional(),
});

export const GitDiffSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string().optional(),
  staged: z.boolean().optional(),
  base: z.string().optional(),
});

export const GitCommitSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  message: z.string(),
  includeStaged: z.boolean().optional(),
  requestId: RequestIdSchema,
});

export const GitBranchSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  action: z.enum(['list', 'create', 'checkout', 'delete']),
  name: z.string().optional(),
  createFrom: z.string().optional(),
});

export const FsReadSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string(),
});

export const FsWriteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string(),
  content: z.string(),
  version: VersionSchema,
  requestId: RequestIdSchema,
});

export const FsApplyPatchSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  patch: z.string(),
  baseVersion: VersionSchema,
  requestId: RequestIdSchema,
});

export const FsDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string(),
  confirm: z.string().optional(),
});

export const FsRenameSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  oldPath: z.string(),
  newPath: z.string(),
});

export const FsMkdirSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  path: z.string(),
  recursive: z.boolean().optional(),
});

// ============================================================================
// Response Schemas
// ============================================================================

export const SuccessResponseSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  version: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});

export const ConflictErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.literal('CONFLICT'),
    message: z.string(),
    currentVersion: z.string(),
    currentState: z.any(),
  }),
});

// ============================================================================
// Tool Registry
// ============================================================================

export const TOOL_SCHEMAS = {
  // Workspace tools
  'workspace.get': WorkspaceGetSchema,
  'workspace.update': WorkspaceUpdateSchema,
  'workspace.listSessions': WorkspaceListSessionsSchema,
  'workspace.createSession': WorkspaceCreateSessionSchema,

  // Notes tools
  'notes.list': NotesListSchema,
  'notes.get': NotesGetSchema,
  'notes.create': NotesCreateSchema,
  'notes.update': NotesUpdateSchema,
  'notes.addComment': NotesAddCommentSchema,
  'notes.listComments': NotesListCommentsSchema,
  'notes.delete': NotesDeleteSchema,
  'notes.suggestChange': NotesSuggestChangeSchema,
  'notes.updateCommentStatus': NotesUpdateCommentStatusSchema,
  'notes.deleteComment': NotesDeleteCommentSchema,

  // Task management tools (Phase 1C)
  'tasks.getMyTask': TasksGetMyTaskSchema,
  'tasks.markAsTask': TasksMarkAsTaskSchema,
  'tasks.createPrerequisite': TasksCreatePrerequisiteSchema,
  'tasks.assignAgent': TasksAssignAgentSchema,

  // Git tools
  'git.status': GitStatusSchema,
  'git.diff': GitDiffSchema,
  'git.commit': GitCommitSchema,
  'git.branch': GitBranchSchema,

  // File system tools
  'fs.read': FsReadSchema,
  'fs.write': FsWriteSchema,
  'fs.applyPatch': FsApplyPatchSchema,
  'fs.delete': FsDeleteSchema,
  'fs.rename': FsRenameSchema,
  'fs.mkdir': FsMkdirSchema,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolInput<T extends ToolName> = z.infer<(typeof TOOL_SCHEMAS)[T]>;

// ============================================================================
// Type Guards
// ============================================================================

export function isSuccessResponse(
  response: any,
): response is z.infer<typeof SuccessResponseSchema> {
  return response?.success === true;
}

export function isErrorResponse(response: any): response is z.infer<typeof ErrorResponseSchema> {
  return response?.success === false;
}

export function isConflictError(response: any): response is z.infer<typeof ConflictErrorSchema> {
  return response?.success === false && response?.error?.code === 'CONFLICT';
}
