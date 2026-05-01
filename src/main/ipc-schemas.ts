/**
 * IPC Validation Schemas
 *
 * Comprehensive Zod schemas for all IPC handlers.
 * Ensures all IPC requests are validated before processing.
 */

import { z } from 'zod';
import { FirstVisitStateSchema } from '../shared/schemas';
import { isValidWorkspaceId } from '../shared/types/branded-ids';

// ============================================================================
// Common Schemas
// ============================================================================

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UuidSchema = z.string().regex(UUID_PATTERN, 'Invalid UUID format');

// Workspace IDs can be:
// 1. New slug format: word-word (e.g., "amber-forest", "auth-refactor")
// 2. New slug with collision suffix: word-word-N (e.g., "amber-forest-2")
// 3. Legacy slug format: word-word-xxxx (e.g., "amber-forest-a7x2") for backward compatibility
// 4. Legacy UUID format for backward compatibility
// 5. Special __root__ ID for root-level terminals (outside workspace context)
const WorkspaceIdSchema = z
  .string()
  .refine(
    isValidWorkspaceId,
    'Invalid workspace ID format (expected slug like "amber-forest" or "amber-forest-2", UUID, or __root__)',
  );
const AgentIdSchema = z.string().min(1, 'Agent ID is required');
const SessionIdSchema = z.string().min(1, 'Session ID is required');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MessageIdSchema = z.string().min(1, 'Message ID is required');

// ============================================================================
// Workspace Schemas
// ============================================================================

export const WorkspaceGetSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceGetCurrentSchema = z.object({}).passthrough();

export const WorkspaceGetByIdSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// SSH configuration schema for remote workspaces
const SSHConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().positive().default(22),
  user: z.string(),
  password: z.string().optional(),
  key_path: z.string().optional(),
  use_agent: z.boolean().optional(),
  transport: z.enum(['ssh', 'websocket']).optional(),
  ws_url: z.string().optional(),
});

// Environment configuration schema for remote workspaces
const EnvironmentConfigSchema = z.object({
  type: z.enum(['local', 'remote']),
  ssh: SSHConfigSchema.optional(),
  workspace_path: z.string().optional(),
});

export const WorkspaceCreateSchema = z.object({
  title: z.string().max(255, 'Title too long').optional(),
  path: z.string().optional(),
  template: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  repositoryPath: z.string().optional(),
  githubUrl: z.string().optional(), // GitHub URL to clone (e.g., https://github.com/owner/repo)
  clonePath: z.string().optional(), // User-selected folder path where the GitHub repo should be cloned
  branch: z.string().optional(),
  baseRef: z.string().optional(),
  scope: z.string().optional(), // Optional relative path within worktreePath
  setupScript: z.string().optional(), // Shell script to run in worktree after creation
  environmentConfig: EnvironmentConfigSchema.optional(), // Remote environment configuration
  isNewRepo: z.boolean().optional(), // If true, initialize a new git repository at repositoryPath
  skipWorktree: z.boolean().optional(), // If true, skip creating a git worktree and use repositoryPath directly
  initialAgent: z
    .object({
      agentId: z.string(),
      name: z.string().optional(),
      model: z.string().optional(),
      provider: z.string().optional(), // Provider ID (e.g., 'auggie', 'claude-code', 'codex')
      prompt: z.string().optional(),
      agentType: z.string().optional(),
      specialist: z.string().optional(), // Specialist or team coordinator ID (flexible to support any specialist)
      behaviorPrompt: z.string().optional(), // Custom behavior instructions (from team coordinator or specialist)
      contextReferences: z.array(z.any()).optional(),
      imageBlocks: z
        .array(z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }))
        .optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
});

export const WorkspaceUpdateSchema = z.object({
  id: WorkspaceIdSchema,
  title: z.string().optional(),
  branch: z.string().optional(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  // PR-related fields use .nullable() to distinguish between:
  // - undefined (field omitted): don't change the existing value
  // - null: explicitly clear the field (e.g., when PR is closed/merged)
  // - value: set the field to this value
  // Note: prUrl does NOT use .url() validation because empty strings can come from
  // normalizePullRequestInfo when no URL is found, and we need to allow those to pass
  // through validation (they'll be converted to null before storage)
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  prStatus: z.string().nullable().optional(),
  activePullRequest: z.any().nullable().optional(),
  pullRequests: z.array(z.any()).optional(),
});

export const WorkspaceDeleteSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceCloseSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceOpenSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceRenameSchema = z.object({
  id: WorkspaceIdSchema,
  newName: z.string().min(1, 'New name is required').max(255, 'Name too long'),
});

export const WorkspaceRenameBranchSchema = z.object({
  id: WorkspaceIdSchema,
  newBranchName: z.string().min(1, 'New branch name is required'),
});

export const WorkspaceDuplicateSchema = z.object({
  id: WorkspaceIdSchema,
  newTitle: z.string().min(1, 'New title is required').max(255, 'Title too long'),
});

export const WorkspaceArchiveSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceUnarchiveSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceCleanupSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspacePurgeSchema = z.object({});

export const WorkspaceActivateSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceGetRootSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceGetMetadataSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceUpdateMetadataSchema = z.object({
  id: WorkspaceIdSchema,
  metadata: z.record(z.any()),
});

export const WorkspaceSaveSchema = z.object({
  id: WorkspaceIdSchema,
  data: z.any(),
});

export const WorkspaceExportSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceImportSchema = z.object({
  data: z.any(),
});

export const WorkspaceListSchema = z.object({
  lite: z.boolean().optional(), // When true, skip heavy computations to avoid blocking other IPC operations
});

export const WorkspaceTestWatcherSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceGetRecentSchema = z.object({});

export const WorkspaceClearRecentSchema = z.object({});

export const WorkspaceGetStatsSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceGetHoverStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceValidateSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspacePreflightCloneCheckSchema = z.object({
  githubUrl: z.string().min(1, 'GitHub URL is required'),
});

export const WorkspaceRepairSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceBackupSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceRestoreSchema = z.object({
  id: WorkspaceIdSchema,
  backupPath: z.string().min(1, 'Backup path is required'),
});

export const WorkspaceGetSettingsSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceUpdateSettingsSchema = z.object({
  id: WorkspaceIdSchema,
  settings: z.record(z.any()),
});

export const WorkspaceGetRecentRepositoriesSchema = z.object({});

export const WorkspaceAddRecentRepositorySchema = z.object({
  repository: z.string().min(1, 'Repository is required'),
  name: z.string().optional(),
  owner: z.string().optional(),
});

export const WorkspaceClearRecentRepositoriesSchema = z.object({});

export const WorkspaceRemoveRecentRepositorySchema = z.object({
  repository: z.string().min(1, 'Repository path is required'),
});

export const WorkspaceUpdateGitInfoSchema = z.object({
  id: WorkspaceIdSchema,
  gitInfo: z.record(z.any()),
});

export const WorkspaceGetSettingsAltSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceUpdateSettingsAltSchema = z.object({
  id: WorkspaceIdSchema,
  settings: z.record(z.any()),
});

// ============================================================================
// File Schemas
// ============================================================================

export const FileReadSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  encoding: z.enum(['utf8', 'ascii', 'base64']).optional(),
  /** Maximum file size in bytes. If file exceeds this, returns an error. */
  maxSize: z.number().positive().optional(),
  /** If true, truncate content to maxSize instead of returning an error */
  truncateIfLarge: z.boolean().optional(),
  workspaceId: z.string().optional(), // For remote workspace file routing
});

