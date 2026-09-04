/**
 * Zod Schemas for Runtime Validation
 *
 * Provides runtime type checking for all domain objects.
 * Prevents corrupted data from being saved to disk.
 */

import { z } from 'zod';
import {
  AgentStatus,
  MESSAGE_ROLES,
  WORKSPACE_STATUS_MESSAGE_MAX_LENGTH,
  WorkspaceStatus,
} from './types';
import { CHIEF_WORKSPACE_ID } from './types/branded-ids';
import {
  PLAN_ENTRIES_MAX,
  PLAN_ENTRY_PRIORITIES,
  PLAN_ENTRY_STATUSES,
} from './types/content-block';

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
 * - Fixed virtual workspace IDs
 */
export const workspaceIdSchema = z.string().refine(
  (id) => {
    if (id === CHIEF_WORKSPACE_ID) {
      return true;
    }

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

const DiffSummaryActionSchema = z.enum(diffSummaryActionValues);

const DiffSummaryFileSchema = z.object({
  path: z.string(),
  action: DiffSummaryActionSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

const DiffSummarySchema = z.object({
  schemaVersion: z.number().int(),
  updatedAt: z.string().datetime(),
  totalFiles: z.number().int().nonnegative(),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(DiffSummaryFileSchema).max(50),
});

export const WorkspaceStatusMessageSchema = z
  .string()
  .max(WORKSPACE_STATUS_MESSAGE_MAX_LENGTH, 'Workspace status message is too long');

// Issue/PR context link on `workspace.create` and the persisted `Workspace`
// payload (PROTOCOL §5.1 `contextLinks`): lowercase `kind`, non-empty
// url/owner/repo, positive integer `number`.
const ContextLinkSchema = z.object({
  kind: z.enum(['issue', 'pr']),
  url: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
});

export const WorkspaceSchema = z.object({
  id: workspaceIdSchema, // Accepts slug format, UUID, or optimistic IDs
  name: z.string().optional(), // Compatibility with agent system
  title: z.string().max(100),
  branch: z.string(),
  baseRef: z.string().optional(),
  baseCommitSha: z.string().optional(),
  initialPrompt: z.string().optional(), // Initial user message for commit/PR generation
  changesets: z.array(z.any()),
  timeline: z.array(z.any()),
  conversationInfo: z.array(z.any()),
  status: z.nativeEnum(WorkspaceStatus),
  statusMessage: WorkspaceStatusMessageSchema.optional(),
  statusImageAssetId: z.string().optional(), // Agent-authored status screenshot asset id (intent-hq/monorepo#997)
  activity: z.enum(['idle', 'agent_running']).optional(), // BE-derived in-flight agent state
  attention: z.enum(['none', 'unread', 'review_required']).optional(), // BE-owned dismissible attention flag (PROTOCOL §5.1 / §9.9)
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
  // Wire emits a SetupScript object { script, updatedAt, ... } (PROTOCOL §5.25);
  // the string arm covers legacy FE-local values until the Workspace type is fixed.
  setupScript: z.union([z.string(), z.object({ script: z.string() }).passthrough()]).optional(),
  isRemote: z.boolean().optional(),
  diffs: z.array(z.any()).optional(),
  diffSummary: DiffSummarySchema.optional(),
  // prUrl does NOT use .url() validation because empty strings can come from
  // normalizePullRequestInfo when no URL is found
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  prStatus: z.string().nullable().optional(),
  pullRequests: z.array(z.any()).optional(),
  activePullRequest: z.any().optional(),
  /** Issue/PR context links persisted at create (PROTOCOL §5.1); write-once, omitted when there are none. */
  contextLinks: z.array(ContextLinkSchema).max(20).optional(),
  environmentConfig: z.any().optional(),
  defaultModel: z.string().optional(),
  agentSummary: z.object({ agentIds: z.array(z.string()) }).optional(),
  taskStats: z.any().optional(), // Task progress rollup; carried on metadata payloads (PROTOCOL §5.1)
  gitSummary: z.any().optional(), // Deprecated aggregate; fetch on demand
  /** CoW filesystem capability of the workspaces root (PROTOCOL §5.1); gates the cowIsolation toggle. */
  cowSupported: z.boolean().optional(),
  /** How the checkout was provisioned (PROTOCOL §5.1); omitted for rows without a daemon-provisioned checkout (skip-isolation, remote, …). `direct` = standalone local clone (cache-hydrated picked repos, isNewRepo). */
  checkoutMode: z.enum(['cow', 'worktree', 'direct']).optional(),
  /** Cached physical disk usage of the workspace directory (PROTOCOL §5.1); omitted until first computation completes. */
  diskUsage: z
    .object({
      bytes: z.number().int().nonnegative(),
      fileCount: z.number().int().nonnegative(),
      computedAt: z.string().datetime({ offset: true }),
      breakdown: z.array(
        z.object({
          name: z.string(),
          bytes: z.number().int().nonnegative(),
          fileCount: z.number().int().nonnegative(),
        }),
      ),
    })
    .optional(),
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

// Environment configuration schema
const EnvironmentConfigSchema = z.object({
  type: z.enum(['local', 'remote']),
  ssh: SSHConfigSchema.optional(),
  workspace_path: z.string().optional(),
});

export const CreateWorkspaceRequestSchema = z.object({
  idempotencyKey: z.string().optional(),
  title: z.string().max(100).optional(),
  statusMessage: WorkspaceStatusMessageSchema.optional(),
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
  skipIsolation: z.boolean().optional(), // Canonical wire name; the daemon still accepts the deprecated skipWorktree alias
  progressId: z.string().optional(), // FE-minted correlation id echoed on git:clone:progress/done frames (PROTOCOL §5.1)
  contextLinks: z.array(ContextLinkSchema).max(20).optional(), // Issue/PR context links persisted on the workspace row (PROTOCOL §5.1)
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
 * Task status schema
 * Designed for user-to-agent workflow
 */
export const TaskStatusSchema = z.enum([
  'not_started',
  'waiting',
  'discussion_needed',
  'blocked',
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
  dependsOn: z.array(z.string()).optional(), // Hard ordering edges (task note ids)
  conflictsWith: z.array(z.string()).optional(), // Advisory conflict edges (task note ids)
  unmetDependsOn: z.array(z.string()).optional(), // Daemon-computed unmet deps (read/push shapes, v6.8)
});

/**
 * Validation helpers
 */
export function validateWorkspace(data: unknown) {
  return WorkspaceSchema.parse(data);
}

export function validateFirstVisitState(data: unknown) {
  return FirstVisitStateSchema.parse(data);
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
// Mirrors the `type` union in src/shared/types/content-block.ts. Persistence
// runs this schema before saveAgent writes to disk, so any block type the
// streaming pipeline produces must be listed here — otherwise saves fail and
// blocks like the proposal cards emitted by ws.app.workspaces.* are dropped.
const PlanEntrySchema = z.object({
  content: z.string(),
  priority: z.enum(PLAN_ENTRY_PRIORITIES),
  status: z.enum(PLAN_ENTRY_STATUSES),
});

export const ContentBlockSchema = z
  .object({
    type: z.enum([
      'text',
      'code',
      'tool_use',
      'tool_result',
      'thinking',
      'image',
      'audio',
      'file',
      'nav-link',
      'proposal',
      'plan',
    ]),
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
    // Navigation-link fields
    target: z.string().optional(), // Internal route/hash target for nav-link
    label: z.string().optional(), // User-facing label for nav-link
    // Proposal fields (chat-embedded ProposalCard blocks)
    kind: z.string().optional(), // 'nav-link' | ProposalKind
    proposal: z.any().optional(), // Structured Proposal payload
    payload: z.any().optional(), // Proposal payload when block IS a Proposal
    preview: z.any().optional(), // Proposal preview when block IS a Proposal
    applyToolCallId: z.string().optional(), // Tool call ID to invoke on apply
    // Complete bounded execution-plan snapshot
    entries: z.array(PlanEntrySchema).max(PLAN_ENTRIES_MAX).optional(),
  })
  .superRefine((block, context) => {
    if (block.type === 'plan' && block.entries === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries'],
        message: 'Plan content blocks require entries',
      });
    }
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
  role: z.enum(MESSAGE_ROLES),
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
  model: z.string().nullable().optional(),
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
  lastMessageRole: z.enum(['user', 'assistant']).optional(),
  isResponding: z.boolean().optional(),
  isWaitingOnTool: z.boolean().optional(),
  isWaitingForOtherAgents: z.boolean().optional(),
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
  // Pending attention request (requestDiscussion / reportBlocker); cleared by
  // the daemon only on a user-origin delivery (sendMessage,
  // sendQueuedMessageNow, editAndRegenerate, drained user-origin queue entry)
  // — automatic deliveries (A2A sends, parent/subscription wakes) leave it
  // pending
  attentionRequestKind: z.enum(['discussion', 'blocker']).optional(),
  attentionRequestReason: z.string().optional(),
  attentionRequestTimestamp: z.string().optional(),
  // Canonical stop/finish reason + ISO timestamp of the latest terminal
  // stop/failure (accompanies stopReason; used for "failed X ago" displays)
  stopReason: z.string().nullable().optional(),
  stopReasonTimestamp: z.string().nullable().optional(),
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
