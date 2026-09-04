/**
 * IPC Validation Schemas
 *
 * Comprehensive Zod schemas for all IPC handlers.
 * Ensures all IPC requests are validated before processing.
 */

import { z } from 'zod';
import { BROWSER_PROTOCOLS } from '../shared/constants';
import { FirstVisitStateSchema, WorkspaceStatusMessageSchema } from '../shared/schemas';
import { isValidWorkspaceId } from '../shared/types/branded-ids';
import {
  CONNECTION_ACCENTS,
  DETECTED_DEVICE_KINDS,
  DEVICE_KINDS,
} from '../shared/types/connections';
// IPC allow-list of workspace event-type strings.
//
// Mirrors the runtime values declared in `features/events/types.ts`
// (`WorkspaceEventType`). A snapshot test
// (`src/features/events/__tests__/types.test.ts`) keeps the two lists in sync
// so the IPC allow-list cannot silently drift behind the catalogue. Per Audit 2
// C6 — see the WebSocket API Drift Audit Findings note.
//
// IMPORTANT: Keep this list aligned with `WorkspaceEventType`. Add new event
// types here as well as in `features/events/types.ts`.
export const WORKSPACE_EVENT_TYPE_LITERALS = [
  // File events
  'file:changed',
  'file:created',
  'file:deleted',
  'file:renamed',
  // Agent lifecycle events
  'agent:started',
  'agent:completed',
  'agent:failed',
  'agent:tool:call',
  'agent:message',
  // Agent interaction events
  'agent:created',
  'agent:deleted',
  'agent:restored',
  'agent:retired',
  'agent:renamed',
  'agent:idle',
  'agent:status-changed',
  'agent:message:sent',
  'agent:message:received',
  'agent:subscribed',
  'agent:unsubscribed',
  'agent:woken-by-subscription',
  'agent:delivery-confirmed',
  'agent:event-delivery-failed',
  'agent:event-delivery-timeout',
  'agent:subscriptions-restored',
  'agent:subscriptions-changed',
  'agent:message:delivery-failed',
  // Agent streaming events
  'agent:stream:start',
  'agent:stream:activity',
  'agent:stream:end',
  // Agent queue events
  'agent:queue:updated',
  'agent:queue:processing',
  'agent:queue:processing-cancelled',
  'agent:queue:stale-message',
  // Agent process events
  'agent:process:queued',
  'agent:process:resumed',
  'agent:process:evicted',
  // Agent user message events
  'agent:user-message:sent',
  // Agent session stats (PROTOCOL §5.24)
  'agent:session-stats-changed',
  // Git events
  'git:commit',
  'git:push',
  'git:pull',
  'git:branch',
  'git:merge',
  // Note events
  'note:created',
  'note:updated',
  'note:deleted',
  // Task events
  'task:status-changed',
  'task:ready-tasks-changed',
  // Terminal events
  'terminal:command',
  // Script events
  'script:state',
  'script:output',
  // Test events
  'test:started',
  'test:completed',
  // Build events
  'build:started',
  'build:completed',
  // Workspace events
  'workspace:created',
  'workspace:updated',
  'workspace:deleted',
  'workspace:opened',
  'workspace:closed',
  'workspace:activity',
  'workspace:displayStatus-changed',
  // Spec/goal events
  'spec:updated',
  'goal:updated',
  // Comment events
  'comment:added',
  // MCP events
  'mcp:notification',
] as const;

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  statusMessage: WorkspaceStatusMessageSchema.optional(),
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
  skipIsolation: z.boolean().optional(), // If true, skip the isolated checkout (worktree or CoW clone) and use repositoryPath directly
  initialAgent: z
    .object({
      // DEPRECATED: the daemon assigns the initial agent's id; clients must
      // not send one. Kept optional for legacy callers only.
      agentId: z.string().optional(),
      name: z.string().optional(),
      model: z.string().optional(),
      provider: z.string().optional(), // Provider ID (e.g., 'auggie', 'claude-code', 'codex')
      prompt: z.string().optional(),
      agentType: z.string().optional(),
      specialist: z.string().optional(), // Specialist or team coordinator ID (flexible to support any specialist)
      behaviorPrompt: z.string().optional(), // Custom behavior instructions (from team coordinator or specialist)
      contextReferences: z.array(z.any()).optional(),
      // Inline arm (data + mimeType) or attachment-registry reference arm
      // (attachmentId, monorepo#3338) — exactly one of data / attachmentId
      // per block, enforced daemon-side.
      imageBlocks: z
        .array(
          z.object({
            type: z.literal('image'),
            data: z.string().optional(),
            mimeType: z.string().optional(),
            attachmentId: z.string().optional(),
          }),
        )
        .optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
});