export const FileWriteSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  encoding: z.enum(['utf8', 'ascii', 'base64']).optional(),
  workspaceId: z.string().optional(), // For immediate file tracking updates
});

export const FileDeleteSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  workspaceId: z.string().optional(),
});

export const FileListSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().optional(),
});

export const FileReadBatchSchema = z.object({
  requests: z.array(
    z.object({
      path: z.string().min(1, 'Path is required'),
    }),
  ),
  workspaceId: z.string().optional(), // For remote workspace file routing
});

export const FileExistsSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  workspaceId: z.string().optional(), // For remote workspace file routing
});

export const FileReadDirWithStatsSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export const FileGetGitignorepatternsSchema = z.object({
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

export const FileGetGitStatusSchema = z.object({
  workspacePath: z.string().min(1, 'Workspace path is required'),
  workspaceId: z.string().optional(), // For remote workspace file routing
});

export const FileGetTreeWithSizesSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  maxDepth: z.number().int().min(1).max(200).optional().default(50),
  excludePatterns: z.array(z.string()).optional().default([]),
});

export const FileMkdirSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export const FileMoveSchema = z.object({
  oldPath: z.string().min(1, 'Old path is required'),
  newPath: z.string().min(1, 'New path is required'),
});

export const FileCopySchema = z.object({
  sourcePath: z.string().min(1, 'Source path is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
});

export const FileGetDirectoryStatusSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

// ============================================================================
// Git Schemas
// ============================================================================

export const GitIsRepositorySchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export const GitStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitStageSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  paths: z.array(z.string()).min(1, 'At least one path is required'),
});

export const GitUnstageSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  paths: z.array(z.string()).min(1, 'At least one path is required'),
});

export const GitCommitSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  message: z.string().min(1, 'Commit message is required'),
  description: z.string().optional(),
});

export const GitPushSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  force: z.boolean().optional(),
});

export const GitPullSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitDiffSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  paths: z.array(z.string()).optional(),
  staged: z.boolean().optional(),
});

export const GitHistorySchema = z.object({
  workspaceId: WorkspaceIdSchema,
  limit: z.number().optional(),
  since: z.string().optional(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
});

export const GitRemoveLockSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitGetBranchesSchema = z.object({
  repoPath: z.string().min(1, 'Repository path is required'),
  includeRemote: z.boolean().optional(),
});

export const GitRenameBranchSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  oldBranchName: z.string().min(1, 'Old branch name is required'),
  newBranchName: z.string().min(1, 'New branch name is required'),
});

// ============================================================================
// Config Schemas
// ============================================================================

export const ConfigGetModelSchema = z.object({
  modelId: z.string().min(1, 'Model ID is required'),
});

export const ConfigGetAllModelsSchema = z.object({});

export const ConfigClearCacheSchema = z.object({});

export const ConfigInvalidateSchema = z.object({
  key: z.string().min(1, 'Key is required'),
});

export const ConfigGetSchema = z.object({
  key: z.string().optional(),
});

export const ConfigSetSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.any(),
});

// ============================================================================
// Agent Schemas
// ============================================================================

export const AgentCreateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  // workspacePath and name are optional - handler can derive them from workspace and instruction
  workspacePath: z.string().optional(),
  name: z.string().max(100, 'Name too long').optional(),
  agentId: AgentIdSchema.optional(),
  model: z.string().optional(),
  provider: z.string().optional(), // Provider ID (e.g., 'auggie', 'claude-code', 'codex')
  agentType: z.string().optional(), // Agent type for specialization rules
  behaviorPrompt: z.string().optional(), // Custom behavior instructions for the agent (from specialist)
  specialistName: z.string().optional(), // Display name of the specialist (e.g., "Coordinator")
  roleReminder: z.string().optional(), // Critical constraints reminder for the specialist
  initialMessage: z.string().optional(),
  skipInitialPrompt: z.boolean().optional(),
  instruction: z.string().optional(), // Used to derive name if not provided
  contextReferences: z.array(z.any()).optional(),
  contextRefs: z.array(z.any()).optional(), // Alias for contextReferences
  imageBlocks: z
    .array(z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }))
    .optional(),
  config: z.record(z.any()).optional(), // Nested config object from frontend
  metadata: z.record(z.any()).optional(),
});

export const AgentGetSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
});

