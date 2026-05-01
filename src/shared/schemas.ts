/**
 * Zod Schemas for Runtime Validation
 *
 * Provides runtime type checking for all domain objects.
 * Prevents corrupted data from being saved to disk.
 */

import { z } from 'zod';
import { AgentStatus, AuthorType, ContentType, NoteVisibility, WorkspaceStatus } from './types';

/**
 * Custom Validators
 */

/**
 * Custom Zod validator for workspace IDs
 * Accepts:
 * - Slug format: word-word (e.g., "amber-forest", "auth-refactor")
 * - Slug format with collision suffix: word-word-N (e.g., "amber-forest-2", "auth-refactor-3")
 *   Words must be lowercase letters only (2-15 chars each)
 * - Legacy UUID v4 format
 * - Legacy slug format with alphanumeric suffix: word-word-xxxx (backward compatibility)
 * - Optimistic workspace IDs
 */
export const workspaceIdSchema = z.string().refine(
  (id) => {
    // Check if it's an optimistic workspace ID
    if (id.startsWith('optimistic-')) {
      // Optimistic IDs have format: optimistic-{timestamp}-{random}
      const optimisticPattern = /^optimistic-\d+-[a-z0-9]+$/;
      if (optimisticPattern.test(id)) {
        return true;
      }
      // Fall through to slug/UUID checks for regular slugs that happen to start with "optimistic-"
    }

    // Check for new slug format: word-word or word-word-N (numeric suffix)
    // Each word must be 2-15 lowercase letters
    // Optional suffix is a number
    const slugPattern = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;
    if (slugPattern.test(id)) {
      return true;
    }

    // Legacy slug format: word-word-xxxx (4 alphanumeric chars)
    // Keep for backward compatibility with existing workspaces
    const legacySlugPattern = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
    if (legacySlugPattern.test(id)) {
      return true;
    }

    // Legacy UUID v4 regex pattern (more lenient - accepts any UUID)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(id);
  },
  {
    message:
      'Invalid space ID format. Must be a slug (e.g., "amber-forest"), UUID, or optimistic space ID',
  },
);

/**
 * Workspace Schemas
 */

const diffSummaryActionValues = ['create', 'modify', 'delete', 'rename'] as const;

export const DiffSummaryActionSchema = z.enum(diffSummaryActionValues);