export const WorkspaceUpdateSchema = z.object({
  id: WorkspaceIdSchema,
  title: z.string().optional(),
  statusMessage: WorkspaceStatusMessageSchema.optional(),
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

export const WorkspaceGetRecentSchema = z.object({});

export const WorkspaceClearRecentSchema = z.object({});

export const WorkspaceGetStatsSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceGetHoverStatusSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

// On-demand summary endpoints (data intentionally excluded from workspace metadata payloads)
export const WorkspaceGetDiffSummarySchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceGetGitSummarySchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceGetTasksSchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

export const WorkspaceValidateSchema = z.object({
  id: WorkspaceIdSchema,
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
  githubUrl: z.string().optional(),
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

/**
 * Sequential chunked read for large-file uploads (remote attachment
 * placement): one bounded slice per call, base64-encoded. The length cap
 * matches the daemon's 16 MiB `file.attachmentUpload.chunk` decoded cap.
 */
export const FileReadChunkSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  offset: z.number().int().nonnegative(),
  length: z
    .number()
    .int()
    .positive()
    .max(16 * 1024 * 1024),
});

/** Streaming SHA-256 of a host-local file (never buffers the whole file). */
export const FileHashSchema = z.object({
  path: z.string().min(1, 'Path is required'),
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

export const FileDownloadSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

// Attachment-chip download (monorepo#2458): save a workspace-relative
// attachment to a user-chosen location. `path` is daemon-side
// workspace-relative (`.intent/attachments/…`), never a host path.
export const FileDownloadAttachmentSchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  path: z.string().min(1, 'Path is required'),
  fileName: z.string().min(1, 'File name is required'),
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
// Config Schemas
// ============================================================================

export const ConfigGetSchema = z.object({
  key: z.string().optional(),
});

export const ConfigSetSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.any(),
});

// ============================================================================
// Config Schemas (Additional)
// ============================================================================

export const ConfigGetAllSchema = z.object({});

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

export const EventsEmitSchema = z.object({
  event: z.object({
    id: z.string().min(1, 'Event ID is required'),
    // Allow any declared `WorkspaceEventType`; derived from the canonical
    // constants in `features/events/types.ts` so the IPC allow-list stays in
    // lock-step with the catalogue (Audit 2 C6).
    type: z.enum(WORKSPACE_EVENT_TYPE_LITERALS),
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

export const EventsGetLastEventSchema = z.object({
  // Mirrors `EventsEmitSchema.event.type`: drift-resistant union pulled from
  // `WorkspaceEventType`. Reserved-but-unused types (e.g. `file:created`) are
  // still accepted as query inputs and simply return `null` if no such event
  // has ever been recorded.
  type: z.enum(WORKSPACE_EVENT_TYPE_LITERALS),
  workspaceId: WorkspaceIdSchema.optional(),
});

export const EventsGetStatisticsSchema = z.object({});

export const SystemWriteClipboardSchema = z.object({
  text: z.string(),
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
// System Schemas
// ============================================================================

// APP_CHANNELS schemas
export const AppSetBadgeSchema = z.object({
  count: z.number().int().min(0, 'Badge count must be non-negative'),
});

export const AppSetLanguagePreferenceSchema = z.object({
  preference: z.string().min(1),
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
  requestId: z.string().min(1).max(256).optional(),
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

export const WindowSetFullScreenSchema = z.object({
  fullScreen: z.boolean(),
});

export const WindowSetBrowserFocusedSchema = z.object({
  browserFocused: z.boolean(),
  focusOwnerId: z.string().min(1, 'Focus owner ID is required'),
});

// DIALOG_CHANNELS schemas
export const DialogMessageSchema = z.object({
  message: z.string(),
  title: z.string().optional(),
  type: z.enum(['info', 'warning', 'error', 'question']).optional(),
  buttons: z.array(z.string()).optional(),
});

export const DialogOpenSchema = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  mode: z.enum(['directory', 'file']).optional(),
});

// SHELL_CHANNELS schemas
export const ShellOpenExternalSchema = z.object({
  url: z.string().refine(
    (val) => {
      // Allow http, https, mailto, tel, file — plus the exact hardcoded OS
      // deep links in BROWSER_PROTOCOLS.EXTERNAL_EXACT (e.g. the macOS Input
      // Monitoring System Settings pane). Full-string match only: the
      // x-apple.systempreferences: scheme is never allowlisted wholesale.
      return (
        /^(https?|mailto|tel|file):/.test(val) || BROWSER_PROTOCOLS.EXTERNAL_EXACT.includes(val)
      );
    },
    {
      message:
        'Invalid URL format - must start with http, https, mailto, tel, or file, or be an allowlisted OS settings deep link',
    },
  ),
});

export const ShellShowItemInFolderSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

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

// USER_MCP_CHANNELS schemas
export const UserMcpCheckAuthSchema = z.object({
  url: z.string().min(1, 'URL is required'),
  name: z.string().optional(), // Server name for OAuth token lookup
});

export const UserMcpTestConnectionSchema = z.object({
  url: z.string().min(1, 'URL is required'),
  headers: z.record(z.string()).optional(),
  name: z.string().optional(), // Server name for OAuth token lookup
});

// SYSTEM_CHANNELS schemas
// `cwd` requires `workspaceId` so the daemon's within-workspace containment
// guard (PROTOCOL §5.14) always runs — mirrors `host.exec`'s own -32602 parse
// guard (monorepo#578). An empty-string cwd is deliberately treated as absent:
// both bridges drop blank cwd before the wire (`hostExec` omits it, the web
// bridge's `if (cwd)` does the same), so only a non-empty cwd arms the guard.
// The same cwd⇒workspaceId refinement applies to the streaming variant below
// (`host.execStream` enforces the identical containment contract, monorepo#588).
export const SystemExecuteCommandSchema = z
  .object({
    command: z.string().min(1, 'Command is required'),
    cwd: z.string().optional(),
    workspaceId: WorkspaceIdSchema.optional(),
  })
  .refine((params) => !params.cwd || Boolean(params.workspaceId), {
    message: 'cwd requires workspaceId (PROTOCOL §5.14 containment guard)',
    path: ['workspaceId'],
  });

export const SystemExecuteCommandStreamingSchema = z
  .object({
    sessionId: z.string().min(1, 'Session ID is required'),
    command: z.string().min(1, 'Command is required'),
    cwd: z.string().optional(),
    workspaceId: WorkspaceIdSchema.optional(),
    stdin: z.string().optional(),
  })
  .refine((params) => !params.cwd || Boolean(params.workspaceId), {
    message: 'cwd requires workspaceId (PROTOCOL §5.14 containment guard)',
    path: ['workspaceId'],
  });

// DEEP_LINK_CHANNELS schemas
export const DeepLinkHandleSchema = z.object({
  url: z.string().min(1, 'URL is required'),
});

// Empty schemas for handlers with no parameters
// Accepts undefined, null, void, or an empty object (frontend often sends {})
export const EmptySchema = z.undefined().or(z.null()).or(z.void()).or(z.object({}).strict());

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

// ============================================================================
// First Visit State Schemas
// Using strict workspace ID validation and shared FirstVisitStateSchema
// ============================================================================

export const FirstVisitStateLoadSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  // Active backend id — keys the on-disk state dir under userData so two
  // backends sharing a workspace id keep separate first-visit state
  // (intent-hq/monorepo#1760). Absent → the local sidecar.
  backendId: z.string().optional(),
});

export const FirstVisitStateSaveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  backendId: z.string().optional(),
  state: FirstVisitStateSchema,
});

export const FirstVisitStateDeleteSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  backendId: z.string().optional(),
});

export const FirstVisitStateExistsSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  backendId: z.string().optional(),
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
  // Active backend id (multi-backend connect, cloudlands-fe#823) — namespaces
  // the on-disk history file so two backends sharing a workspace id keep
  // separate undo/redo snapshots. Absent/local → the legacy un-namespaced file.
  backendId: z.string().optional(),
});