export const AgentSendMessageSchema = z.object({
  agentId: AgentIdSchema,
  content: z.string().min(1, 'Message content is required'),
  contextReferences: z.array(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const AgentListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  includeDeleted: z.boolean().optional(),
});

// Additional Agent Backend Schemas
export const AgentBackendStreamMessageSchema = z
  .object({
    agentId: z.string().min(1, 'Agent ID is required'),
    sessionId: z.string().min(1, 'Session ID is required'),
    content: z.string(), // Allow empty - validated below
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    model: z.string().optional(),
    contextReferences: z.array(z.any()).optional(),
    imageBlocks: z
      .array(
        z.object({
          type: z.literal('image'),
          data: z.string(),
          mimeType: z.string(),
        }),
      )
      .optional(),
    fileBlocks: z
      .array(
        z.object({
          type: z.literal('file'),
          data: z.string(),
          mimeType: z.string(),
          fileName: z.string(),
        }),
      )
      .optional(),
    noteIds: z.array(z.string()).optional(),
    personality: z.string().optional(),
    stdinContext: z.string().optional(),
    agentName: z.string().optional(),
    systemPrompt: z.string().optional(),
    // Messages array for edit-and-regenerate flow
    // When the frontend edits a message, it truncates the conversation and passes
    // the truncated messages here so the backend uses them instead of loading from persistence
    messages: z.array(z.any()).optional(),
    // Reset session for edit-and-regenerate flow
    // When true, the backend will create a new ACP session before sending the message
    // This clears the session's internal history so it only sees the truncated messages
    resetHistory: z.boolean().optional(),
    // Specialist metadata - passed from frontend session.metadata for first message
    // This handles the case where user selects specialist before sending any messages
    // (before persistence has the specialist data)
    behaviorPrompt: z.string().optional(),
    specialist: z.string().optional(),
    specialistName: z.string().optional(), // Display name of the specialist (e.g., "Coordinator")
    roleReminder: z.string().optional(), // Critical constraints reminder for the specialist
    // Pre-assigned assistant message ID from the renderer so both sides share the same ID.
    // Must match 'msg_' followed by a UUID (hex + hyphens, 36 chars, case-insensitive).
    assistantMessageId: z
      .string()
      .regex(/^msg_[0-9a-f-]{36}$/i)
      .optional(),
    userAppMessageId: z.string().optional(),
    assistantAppMessageId: z.string().optional(),
    queuedMessageId: z.string().optional(),
    queuedMessageAppMessageId: z.string().optional(),
    skipUserMessage: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const hasContent = data.content && data.content.trim().length > 0;
    const hasImages = data.imageBlocks && data.imageBlocks.length > 0;
    const hasFiles = data.fileBlocks && data.fileBlocks.length > 0;

    if (!hasContent && !hasImages && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Message must have content, images, or files',
        path: ['content'],
      });
    }
  });

export const AgentBackendStopSchema = z.union([
  z.string().min(1, 'Agent ID is required'),
  z.object({
    agentId: z.string().min(1, 'Agent ID is required'),
  }),
]);

export const AgentGetSessionSchema = z.string().min(1, 'Agent ID is required');

export const AgentListSessionsSchema = z.string().min(1, 'Workspace ID is required');

export const AgentDeleteSessionSchema = z.union([
  z.string().min(1, 'Agent ID is required'),
  z.object({
    agentId: z.string().min(1, 'Agent ID is required'),
    sessionId: z.string().optional(),
    workspaceId: z.string().optional(),
  }),
  z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
    workspaceId: z.string().optional(),
  }),
]);

export const AgentPersistenceSaveSchema = z.object({
  agent: z.any(), // AgentSession type
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

export const AgentPersistenceLoadSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  workspacePath: z.string().optional(),
});

export const AgentPersistenceDeleteSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const AgentPersistenceListSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  workspacePath: z.string().optional(),
});

export const AgentPersistenceSaveMessageSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  message: z.any(), // AgentMessage type
});

export const AgentPersistenceBatchSchema = z.object({
  operations: z.array(
    z.object({
      type: z.enum(['save', 'load', 'delete']),
      params: z.any(),
    }),
  ),
});

export const AgentPersistenceMetricsSchema = z.any(); // No params

export const AgentPersistenceClearSchema = z.object({
  workspaceId: z.string().optional(),
});

export const AgentActivateSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  workspaceId: z.string().optional(), // Optional for backward compatibility
  sessionId: z.string().optional(), // Optional, used for session tracking
});

export const AgentLifecycleStartSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const AgentLifecycleStopSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const AgentMessagingSendSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  message: z.any(),
});

export const AgentMessagingReceiveSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const AgentSetModelSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  modelId: z.string().min(1, 'Model ID is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const AgentRenameSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  name: z.string().min(1, 'Name is required'),
});

// Message Queue Schemas
export const AgentQueueMessageSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  content: z.string().min(1, 'Message content is required'),
  contextItems: z.array(z.any()).optional(),
  imageBlocks: z
    .array(
      z.object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string(),
      }),
    )
    .optional(),
});

export const AgentEditQueuedMessageSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  messageId: z.string().min(1, 'Message ID is required'),
  content: z.string().min(1, 'Message content is required'),
});

export const AgentRemoveQueuedMessageSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  messageId: z.string().min(1, 'Message ID is required'),
});

export const AgentGetQueueSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const AgentGetUserRulesSchema = z.object({
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

export const AgentGetSpecializationRulesSchema = z.object({
  agentType: z.string().min(1, 'Agent type is required'),
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

// ============================================================================
// Persistence Schemas
// ============================================================================

export const PersistenceLoadSchema = z.object({
  key: z.string().min(1, 'Key is required'),
});

export const PersistenceLoadAgentConfigSchema = z.object({
  agentId: AgentIdSchema.optional(),
  workspaceId: WorkspaceIdSchema,
});

export const PersistenceLoadSessionSchema = z.object({
  agentId: AgentIdSchema.optional(),
  workspaceId: WorkspaceIdSchema,
});

export const PersistenceSaveSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  data: z.any(),
});

export const PersistenceSaveAgentConfigSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
  config: z.any(),
});

export const PersistenceSaveSessionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  session: z.any(),
  options: z
    .object({
      immediate: z.boolean().optional(),
      /** When true, allows the save to overwrite disk messages even if the frontend has fewer.
       *  Used by edit/regenerate flows that intentionally truncate message history. */
      allowTruncation: z.boolean().optional(),
    })
    .optional(),
});

export const PersistenceDeleteSchema = z.object({
  key: z.string().min(1, 'Key is required'),
});

export const PersistenceDeleteAgentSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceCleanupAgentsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const PersistenceLoadRegistrySchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
});

export const PersistenceSaveRegistrySchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  data: z.any(),
});

// ============================================================================
// MCP Schemas
// ============================================================================

// Optimistic workspace IDs have format: optimistic-{timestamp}-{random}
const OptimisticWorkspaceIdSchema = z
  .string()
  .regex(/^optimistic-\d+-[a-z0-9]+$/i, 'Invalid optimistic workspace ID format');

// Some MCP IPC calls can occur while a workspace is still being created.
// Allow either a real UUID workspaceId or an optimistic ID and resolve it in main.
const McpWorkspaceIdSchema = z.union([WorkspaceIdSchema, OptimisticWorkspaceIdSchema]);

export const McpTransitionWorkspaceSchema = z.object({
  optimisticId: OptimisticWorkspaceIdSchema,
  realId: WorkspaceIdSchema,
});