export const DiffSummaryFileSchema = z.object({
  path: z.string(),
  action: DiffSummaryActionSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const DiffSummarySchema = z.object({
  schemaVersion: z.number().int(),
  updatedAt: z.string().datetime(),
  totalFiles: z.number().int().nonnegative(),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(DiffSummaryFileSchema).max(50),
});

export const WorkspaceSchema = z.object({
  id: workspaceIdSchema, // Accepts slug format, UUID, or optimistic IDs
  title: z.string().max(100),
  branch: z.string(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
  initialPrompt: z.string().optional(), // Initial user message for commit/PR generation
  changesets: z.array(z.any()),
  timeline: z.array(z.any()),
  conversationInfo: z.array(z.any()),
  status: z.nativeEnum(WorkspaceStatus),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archived: z.boolean().optional(),
  archivedAt: z.string().datetime().optional(),

  lastActivity: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  path: z.string().optional(),
  repositoryPath: z.string().optional(),
  repositoryOwner: z.string().optional(),
  repositoryName: z.string().optional(),
  worktreePath: z.string().optional(),
  scope: z.string().optional(), // Optional relative path within worktreePath
  skipWorktree: z.boolean().optional(),
  diffs: z.array(z.any()).optional(),
  diffSummary: DiffSummarySchema.optional(),
  // prUrl does NOT use .url() validation because empty strings can come from
  // normalizePullRequestInfo when no URL is found
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  prStatus: z.string().nullable().optional(),
  pullRequests: z.array(z.any()).optional(),
  activePullRequest: z.any().optional(),
  environmentConfig: z.any().optional(),
});

// SSH configuration schema for remote workspaces
export const SSHConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().positive().default(22),
  user: z.string(),
  password: z.string().optional(),
  key_path: z.string().optional(),
  use_agent: z.boolean().optional(),
  transport: z.enum(['ssh', 'websocket']).optional(),
  ws_url: z.string().optional(),
});

// Environment configuration schema
export const EnvironmentConfigSchema = z.object({
  type: z.enum(['local', 'remote']),
  ssh: SSHConfigSchema.optional(),
  workspace_path: z.string().optional(),
});

export const CreateWorkspaceRequestSchema = z.object({
  title: z.string().max(100).optional(),
  repositoryPath: z.string().optional(),
  githubUrl: z.string().optional(), // GitHub URL to clone (e.g., https://github.com/owner/repo)
  clonePath: z.string().optional(), // User-selected folder path where the GitHub repo should be cloned
  branch: z.string().optional(),
  baseRef: z.string().optional(),
  remote: z.string().optional(), // Git remote to use (default: 'origin', e.g., 'upstream' for forks)
  scope: z.string().optional(), // Optional relative path within worktreePath
  setupScript: z.string().optional(),
  environmentConfig: EnvironmentConfigSchema.optional(),
  isNewRepo: z.boolean().optional(),
  skipWorktree: z.boolean().optional(),
});

export const UpdateWorkspaceRequestSchema = z.object({
  title: z.string().max(100).optional(),
  branch: z.string().optional(),
  baseRef: z.string().optional(),
  status: z.nativeEnum(WorkspaceStatus).optional(),
  tags: z.array(z.string()).optional(),
  // prUrl does NOT use .url() validation because empty strings can come from
  // normalizePullRequestInfo when no URL is found
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  prStatus: z.string().nullable().optional(),
  activePullRequest: z.any().nullable().optional(),
  pullRequests: z.array(z.any()).optional(),
});

/**
 * First Visit State Schema
 */
export const FirstVisitStateSchema = z.object({
  version: z.number(),
  workspaceId: workspaceIdSchema,
  firstVisitSetupReady: z.boolean(),
  mainContentRevealed: z.boolean(),
  navigationRailRevealed: z.boolean(),
  workspaceDockRevealed: z.boolean(),
  lastUpdated: z.string().datetime(),
});

/**
 * Note Schemas
 */
export const AuthorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.nativeEnum(AuthorType),
  turnNumber: z.number().optional(),
});

/**
 * Task status schema
 * Designed for user-to-agent workflow
 */
export const TaskStatusSchema = z.enum([
  'not_started',
  'waiting',
  'discussion_needed',
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
]);

/**
 * Task metadata schema
 * Phase 1A: Basic task metadata
 * Phase 1C: Agent assignment tracking
 */
export const TaskMetadataSchema = z.object({
  status: TaskStatusSchema,
  assignedAgentIds: z.array(z.string()).optional(), // Phase 1C: Agent assignment
  acceptanceCriteria: z.array(z.string()).optional(),
  estimatedEffort: z.string().optional(),
  actualEffort: z.string().optional(),
  blockedReason: z.string().optional(),
  completedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
});

// Note: DependencyTypeSchema and NoteDependencySchema removed
// Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph

export const NoteMetadataSchema = z.object({
  author: AuthorSchema.optional(),
  lastAccessedAt: z.string().datetime().optional(),
  accessCount: z.number().optional(),
  wordCount: z.number().optional(),
  characterCount: z.number().optional(),
  sharedWith: z.array(z.string()).optional(),
  task: TaskMetadataSchema.optional(),
});