export const PanelLayoutSaveSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  backendId: z.string().optional(),
  data: z.object({
    version: z.number(),
    workspaceId: z.string(),
    history: z.array(LayoutSnapshotSchema),
    historyIndex: z.number(),
    lastUpdated: z.string(),
  }),
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
    roleReminder: z.string().optional(),
    hidden: z.boolean().optional(),
    modelOptions: z
      .array(
        z.object({
          provider: z
            .string()
            .refine((value) => value.trim() !== '', 'Provider must be non-empty when present')
            .optional(),
          model: z.string().min(1, 'Model is required'),
          hint: z.string(),
          reasoningEffort: z.string().optional(),
        }),
      )
      .optional(),
    reasoningEffort: z.string().optional(),
    role: z.enum(['orchestrator', 'internal']).optional(),
    teamAgents: z.array(z.string().min(1, 'Team agent id must be non-empty')).optional(),
    icon: z.string().optional(),
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
// Voice (local OS transcription) Schemas
// ============================================================================

export const VoiceLocalAvailableSchema = EmptySchema;

export const VoiceRequestLocalAuthorizationSchema = EmptySchema;

/** ~25 MB of base64 ≈ 60s+ of 16 kHz mono WAV — generous dictation ceiling. */
export const VoiceTranscribeLocalSchema = z.object({
  /** Base64-encoded audio bytes (no data: URL prefix). */
  audioBase64: z.string().min(1, 'Audio data is required').max(25_000_000, 'Audio too large'),
  /** Container MIME type of the recorded audio (e.g. audio/wav). */
  mimeType: z.string().min(1, 'MIME type is required'),
  /** Domain keyterms forwarded as SFSpeechRecognizer contextual strings. */
  contextualStrings: z.array(z.string().max(100)).max(100).optional(),
  /** BCP-47 locale for the recognizer (e.g. "de"); absent = system locale. */
  locale: z.string().min(1).max(35).optional(),
});