export const McpCallToolSchema = z.object({
  workspaceId: McpWorkspaceIdSchema,
  toolName: z.string().min(1, 'Tool name is required').max(100, 'Tool name too long'),
  arguments: z.record(z.any()).optional(),
});

export const McpListToolsSchema = z.object({
  workspaceId: McpWorkspaceIdSchema,
});

export const McpCreateServerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

export const McpGetStatusSchema = z.object({});

// ============================================================================
// Config Schemas (Additional)
// ============================================================================

export const ConfigGetAllSchema = z.object({});

// ============================================================================
// Comments Schemas
// ============================================================================

export const CommentsListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
  status: z.enum(['open', 'resolved', 'pending']).optional(),
  type: z.string().optional(),
  author: z.string().optional(),
});

export const CommentsGetSchema = z.object({
  commentId: z.string().min(1, 'Comment ID is required'),
  workspaceId: WorkspaceIdSchema,
});

export const CommentsCreateSchema = z.object({
  id: z.string().optional(),
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
  content: z.string().min(1, 'Content is required'),
  type: z.enum(['comment', 'suggestion', 'change-request', 'question', 'session']),
  author: z.string().min(1, 'Author is required'),
  authorType: z.enum(['user', 'agent']),
  section: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  parentId: z.string().optional(),
  threadId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  markId: z.string().optional(),
  agentId: z.string().optional(),
});

export const CommentsSuggestChangeSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
  description: z.string().min(1, 'Description is required'),
  original: z.string().min(1, 'Original text is required'),
  proposed: z.string().min(1, 'Proposed text is required'),
  author: z.string().min(1, 'Author is required'),
  authorType: z.enum(['user', 'agent']),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  section: z.string().optional(),
  reason: z.string().optional(),
  tags: z.string().optional(),
});

export const CommentsUpdateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
  commentId: z.string().min(1, 'Comment ID is required'),
  status: z.enum(['open', 'resolved', 'pending']),
});

export const CommentsDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
  commentId: z.string().min(1, 'Comment ID is required'),
});

// ============================================================================
// Events Schemas
// ============================================================================

// Actor schema for events
const EventActorSchema = z.object({
  type: z.enum(['user', 'agent', 'system', 'external']),
  id: z.string().optional(),
  name: z
    .string()
    .min(1, 'Actor name is required')
    .or(z.literal(''))
    .transform((v) => v || 'Unknown'),
  email: z.string().email().optional(),
  metadata: z.record(z.any()).optional(),
});

// Event filter schema
const EventFilterSchema = z.object({
  field: z.string(),
  operator: z.enum([
    'equals',
    'not_equals',
    'greater_than',
    'less_than',
    'starts_with',
    'ends_with',
    'contains',
    'matches',
    'in',
    'not_in',
  ]),
  value: z.any(), // value is required, not optional
});

export const EventsEmitSchema = z.object({
  event: z.object({
    id: z.string().min(1, 'Event ID is required'),
    type: z.enum([
      'file:changed',
      'file:created',
      'file:deleted',
      'file:renamed',
      'agent:started',
      'agent:completed',
      'agent:failed',
      'agent:tool:call',
      'agent:message',
      'git:commit',
      'git:push',
      'git:pull',
      'git:branch',
      'git:merge',
      'note:created',
      'note:updated',
      'note:deleted',
      'terminal:command',
      'test:started',
      'test:completed',
      'build:started',
      'build:completed',
      'workspace:created',
      'workspace:updated',
      'workspace:deleted',
      'workspace:opened',
      'workspace:closed',
      'workspace:activity',
      'spec:updated',
      'goal:updated',
      'comment:added',
    ]),
    workspaceId: WorkspaceIdSchema,
    actor: EventActorSchema,
    timestamp: z.string().min(1, 'Timestamp is required'),
    sessionId: z.string().optional(),
    correlationId: z.string().optional(),
    parentEventId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
    data: z.any().optional(),
  }),
  options: z
    .object({
      broadcast: z.boolean().optional(),
      persist: z.boolean().optional(),
    })
    .optional(),
});

export const EventsSubscribeSchema = z.object({
  subscriptionId: z.string().min(1, 'Subscription ID is required'),
  filters: z.array(z.any()),
  includeHistorical: z.boolean().optional(),
  historicalLimit: z.number().optional(),
});

export const EventsUnsubscribeSchema = z.object({
  subscriptionId: z.string().min(1, 'Subscription ID is required'),
});

export const EventsQuerySchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filters: z.array(z.any()),
  limit: z.number().optional(),
});

export const EventsGetLastEventSchema = z.object({
  type: z.enum([
    'file:changed',
    'file:created',
    'file:deleted',
    'file:renamed',
    'agent:started',
    'agent:completed',
    'agent:failed',
    'agent:tool:call',
    'agent:message',
    'git:commit',
    'git:push',
    'git:pull',
    'git:branch',
    'git:merge',
    'note:created',
    'note:updated',
    'note:deleted',
    'terminal:command',
    'test:started',
    'test:completed',
    'build:started',
    'build:completed',
    'workspace:created',
    'workspace:updated',
    'workspace:deleted',
    'workspace:opened',
    'workspace:closed',
    'workspace:activity',
    'spec:updated',
    'goal:updated',
    'comment:added',
  ]),
  workspaceId: WorkspaceIdSchema.optional(),
});

export const EventsGetStatisticsSchema = z.object({});

// New Events schemas for handlers that need object parameters
export const EventsInitializeSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const EventsQueryHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filters: z.array(EventFilterSchema).nullable().optional(),
  limit: z.number().optional(),
});

export const EventsGetRecentFilesHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  limit: z.number().default(10).optional(),
});

export const EventsGetAgentActivityHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  minutesAgo: z.number().default(30).optional(),
});

export const EventsGetSummaryHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  minutesAgo: z.number().default(60).optional(),
});

export const EventsGetStatsHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const EventsClearHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const EventsSubscribeHandlerSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filters: z.array(EventFilterSchema).nullable().optional(),
});

export const EventsUnsubscribeHandlerSchema = z.object({
  subscriptionId: z.string().min(1, 'Subscription ID is required'),
});

// ============================================================================
// Git Tracking Schemas
// ============================================================================

export const GitTrackingGetStateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitTrackingGetSyncStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitTrackingSyncSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const GitTrackingGetFileDiffSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filePath: z.string().min(1, 'File path is required'),
  staged: z.boolean(),
});