export const ReferenceSchema = z.object({
  type: z.enum(['file', 'url', 'note', 'commit', 'issue', 'pull_request']),
  target: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const NoteVersionSchema = z.object({
  versionId: z.string(),
  versionNumber: z.number(),
  content: z.string(),
  title: z.string(),
  author: AuthorSchema.optional(),
  createdAt: z.string().datetime(),
  changeSummary: z.string().optional(),
  diff: z.string().optional(),
});

// Schema for note IDs - allows UUIDs or special reserved IDs like 'spec'
const noteIdSchema = z.union([z.string().uuid(), z.literal('spec')]);

export const NoteSchema = z.object({
  id: noteIdSchema, // Allow "spec" as a special ID
  workspaceId: workspaceIdSchema,
  title: z.string(),
  content: z.string(),
  contentType: z.nativeEnum(ContentType),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  isDefault: z.boolean().optional(),
  parentId: noteIdSchema.optional(), // Allow special IDs as parent too
  visibility: z.nativeEnum(NoteVisibility),
  metadata: NoteMetadataSchema.optional(),
  references: z.array(ReferenceSchema).optional(),
  versions: z.array(NoteVersionSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Legacy compatibility fields
  is_pinned: z.boolean().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  is_archived: z.boolean().optional(),
});

export const CreateNoteRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  title: z.string().min(1),
  content: z.string(),
  contentType: z.nativeEnum(ContentType).optional(),
  tags: z.array(z.string()).optional(),
  parentId: noteIdSchema.optional(), // Allow special IDs as parent too
  visibility: z.nativeEnum(NoteVisibility).optional(),
});

export const UpdateNoteRequestSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  visibility: z.nativeEnum(NoteVisibility).optional(),
});

/**
 * Comment Schemas
 */
export const SuggestionDiffSchema = z.object({
  original: z.string(),
  proposed: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

export const NoteCommentSchema = z.object({
  id: z.string(), // Allow any string ID, not just UUIDs
  noteId: z.string(),
  author: z.string(),
  authorType: z.enum(['user', 'agent']),
  type: z.enum(['comment', 'suggestion', 'change-request', 'question', 'session']),
  content: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  section: z.string().optional(),
  status: z.enum(['open', 'resolved', 'pending']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parentId: z.string().optional(), // Allow any string ID for parent
  threadId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reactions: z.record(z.string(), z.string()).optional(),
  suggestionDiff: SuggestionDiffSchema.optional(),
  // Store exact positions for accurate mark placement
  from: z.number().optional(),
  to: z.number().optional(),
  // Store anchor IDs for the new comment system
  markId: z.string().optional(),
  // Track whether comment anchors are orphaned (missing from document)
  isOrphaned: z.boolean().optional(),
  // Link to agent for "session" type comments
  agentId: z.string().optional(),
});

export const NoteCommentsDataSchema = z.object({
  version: z.string(),
  comments: z.array(NoteCommentSchema),
  lastUpdated: z.string().datetime(),
});

export const AddCommentRequestSchema = z.object({
  id: z.string().optional(), // Allow frontend to provide its own ID
  workspaceId: workspaceIdSchema,
  noteId: z.string(),
  content: z.string().min(1),
  type: z.enum(['comment', 'suggestion', 'change-request', 'question', 'session']),
  author: z.string(),
  authorType: z.enum(['user', 'agent']),
  section: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  parentId: z.string().optional(), // Allow any string ID for parent
  threadId: z.string().optional(),
  tags: z.string().optional(),
  // Store exact positions for accurate mark placement
  from: z.number().optional(),
  to: z.number().optional(),
  markId: z.string().optional(),
  // Link to agent for "session" type comments
  agentId: z.string().optional(),
});

export const SuggestChangeRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  noteId: z.string(),
  description: z.string().min(1),
  original: z.string(),
  proposed: z.string(),
  author: z.string(),
  authorType: z.enum(['user', 'agent']),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  section: z.string().optional(),
  reason: z.string().optional(),
  tags: z.string().optional(),
});

export const UpdateCommentStatusRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
  noteId: z.string(),
  commentId: z.string(), // Allow any string ID
  status: z.enum(['open', 'resolved', 'pending']),
});

/**
 * Validation helpers
 */
export function validateWorkspace(data: unknown) {
  return WorkspaceSchema.parse(data);
}

export function validateNote(data: unknown) {
  return NoteSchema.parse(data);
}

export function validateComment(data: unknown) {
  return NoteCommentSchema.parse(data);
}

export function validateCommentsData(data: unknown) {
  return NoteCommentsDataSchema.parse(data);
}

export function validateFirstVisitState(data: unknown) {
  return FirstVisitStateSchema.parse(data);
}