// ============================================================================
// Connections Schemas (multi-backend connect)
//
// Request-payload validation for the `connections:*` channels. Shapes only —
// the handlers land in T3. The renderer-facing contract types live in
// `shared/types/connections.ts`; these schemas mirror the `*Params` shapes
// there. Note: `capture-fingerprint` and `add` carry the bearer token
// renderer→main (the user just typed it); it is consumed by main and never
// echoed back on any connection shape.
// ============================================================================

export const ConnectionsListSchema = EmptySchema;

export const ConnectionsCaptureFingerprintSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().positive('Port must be a positive integer'),
  token: z.string().min(1, 'Token is required'),
});

export const ConnectionsAddSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  accent: z.enum(CONNECTION_ACCENTS).nullable().optional(),
  detectedDeviceKind: z.enum(DETECTED_DEVICE_KINDS).nullable().optional(),
  deviceIcon: z.union([z.literal('auto'), z.enum(DEVICE_KINDS)]).optional(),
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().positive('Port must be a positive integer'),
  fingerprint: z.string().min(1, 'Fingerprint is required'),
  token: z.string().min(1, 'Token is required'),
  /** tc address from the pairing URI's `tc=` (PROTOCOL §12.3); absent = none. */
  tcAddress: z.string().trim().min(1).optional(),
  /** "Detect all backend IPs" option (#1746); absent = enabled. */
  detectHosts: z.boolean().optional(),
  /** Per-backend keychain-sync opt-out (spec Phase 2); absent = synced. */
  syncExcluded: z.boolean().optional(),
});

export const ConnectionsUpdateSchema = z
  .object({
    id: z.string().min(1, 'Connection ID is required'),
    label: z.string().trim().min(1, 'Label is required'),
    accent: z.enum(CONNECTION_ACCENTS).nullable(),
    detectedDeviceKind: z.enum(DETECTED_DEVICE_KINDS).nullable().optional(),
    deviceIcon: z.union([z.literal('auto'), z.enum(DEVICE_KINDS)]).optional(),
    host: z.string().trim().min(1, 'Host is required').optional(),
    port: z.number().int().min(1).max(65_535).optional(),
    confirmedFingerprint: z.string().trim().min(1).optional(),
    detectHosts: z.boolean().optional(),
    syncExcluded: z.boolean().optional(),
  })
  .refine((value) => (value.host === undefined) === (value.port === undefined), {
    message: 'Host and port must be supplied together',
  });

export const ConnectionsTestSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
  host: z.string().trim().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65_535),
  token: z.string().min(1, 'Token is required').optional(),
});

export const ConnectionsRotateSecretSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
  token: z.string().min(1, 'Token is required'),
  confirmedFingerprint: z.string().trim().min(1).optional(),
});

export const ConnectionsForgetSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
});

export const ConnectionsOpenSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
});

export const ConnectionsUpdateBackendSchema = z.object({
  id: z.string().min(1, 'Connection ID is required'),
});

export const ConnectionsSyncGetStateSchema = EmptySchema;

export const ConnectionsSyncSetEnabledSchema = z.object({
  enabled: z.boolean(),
});

// Self-publish: no renderer-supplied params on either channel — main gathers
// everything (token, fingerprint, IPs, port) from `server.pairingInfo` over
// the local client, so the bearer token never crosses the IPC boundary.
export const ConnectionsPublishSelfSchema = EmptySchema;

export const ConnectionsSelfPublishedStateSchema = EmptySchema;

export const ConnectionsRefreshSelfSchema = EmptySchema;

export const ConnectionsUnpublishSelfSchema = EmptySchema;

// ============================================================================
// Quit Confirmation Schemas
//
// Renderer → main payloads for the renderer-rendered quit prompt. The payload
// contract (all four channels) is documented in
// `src/shared/ipc/quit-confirmation.ts`.
// ============================================================================

export const QuitConfirmationAckSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
});

export const QuitConfirmationResponseSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  proceed: z.boolean(),
});