export const GitTrackingIsGithubAuthenticatedSchema = z.object({});

export const GitTrackingGetGithubBranchesSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
});

export const GitTrackingGetPullRequestsSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  options: z.any().optional(),
  force: z.boolean().optional(),
});

export const GitTrackingSearchPullRequestsSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  options: z
    .object({
      filter: z.enum(['all', 'assigned', 'created', 'review-requested', 'involves']).optional(),
      state: z.enum(['open', 'closed']).optional(),
      per_page: z.number().optional(),
    })
    .optional(),
  force: z.boolean().optional(),
});

export const GitTrackingGetPullRequestSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  number: z.number().int().positive('Pull request number must be positive'),
  force: z.boolean().optional(),
});

export const GitTrackingCreatePullRequestSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  options: z.any(),
});

export const GitTrackingGetCheckRunsSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  commitSha: z.string().min(1, 'Commit SHA is required'),
});

export const GitTrackingGetPRReviewsSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  number: z.number().int().positive('Pull request number must be positive'),
});

export const GitTrackingGetGithubIssuesSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  options: z.any().optional(),
});

export const GitTrackingSearchGithubIssuesSchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repository is required'),
  options: z
    .object({
      filter: z.enum(['all', 'assigned', 'created', 'review-requested', 'involves']).optional(),
      state: z.enum(['open', 'closed']).optional(),
      per_page: z.number().optional(),
    })
    .optional(),
});

export const GitTrackingGetRemoteUrlSchema = z.object({
  repoPath: z.string().min(1, 'Repository path is required'),
});

// ============================================================================
// Agent Testing Schemas
// ============================================================================

export const AgentTestingRunSchema = z.object({
  type: z.enum(['ipc', 'component', 'integration', 'unit', 'e2e']),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  tests: z.array(z.any()),
  options: z
    .object({
      coverage: z.boolean().optional(),
      parallel: z.boolean().optional(),
      timeout: z.number().optional(),
      outputPath: z.string().optional(),
    })
    .optional(),
});

export const AgentTestingGetReportSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
});

export const AgentTestingGetAgentReportsSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const AgentTestingCleanupSchema = z.object({
  daysToKeep: z.number().min(0, 'Days to keep must be non-negative'),
});

// ============================================================================
// File Tracking Schemas
// ============================================================================

export const FileTrackingInitSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const FileTrackingSyncSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  force: z.boolean().optional().default(false),
});

export const FileTrackingLoadSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const FileTrackingLoadCommitsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  limit: z.number().int().positive().max(200).optional(),
});

export const FileTrackingLoadOlderCommitsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  beforeSha: z.string().min(1, 'Before SHA is required'),
  limit: z.number().int().positive().max(50).optional(),
});

export const FileTrackingLoadTransitionsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const FileTrackingTrackChangeSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  change: z.object({
    file: z.string().min(1, 'File path is required'),
    relativePath: z.string().optional(),
    stage: z.enum(['unstaged', 'staged', 'committed', 'pushed', 'pull_request', 'merged', 'trunk']),
    type: z.enum(['added', 'modified', 'deleted']).optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    stats: z
      .object({
        additions: z.number().min(0),
        deletions: z.number().min(0),
        binary: z.boolean().optional(),
      })
      .optional(),
    attribution: z
      .object({
        agent: z
          .object({
            agentId: z.string(),
            agentName: z.string(),
            sessionId: z.string(),
            turnNumber: z.number(),
            messageId: z.string().optional(),
            toolCallId: z.string().optional(),
            timestamp: z.number(),
          })
          .optional(),
        manual: z.boolean().optional(),
        timestamp: z.number(),
      })
      .optional(),
    commitHash: z.string().optional(),
    prNumber: z.number().optional(),
    content: z
      .object({
        oldContent: z.string().optional(),
        newContent: z.string().optional(),
        diff: z.string().optional(),
      })
      .optional(),
  }),
});

export const FileTrackingStageChangesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  changeIds: z.array(z.string().min(1)),
});

export const FileTrackingUnstageChangesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  changeIds: z.array(z.string().min(1)),
});

export const FileTrackingGetChangesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  filter: z
    .object({
      stage: z
        .enum(['unstaged', 'staged', 'committed', 'pushed', 'pull_request', 'merged', 'trunk'])
        .optional(),
      agentId: z.string().optional(),
      sessionId: z.string().optional(),
      turnNumber: z.number().optional(),
      filePattern: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
    })
    .optional(),
});

export const FileTrackingGetLineStatsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const FileTrackingListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const FileTrackingGetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filePath: z.string().min(1, 'File path is required'),
});

export const FileTrackingUpdateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filePath: z.string().min(1, 'File path is required'),
  status: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// ============================================================================
// Line Attribution Schemas
// ============================================================================

export const LineAttributionLoadSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
});

export const LineAttributionComputeNowSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  noteId: z.string().min(1, 'Note ID is required'),
});

// ============================================================================
// System Schemas
// ============================================================================

export const SystemGetInfoSchema = z.object({});

export const SystemGetVersionSchema = z.object({});

export const SystemWriteClipboardSchema = z.object({
  text: z.string(),
});

export const SystemOpenExternalSchema = z.object({
  url: z.string().url('Invalid URL'),
});

// ============================================================================
// Terminal Schemas
// ============================================================================

export const TerminalCreateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  cwd: z.string().optional(),
});

export const TerminalExecuteSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
  command: z.string().min(1, 'Command is required'),
});

export const TerminalCloseSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
});

// Professional Terminal Schemas
export const TerminalProfessionalCreateSchema = z.object({
  terminalId: z.string().optional(),
  workspaceId: WorkspaceIdSchema,
  cwd: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
});

export const TerminalProfessionalListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const TerminalProfessionalWriteSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
  data: z.string(),
});

export const TerminalProfessionalResizeSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const TerminalProfessionalInfoSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
});

export const TerminalProfessionalRefreshSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
});

export const TerminalProfessionalDisposeSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
});

export const TerminalProfessionalGetBufferSchema = z.object({
  terminalId: z.string().min(1, 'Terminal ID is required'),
});

// Terminal with command schema (for CLI blocks)
export const TerminalCreateWithCommandSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  command: z.string().min(1, 'Command is required'),
  cwd: z.string().optional(),
  title: z.string().optional(),
  env: z.record(z.string()).optional(),
  /**
   * When `true`, the command text is written to the PTY prompt but NOT
   * executed — the trailing `\r` is skipped so the user has to press
   * Enter themselves. Used by the onboarding install buttons so users can
   * review the command (e.g. `npm install -g …`) before running it.
   * Defaults to `false` (existing auto-run behavior).
   */
  pasteOnly: z.boolean().optional(),
});