/**
 * Safe validation (returns result instead of throwing)
 */
export function safeValidateWorkspace(data: unknown) {
  return WorkspaceSchema.safeParse(data);
}

export function safeValidateNote(data: unknown) {
  return NoteSchema.safeParse(data);
}

export function safeValidateComment(data: unknown) {
  return NoteCommentSchema.safeParse(data);
}

export function safeValidateCommentsData(data: unknown) {
  return NoteCommentsDataSchema.safeParse(data);
}

export function safeValidateFirstVisitState(data: unknown) {
  return FirstVisitStateSchema.safeParse(data);
}

/**
 * Agent System Schemas
 */

// ID Schemas
export const AgentIdSchema = z.string().uuid().or(z.string().startsWith('agent-'));
export const SessionIdSchema = z.string().startsWith('sess_').or(z.string().uuid());
export const MessageIdSchema = z.string().startsWith('msg_').or(z.string().uuid());

// Content Block Schema
export const ContentBlockSchema = z.object({
  type: z.enum(['text', 'code', 'tool_use', 'tool_result', 'thinking', 'image', 'audio', 'file']),
  text: z.string().optional(),
  content: z.string().optional(),
  language: z.string().optional(),
  name: z.string().optional(),
  input: z.any().optional(),
  tool_use_id: z.string().optional(),
  id: z.string().optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  is_error: z.boolean().optional(),
  isError: z.boolean().optional(),
  output: z.any().optional(),
  metadata: z.record(z.any()).optional(),
  // Media-specific fields (image, audio, file)
  data: z.string().optional(), // Base64 encoded data
  mimeType: z.string().optional(), // e.g., 'image/png', 'audio/mp3', 'text/plain'
  transcript: z.string().optional(), // For audio content
  fileName: z.string().optional(), // For file content
});

// Tool Call Schema
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.any()),
  result: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.string(),
  toolName: z.string().optional(),
  parameters: z.any().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