// Legacy Terminal Schemas
// ============================================================================
// Diffs Schemas
// ============================================================================

export const DiffsListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const DiffsCreateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  diff: z.any(), // The diff object structure varies
});

export const DiffsUpdateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  diff: z.any(), // The diff object structure varies
});

export const DiffsGetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  filePath: z.string().min(1, 'File path is required'),
  staged: z.boolean().optional(),
});

// Line Changes Schemas
export const LineChangesMarkAgentActiveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  agentName: z.string().min(1, 'Agent name is required'),
  durationMs: z.number().int().positive().optional(),
});

export const LineChangesGetCurrentSchema = z.union([
  WorkspaceIdSchema,
  z.object({
    workspaceId: WorkspaceIdSchema,
  }),
]);

export const LineChangesStartAgentExecutionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  agentName: z.string().min(1, 'Agent name is required'),
  sessionId: SessionIdSchema.optional(),
  turnNumber: z.number().int().min(0).optional(),
});

export const LineChangesStopAgentExecutionSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const LineChangesMarkAgentModifiedFilesSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  files: z.array(z.string()),
});

// ============================================================================
// Agent Context Schemas
// ============================================================================

export const AgentContextGetSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
});

export const AgentContextSetSchema = z.object({
  agentId: AgentIdSchema,
  workspaceId: WorkspaceIdSchema,
  context: z.any(),
});

export const AgentContextUpdateSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  agentName: z.string().min(1, 'Agent name is required'),
  sessionId: z.string().min(1, 'Session ID is required'),
  turnNumber: z.number().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const AgentContextGetByWorkspaceSchema = z.string().min(1, 'Workspace ID is required');

export const AgentContextGetBySessionSchema = z.string().min(1, 'Session ID is required');

// ============================================================================
// Notes Schemas
// ============================================================================

export const NotesListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const NotesGetSchema = z.object({
  noteId: z.string().min(1, 'Note ID is required'),
  workspaceId: WorkspaceIdSchema,
});

export const NotesCreateSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  title: z.string().min(1, 'Title is required'),
  content: z.string(), // Allow empty content for new notes
  contentType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  visibility: z.string().optional(),
  id: z.string().optional(),
  isDefault: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export const NotesUpdateSchema = z.object({
  id: z.string().min(1, 'Note ID is required'),
  workspaceId: WorkspaceIdSchema,
  content: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  visibility: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  isUserAction: z.boolean().optional(),
});

export const NotesDeleteSchema = z.object({
  id: z.string().min(1, 'Note ID is required'),
  workspaceId: WorkspaceIdSchema,
});

export const NotesRestoreSpecSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  versionId: z.string().min(1, 'Version ID is required'),
});

export const NotesBatchListSchema = z.object({
  workspaceIds: z.array(WorkspaceIdSchema).min(1, 'At least one workspace ID is required'),
});

// ============================================================================
// Assets Schemas
// ============================================================================

export const AssetsSaveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  data: z.string().min(1, 'Image data is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  originalName: z.string().optional(),
});

export const AssetsGetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  assetId: z.string().min(1, 'Asset ID is required'),
});

export const AssetsDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  assetId: z.string().min(1, 'Asset ID is required'),
});

export const AssetsListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// ============================================================================
// System Schemas
// ============================================================================

// APP_CHANNELS schemas
export const AppSetBadgeSchema = z.object({
  count: z.number().int().min(0, 'Badge count must be non-negative'),
});

export const AppPathSchema = z.object({
  name: z.enum([
    'home',
    'appData',
    'userData',
    'sessionData',
    'temp',
    'exe',
    'module',
    'desktop',
    'documents',
    'downloads',
    'music',
    'pictures',
    'videos',
    'recent',
    'logs',
    'crashDumps',
  ]),
});

// WINDOW_CHANNELS schemas
export const WindowCreateSchema = z.object({
  route: z.string().optional(),
});

export const WindowOpenNewSchema = z.object({
  route: z.string().optional(),
});

export const WindowSetThemeSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
});

export const WindowSetTitleSchema = z.object({
  title: z.string(),
});

export const WindowSetInWorkspaceSchema = z.object({
  inWorkspace: z.boolean(),
  workspaceId: z.string().optional(),
});

export const WindowSetOpenWorkspaceTabsSchema = z.object({
  workspaceIds: z.array(z.string()),
});

export const WindowSetBrowserFocusedSchema = z.object({
  browserFocused: z.boolean(),
});

// DIALOG_CHANNELS schemas
export const DialogOpenSchema = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  filters: z
    .array(
      z.object({
        name: z.string(),
        extensions: z.array(z.string()),
      }),
    )
    .optional(),
  directory: z.boolean().optional(),
  multiple: z.boolean().optional(),
  createDirectory: z.boolean().optional(), // Allow creating new folders in the dialog (macOS)
  properties: z.array(z.string()).optional(),
});

export const DialogSaveSchema = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  filters: z
    .array(
      z.object({
        name: z.string(),
        extensions: z.array(z.string()),
      }),
    )
    .optional(),
  buttonLabel: z.string().optional(),
  message: z.string().optional(),
  nameFieldLabel: z.string().optional(),
  showsTagField: z.boolean().optional(),
});

export const DialogMessageSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  type: z.enum(['info', 'warning', 'error', 'question']).optional(),
  buttons: z.array(z.string()).optional(),
});

// SHELL_CHANNELS schemas
export const ShellOpenExternalSchema = z.object({
  url: z.string().refine(
    (val) => {
      // Allow http, https, mailto, and other common protocols
      return /^(https?|mailto|tel|file):/.test(val);
    },
    { message: 'Invalid URL format - must start with http, https, mailto, tel, or file' },
  ),
});

export const ShellShowItemInFolderSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

export const ShellInstallCliSchema = z.object({}).strict();

// VSCODE_CHANNELS schemas
export const VscodeOpenSchema = z.union([
  z.string().min(1, 'Path is required'),
  z.object({
    folder: z.string().min(1, 'Folder path is required'),
    file: z.string().min(1, 'File path is required'),
  }),
]);

export const VscodeOpenGitDiffSchema = z.object({
  filePath: z.string().min(1, 'File path is required'),
  workspacePath: z.string().optional(),
});

export const VscodeOpenDiffSchema = z.object({
  oldContent: z.string(),
  newContent: z.string(),
  oldFileName: z.string().min(1, 'Old file name is required'),
  newFileName: z.string().min(1, 'New file name is required'),
  filePath: z.string().min(1, 'File path is required'),
});

export const VscodeOpenFileSchema = z.object({
  file: z.string().min(1, 'File path is required'),
  line: z.number().int().positive().optional(),
});

// JETBRAINS_CHANNELS schemas
export const JetbrainsOpenSchema = z.union([
  z.string().min(1, 'Path is required'),
  z.object({
    folder: z.string().min(1, 'Folder path is required'),
    file: z.string().min(1, 'File path is required'),
  }),
]);

// XCODE_CHANNELS schemas
export const XcodeOpenSchema = z.union([
  z.string().min(1, 'Path is required'),
  z.object({
    folder: z.string().min(1, 'Folder path is required'),
    file: z.string().optional(),
    // Optional: list of changed file paths (relative to folder) to help find the right Xcode project in monorepos
    changedFiles: z.array(z.string()).optional(),
  }),
]);

// SETTINGS_CHANNELS schemas
export const SettingsGetSchema = z.object({
  key: z.string().min(1, 'Settings key is required'),
});

export const SettingsSetSchema = z.object({
  key: z.string().min(1, 'Settings key is required'),
  value: z.any(),
});

export const SettingsUpdateSchema = z.object({
  settings: z.record(z.any()),
});

// USER_MCP_CHANNELS schemas
export const UserMcpWriteSettingsFileSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

export const UserMcpGetWorkspaceDisabledSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const UserMcpSetWorkspaceDisabledSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  disabledServers: z.array(z.string()),
});

// MCP CLI command schemas
export const UserMcpAddSchema = z.object({
  name: z.string().min(1, 'Server name is required'),
  transport: z.enum(['stdio', 'http', 'sse']),
  // For stdio transport
  command: z.string().optional(),
  args: z.string().optional(),
  env: z.record(z.string()).optional(),
  // For http/sse transport
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  // Auth type (oauth, header, none) — persisted directly to settings.json
  authType: z.enum(['oauth', 'header', 'none']).optional(),
  // Options
  replace: z.boolean().optional(),
});

export const UserMcpRemoveSchema = z.object({
  name: z.string().min(1, 'Server name is required'),
});

export const UserMcpCheckAuthSchema = z.object({
  url: z.string().min(1, 'URL is required'),
});

export const UserMcpTestConnectionSchema = z.object({
  url: z.string().min(1, 'URL is required'),
  headers: z.record(z.string()).optional(),
  name: z.string().optional(), // Server name for OAuth token lookup
});

export const UserMcpInitiateOAuthSchema = z.object({
  name: z.string().min(1, 'Server name is required'),
  url: z.string().min(1, 'URL is required'),
});

// SYSTEM_CHANNELS schemas
export const SystemExecuteCommandSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  cwd: z.string().optional(),
});

export const SystemExecuteCommandStreamingSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  command: z.string().min(1, 'Command is required'),
  cwd: z.string().optional(),
  stdin: z.string().optional(),
  sshConfig: z.any().optional(),
});

// DEEP_LINK_CHANNELS schemas
export const DeepLinkHandleSchema = z.object({
  url: z.string().min(1, 'URL is required'),
});

// Empty schemas for handlers with no parameters
// Accepts undefined, null, void, or an empty object (frontend often sends {})
export const EmptySchema = z.undefined().or(z.null()).or(z.void()).or(z.object({}).strict());

// ============================================================================
// Remote File System Schemas
// ============================================================================

// SSH Connection Config Schema
// Note: host can be empty for WebSocket transport (connection goes through wsUrl instead)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SSHConnectionConfigSchema = z
  .object({
    host: z.string(),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1, 'Username is required'),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    privateKeyPath: z.string().optional(),
    passphrase: z.string().optional(),
    useAgent: z.boolean().optional(),
    transport: z.enum(['ssh', 'websocket']).optional(),
    wsUrl: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.transport === 'websocket') return !!data.wsUrl;
      if (data.transport === 'ssh' || !data.transport) return data.host.length > 0;
      return true;
    },
    { message: 'WebSocket transport requires wsUrl; SSH transport requires non-empty host' },
  );

// Remote File System Config Schema
export const RemoteFSInitializeSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  basePath: z.string().min(1, 'Base path is required'),
});

// Read File Schema
export const RemoteFSReadFileSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  encoding: z.string().default('utf-8').optional(),
});

// Write File Schema
export const RemoteFSWriteFileSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  encoding: z.string().default('utf-8').optional(),
});

// Append File Schema
export const RemoteFSAppendFileSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
});

// Delete File Schema
export const RemoteFSDeleteFileSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
});

// Read Directory Schema
export const RemoteFSReaddirSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
});

// Make Directory Schema
export const RemoteFSMkdirSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().default(true).optional(),
});

// Remove Directory Schema
export const RemoteFSRmdirSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().default(false).optional(),
});

// Exists Schema
export const RemoteFSExistsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
});

// Stat Schema
export const RemoteFSStatSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
});

// Copy Schema
export const RemoteFSCopySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  source: z.string().min(1, 'Source path is required'),
  destination: z.string().min(1, 'Destination path is required'),
  recursive: z.boolean().default(false).optional(),
});

// Move Schema
export const RemoteFSMoveSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  source: z.string().min(1, 'Source path is required'),
  destination: z.string().min(1, 'Destination path is required'),
});

// Find Schema
export const RemoteFSFindSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  pattern: z.string().min(1, 'Pattern is required'),
  dirPath: z.string().optional(),
});

// Grep Schema
export const RemoteFSGrepSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  pattern: z.string().min(1, 'Pattern is required'),
  filePath: z.string().min(1, 'File path is required'),
  options: z
    .object({
      ignoreCase: z.boolean().optional(),
      recursive: z.boolean().optional(),
      maxResults: z.number().optional(),
    })
    .optional(),
});

// Disconnect Schema
export const RemoteFSDisconnectSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

// Status Schema
export const RemoteFSStatusSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

// Clear Cache Schema
export const RemoteFSClearCacheSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

// ============================================================================
// Additional Workspace Schemas (continued)
// ============================================================================

export const WorkspaceUpdateSpecWatcherTimestampSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const WorkspaceUpdateCurrentContextSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  context: z.record(z.any()).optional(),
});