// Agent Message Schema
export const AgentMessageSchema = z.object({
  id: MessageIdSchema,
  appMessageId: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system', 'error']),
  contentBlocks: z.array(ContentBlockSchema).optional(),
  timestamp: z.union([z.string(), z.date()]),
  turnNumber: z.number().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(z.any()).optional(),
  error: z.string().optional(),
  isStreaming: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

// Agent Session Schema
export const AgentSessionSchema = z.object({
  id: AgentIdSchema,
  backendSessionId: z.string().nullable().optional(),
  acpSessionId: z.string().optional(),
  sessionId: z.string().nullable().optional(), // Legacy support
  workspaceId: workspaceIdSchema, // Accepts slug format, UUID, or optimistic IDs
  threadId: z.string().optional(),
  messages: z.array(AgentMessageSchema),
  name: z.string().optional(),
  nameExplicitlySet: z.boolean().optional(),
  currentTurnNumber: z.number().optional(),
  agentInfo: z.any().optional(),
  isInitialAgent: z.boolean().optional(),
  isBackground: z.boolean().optional(),
  model: z.string().optional(),
  provider: z.string().optional(), // ACP provider ID (e.g., "auggie", "claude-code", "opencode")
  systemPrompt: z.string().optional(),
  status: z.nativeEnum(AgentStatus),
  isProcessing: z.boolean().optional(),
  startedAt: z.union([z.string(), z.date()]).optional(),
  endedAt: z.union([z.string(), z.date()]).optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
  lastActivity: z.union([z.string(), z.date()]).optional(),
  progress: z.any().optional(),
  metadata: z.record(z.any()).optional(),
  agentMetadata: z.record(z.any()).optional(),
  fileChanges: z.array(z.any()).optional(),
  currentUserMessage: z.string().optional(),
  lastUserMessage: z.string().optional(),
  lastAgentResponse: z.string().optional(),
  isResponding: z.boolean().optional(),
  isStreaming: z.boolean().optional(),
  // Agent configuration (preserved from workspace creation)
  config: z
    .object({
      model: z.string().optional(),
      agentType: z.string().optional(),
      specialist: z.string().optional(), // Specialist type (spec-writer, implementor, verifier)
      behaviorPrompt: z.string().optional(), // Custom behavior instructions from specialist
      provider: z.string().optional(), // ACP provider (auggie, claude-code, codex)
      roleReminder: z.string().optional(), // Critical constraints reminder for the specialist
      specialistName: z.string().optional(), // Display name of the specialist (e.g., "Coordinator")
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
  // Fork metadata (for conversation forking)
  parentSessionId: z.string().optional(), // ID of parent session if this is a fork
  forkedAt: z.string().optional(), // When this session was forked from parent
  forkPoint: z.number().optional(), // Message index at which the fork occurred
  childSessionIds: z.array(z.string()).optional(), // IDs of sessions forked from this one
  forkMetadata: z
    .object({
      selectedText: z.string().optional(),
      selectedModel: z.string().optional(),
    })
    .optional(),
  // Task delegation
  digest: z.string().optional(), // Short summary for display in task status
});

/**
 * Helper to detect fields stripped by Zod validation.
 * Logs a warning when fields are silently removed - helps catch schema mismatches.
 */
function detectStrippedFields(
  input: unknown,
  output: unknown,
  schemaName: string,
  path: string = '',
): string[] {
  const stripped: string[] = [];

  if (
    typeof input !== 'object' ||
    input === null ||
    typeof output !== 'object' ||
    output === null
  ) {
    return stripped;
  }

  const inputObj = input as Record<string, unknown>;
  const outputObj = output as Record<string, unknown>;

  for (const key of Object.keys(inputObj)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (!(key in outputObj) && inputObj[key] !== undefined) {
      stripped.push(fullPath);
    } else if (
      typeof inputObj[key] === 'object' &&
      inputObj[key] !== null &&
      !Array.isArray(inputObj[key])
    ) {
      // Recurse into nested objects
      stripped.push(...detectStrippedFields(inputObj[key], outputObj[key], schemaName, fullPath));
    }
  }

  return stripped;
}

/**
 * Agent Validation Functions
 */

// Known removed fields that should be silently stripped without warnings
// These are fields that were intentionally removed from the schema (e.g., during refactoring)
// but may still exist in persisted data
const KNOWN_REMOVED_AGENT_FIELDS = [
  'config.modeId', // Removed in mode system cleanup
  'activationState', // Transient state, not persisted in schema
  'activationAttempts', // Transient state, not persisted in schema
  'isFirstWorkspaceAgent', // Transient state, not persisted in schema
];

export function validateAgentSession(data: unknown) {
  const result = AgentSessionSchema.parse(data);

  // Detect and warn about stripped fields (helps catch schema mismatches)
  const stripped = detectStrippedFields(data, result, 'AgentSessionSchema');

  // Filter out known removed fields that are expected to be stripped during migration
  const unexpectedStripped = stripped.filter(
    (field) => !KNOWN_REMOVED_AGENT_FIELDS.includes(field),
  );

  if (unexpectedStripped.length > 0) {
    // Log to stderr so it shows up in dev console
    console.warn(
      `[SCHEMA WARNING] AgentSessionSchema stripped fields: ${unexpectedStripped.join(', ')}. ` +
        'This may indicate missing fields in the schema definition.',
    );
  }

  return result;
}

export function validateAgentMessage(data: unknown) {
  return AgentMessageSchema.parse(data);
}

export function validateContentBlock(data: unknown) {
  return ContentBlockSchema.parse(data);
}

export function validateToolCall(data: unknown) {
  return ToolCallSchema.parse(data);
}

/**
 * Safe Agent Validation Functions
 */
export function safeValidateAgentSession(data: unknown) {
  return AgentSessionSchema.safeParse(data);
}

export function safeValidateAgentMessage(data: unknown) {
  return AgentMessageSchema.safeParse(data);
}

export function safeValidateContentBlock(data: unknown) {
  return ContentBlockSchema.safeParse(data);
}

export function safeValidateToolCall(data: unknown) {
  return ToolCallSchema.safeParse(data);
}