export const WorkspaceLoadRulesSchema = z.object({
  id: z.string().min(1, 'Workspace ID is required'),
});

export const WorkspaceFindRepositoriesSchema = z.object({
  directory: z.string().optional(),
});

export const EditorGetSelectionSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required').optional(),
});

export const WorkspaceListFilesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  pattern: z.string().optional(),
  limit: z.number().optional(),
});

export const WorkspaceSearchInFilesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  query: z.string().min(1, 'Search query is required'),
  limit: z.number().optional(),
});

export const WorkspaceTriggerCheckSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  reason: z.string().optional(),
});

export const DeepLinkValidateWorkspaceSchema = z.object({
  id: z.string().min(1, 'Workspace ID is required'),
});

// ============================================================================
// First Visit State Schemas
// Using strict workspace ID validation and shared FirstVisitStateSchema
// ============================================================================

export const FirstVisitStateLoadSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const FirstVisitStateSaveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  state: FirstVisitStateSchema,
});

export const FirstVisitStateDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const FirstVisitStateExistsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// ============================================================================
// Panel Layout Schemas
// ============================================================================

const LayoutSnapshotSchema = z.object({
  root: z.any(),
  panels: z.record(z.any()),
  focusedPanelId: z.string().nullable(),
  timestamp: z.number(),
});

export const PanelLayoutLoadSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const PanelLayoutSaveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  data: z.object({
    version: z.number(),
    workspaceId: z.string(),
    history: z.array(LayoutSnapshotSchema),
    historyIndex: z.number(),
    lastUpdated: z.string(),
  }),
});

// ============================================================================
// Testing Schemas
// ============================================================================

export const TestingRunTestsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  testFiles: z.array(z.string()).optional(),
  testPattern: z.string().optional(),
  coverage: z.boolean().optional(),
  watch: z.boolean().optional(),
  timeout: z.number().optional(),
});

export const TestingRunLintSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  files: z.array(z.string()).optional(),
  fix: z.boolean().optional(),
});

export const TestingRunBuildSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  target: z.string().optional(),
  watch: z.boolean().optional(),
  production: z.boolean().optional(),
});

export const TestingStopProcessSchema = z.object({
  processId: z.string().min(1, 'Process ID is required'),
});

export const TestingGetProcessesSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

// ============================================================================
// Line Changes Schemas (Additional)
// ============================================================================

export const LineChangesGetWorkspaceStatsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const LineChangesGetAgentStatsSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

export const LineChangesCalculateDiffSchema = z.object({
  oldContent: z.string().optional().default(''),
  newContent: z.string().optional().default(''),
});

export const LineChangesUpdateWorkspaceStatsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  stats: z.record(z.any()).optional(),
});

export const LineChangesUpdateAgentStatsSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
  stats: z.record(z.any()).optional(),
});

export const LineChangesClearWorkspaceStatsSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const LineChangesClearAgentStatsSchema = z.object({
  agentId: z.string().min(1, 'Agent ID is required'),
});

// ============================================================================
// Memories Schemas
// ============================================================================

export const MemoriesListSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const MemoriesGetSchema = z.object({
  id: z.string().min(1, 'Memory ID is required'),
});

export const MemoriesCreateSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  content: z.string().min(1, 'Content is required'),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

export const MemoriesUpdateSchema = z.object({
  id: z.string().min(1, 'Memory ID is required'),
  updates: z.record(z.any()),
});

export const MemoriesDeleteSchema = z.object({
  id: z.string().min(1, 'Memory ID is required'),
});

export const MemoriesSearchSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

export const MemoriesGetContextSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
});

// ============================================================================
// Rules Schemas
// ============================================================================

export const RulesListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const RulesLoadWorkspaceSchema = z.object({
  workspacePath: z.string().min(1, 'Workspace path is required'),
});

export const RulesGetContextSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// ============================================================================
// User Rules Schemas
// ============================================================================

export const UserRulesGetAllSchema = z.object({});

export const UserRulesGetFormattedSchema = z.object({});

export const UserRulesUpdateSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

export const UserRulesSetEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const UserRulesExportSchema = z.object({});

export const UserRulesImportSchema = z.object({
  json: z.string().min(1, 'JSON is required'),
});

export const UserRulesGetCombinedPromptSchema = z.object({
  basePrompt: z.string().optional(),
});

// ============================================================================
// Workspace Info Schema
// ============================================================================

export const WorkspaceGetInfoSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// ============================================================================
// File Open Schema
// ============================================================================

export const FileOpenSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

// ============================================================================
// Specialists Schemas
// ============================================================================

export const SpecialistIdSchema = z.object({
  id: z.string().min(1, 'Specialist ID is required'),
  scope: z.enum(['user', 'project']).optional(),
  workspacePath: z.string().optional(),
});

export const SpecialistListSchema = z.object({
  workspacePath: z.string().optional(),
});

export const SpecialistWriteSchema = z
  .object({
    id: z.string().min(1, 'Specialist ID is required'),
    name: z.string().min(1, 'Specialist name is required'),
    description: z.string().min(1, 'Description is required'),
    codingAgent: z.string().optional(),
    model: z.string().optional(),
    modelTier: z.enum(['fast', 'balanced', 'smart']).optional(),
    roleReminder: z.string().optional(),
    behaviorPrompt: z.string().min(1, 'Behavior prompt is required'),
    scope: z.enum(['user', 'project']).optional(),
    workspacePath: z.string().optional(),
  })
  .refine((data) => data.scope !== 'project' || !!data.workspacePath, {
    message: 'workspacePath is required when scope is "project"',
    path: ['workspacePath'],
  });

export const SpecialistExportBuiltinSchema = z.object({
  id: z.string().min(1, 'Built-in specialist ID is required'),
});

// ============================================================================
// Auggie MCP Setup Schemas
// ============================================================================

export const AuggieMcpSetupClaudeCodeSchema = z.object({}).strict();

export const AuggieMcpSetupCodexSchema = z.object({}).strict();

export const AuggieMcpSetupOpenCodeSchema = z.object({}).strict();

// ============================================================================
// Auggie MCP Check Schemas
// ============================================================================

export const AuggieMcpCheckClaudeCodeSchema = z.object({}).strict();

export const AuggieMcpCheckCodexSchema = z.object({}).strict();

export const AuggieMcpCheckOpenCodeSchema = z.object({}).strict();

// ============================================================================
// Skills Schemas
// ============================================================================

export const SkillsListSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});
