/**
 * Unified Type Definitions
 *
 * Single source of truth for all types in the application.
 * No more duplicates, no more confusion.
 */

// Import agent types from agent.types.ts to avoid conflicts
import { AgentStatus } from './types/agent.types';
export { AgentStatus };

// Import branded ID types for type safety
import type {
  AgentId,
  AgentId as BrandedAgentId,
  MessageId as BrandedMessageId,
  SessionId as BrandedSessionId,
  StreamId as BrandedStreamId,
  ThreadId as BrandedThreadId,
  ToolCallId as BrandedToolCallId,
  UserId as BrandedUserId,
  WorkspaceId as BrandedWorkspaceId,
  NoteId,
  WorkspaceId,
} from './types/branded-ids';
import {
  createAgentId,
  createMessageId,
  createNoteId,
  createSessionId,
  createStreamId,
  createThreadId,
  createToolCallId,
  createUserId,
  createWorkspaceId,
} from './types/branded-ids';

// Import consolidated AgentSession type
import type {
  AgentSession as NewAgentSession,
  PendingAgentSession as NewPendingAgentSession,
  QueuedMessage as NewQueuedMessage,
  QueuedMessageContextItem as NewQueuedMessageContextItem,
  SessionStats as NewSessionStats,
} from './types/agent-session';
import { isPendingAgentSession as isNewPendingAgentSession } from './types/agent-session';
import { isAgentSession as isNewAgentSession } from './types/agent-session.guards';

// Import consolidated ContentBlock type
import type { ContentBlock } from './types/content-block';
import type {
  BulkProposalItem,
  Proposal,
  ProposalActionDetail,
  ProposalDiffPreview,
  ProposalEditableField,
  ProposalKind,
  ProposalPreview,
} from './types/proposal';
import { isProposal, isProposalKind, PROPOSAL_KINDS } from './types/proposal';
import {
  isContentBlock,
  normalizeContentBlock,
  normalizeContentBlocks,
} from './types/content-block';
import {
  getTextContent,
  hasTextContent,
  isAudioBlock,
  isCodeBlock,
  isErrorBlock,
  isFileBlock,
  isImageBlock,
  isMediaBlock,
  isTextBlock,
  isThinkingBlock,
  isToolBlock,
  isToolResultBlock,
  isToolUseBlock,
} from './types/content-block.guards';
import {
  convertFromACP,
  convertToACP,
  migrateContentBlocks,
  migrateFromLegacy,
} from './types/content-block.migration';

// Import consolidated AgentMessage type
import type {
  AgentMessage,
  MessageMetadata,
  MessageRole,
  ProviderMessage,
  ToolCall,
  ToolResult,
} from './types/agent-message';
import {
  extractAllContent,
  extractContentFromBlocks,
  fromProviderMessage,
  mergeMessages,
  normalizeAgentMessage,
  toProviderMessage,
} from './types/agent-message.conversion';

// Re-export branded ID types
export type {
  BrandedAgentId,
  BrandedMessageId,
  BrandedSessionId,
  BrandedStreamId,
  BrandedThreadId,
  BrandedToolCallId,
  BrandedUserId,
  BrandedWorkspaceId,
};

// Export branded ID creation functions
export {
  createAgentId,
  createMessageId,
  createNoteId,
  createSessionId,
  createStreamId,
  createThreadId,
  createToolCallId,
  createUserId,
  createWorkspaceId,
};

// Re-export ContentBlock and utilities
export {
  convertFromACP,
  convertToACP,
  getTextContent,
  hasTextContent,
  isAudioBlock,
  isCodeBlock,
  isContentBlock,
  isErrorBlock,
  isFileBlock,
  isImageBlock,
  isMediaBlock,
  isTextBlock,
  isThinkingBlock,
  isToolBlock,
  isToolResultBlock,
  isToolUseBlock,
  migrateContentBlocks,
  migrateFromLegacy,
  normalizeContentBlock,
  normalizeContentBlocks,
};
export type { ContentBlock };
export { isProposal, isProposalKind, PROPOSAL_KINDS };
export type {
  BulkProposalItem,
  Proposal,
  ProposalActionDetail,
  ProposalDiffPreview,
  ProposalEditableField,
  ProposalKind,
  ProposalPreview,
};

// Re-export AgentMessage and utilities
export {
  extractAllContent,
  extractContentFromBlocks,
  fromProviderMessage,
  mergeMessages,
  normalizeAgentMessage,
  toProviderMessage,
};
export type { AgentMessage, MessageMetadata, MessageRole, ProviderMessage, ToolCall, ToolResult };

// Re-export SuggestedPrompt types and helpers
export type { SuggestedPrompt, SuggestedPromptsEvent } from './types/suggested-prompt';
export { getPromptText } from './types/suggested-prompt';

// ============================================================================
// Core ID Types
// ============================================================================

// Use branded ID types from branded-ids module
// These are re-exported above as BrandedWorkspaceId, BrandedAgentId, etc.
// For backward compatibility, also import the non-branded versions
// Export both the types and the constructor functions from branded-ids
export {
  type AgentId,
  type NoteId,
  type SessionId,
  type ThreadId,
  type UserId,
  type WorkspaceId,
} from './types/branded-ids';

export type AgentName = string;

// ============================================================================
// Navigation Types
// ============================================================================

export interface NavigationItem {
  type: 'file' | 'note' | 'diff';
  id: string;
  title: string;
  timestamp: number;
}

// ============================================================================
// Workspace Types
// ============================================================================

export const WORKSPACE_STATUS_MESSAGE_MAX_LENGTH = 500;

/** Canonical wire values for the BE-owned current-cycle `workspace.displayStatus`
 *  (intent-hq/intentd#600). Single source of truth — the union type, the runtime
 *  guard, and every consumer set derive from this array. */
export const WORKSPACE_DISPLAY_STATUS_VALUES = [
  'not_started',
  'in_progress',
  'complete',
  'pr_ready',
  'pr_open',
  'pr_merged',
] as const;

export type WorkspaceDisplayStatus = (typeof WORKSPACE_DISPLAY_STATUS_VALUES)[number];

/** Runtime guard for BE-sent displayStatus values. Unknown wire values (a future
 *  daemon's 7th value, or a malformed one) must be treated as absent so the FE
 *  degrades to its local derivation instead of rendering an unknown group. */
export function isWorkspaceDisplayStatus(value: unknown): value is WorkspaceDisplayStatus {
  return (
    typeof value === 'string' && (WORKSPACE_DISPLAY_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export interface Workspace {
  id: WorkspaceId;
  name?: string; // Added for compatibility with agent system
  title: string;
  /** The workspace's own working branch (e.g., "fix-login-bug").
   *  This is the branch that PRs should be matched against (PR.sourceBranch === workspace.branch).
   *  NOT the same as baseRef. */
  branch: string;
  /** The parent branch this workspace was created FROM (e.g., "main", "develop").
   *  Used for: commit boundary calculation (ahead/behind), diff base, worktree creation.
   *  NOT used for PR matching — a PR whose sourceBranch matches baseRef belongs to the
   *  parent workspace, not this one. */
  baseRef?: string;
  baseCommitSha?: string; // The exact commit SHA when workspace was created
  initialPrompt?: string; // The initial user message that created this workspace
  changesets: ChangeSet[];
  timeline: TimelineEntry[];
  conversationInfo: ConversationInfo[];
  status: WorkspaceStatus;
  /** User-facing high-level work status message. Distinct from lifecycle status. */
  statusMessage?: string;
  /** Agent-authored status screenshot reference (intent-hq/monorepo#997). A
   *  content-addressed asset id rendered via `workspace-asset://{id}/{assetId}`;
   *  omitted on the wire until an agent sets one. */
  statusImageAssetId?: string;
  /** BE-derived in-flight agent state (green dot). Read-only; computed from agent runtime. */
  activity?: 'idle' | 'agent_running';
  /** BE-owned current-cycle display status (intent-hq/intentd#600). Precedence is
   *  daemon-side: open/draft PR → open tasks → merged PR → complete. Optional on
   *  decode — absent on older daemons, where the FE falls back to its local derivation. */
  displayStatus?: WorkspaceDisplayStatus;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
  tags?: string[];
  path?: string;
  repositoryPath?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  worktreePath?: string;
  scope?: string; // Optional relative path within worktreePath (e.g., "apps/web")
  skipWorktree?: boolean; // If true, workspace was created without a git worktree
  /** Shell script that was run during workspace creation */
  setupScript?: string;
  isRemote?: boolean; // Added for remote workspace support
  diffs?: DiffChunk[];
  /** @deprecated High-frequency data — fetch on demand via WORKSPACE_CHANNELS.GET_DIFF_SUMMARY. Excluded from WorkspaceMetadata payloads. */
  diffSummary?: WorkspaceDiffSummary;
  prUrl?: string;
  prNumber?: number;
  prStatus?: PullRequestStatus;
  pullRequests?: PullRequestInfo[];
  activePullRequest?: PullRequestInfo | null;
  environmentConfig?: EnvironmentConfig;
  archived?: boolean;
  archivedAt?: string;
  defaultModel?: string; // Default model for new agents in this workspace
  /** IDs-only agent membership summary; derive counts from `agentIds.length` and fetch agent details from agent/session sources. */
  agentSummary?: WorkspaceAgentIdSummary;
  /** @deprecated High-frequency data — fetch on demand via WORKSPACE_CHANNELS.GET_TASKS. Excluded from WorkspaceMetadata payloads. */
  taskStats?: WorkspaceTaskStats; // Task progress for list views (like flame graph)
  /** @deprecated High-frequency data — fetch on demand via WORKSPACE_CHANNELS.GET_GIT_SUMMARY. Excluded from WorkspaceMetadata payloads. */
  gitSummary?: WorkspaceGitSummary; // Git status for list views (commits ahead/behind)
  /** Copy-on-Write filesystem capability of the workspaces root (a machine capability, independent of the workspace or checkout mode). */
  cowSupported?: boolean;
  /** How the daemon provisioned this workspace's checkout (PROTOCOL §5.1). Immutable; omitted for rows without a daemon-provisioned checkout (skip-isolation/direct, remote, …). */
  checkoutMode?: 'cow' | 'worktree';
}

/**
 * Slim agent summary embedded in workspace metadata payloads.
 * Contains only agent IDs; derive counts from `agentIds.length` and fetch
 * detailed agent data from agent/session sources when needed.
 */
export interface WorkspaceAgentIdSummary {
  agentIds: string[];
}

/**
 * Metadata-only workspace payload for list/get/open responses.
 * High-frequency summary fields are structurally excluded (`never`) so a
 * metadata payload cannot carry diff/git summaries or task lists/stats;
 * fetch those on demand via the dedicated WORKSPACE_CHANNELS endpoints.
 */
export type WorkspaceMetadata = Omit<
  Workspace,
  'diffSummary' | 'gitSummary' | 'taskStats' | 'agentSummary' | 'diffs'
> & {
  agentSummary?: WorkspaceAgentIdSummary;
  diffs?: never;
  diffSummary?: never;
  gitSummary?: never;
  taskStats?: never;
};

export interface EnvironmentConfig {
  type: 'local' | 'remote';
  ssh?: SSHConfig;
  workspace_path?: string;
}

export interface SSHConfig {
  host: string;
  port?: number; // Defaults to 22 if not specified
  user: string;
  password?: string;
  key_path?: string;
  use_agent?: boolean;
  transport?: 'ssh' | 'websocket';
  ws_url?: string;
}

// Removed WorkspaceIntent and PlanNode per user preference - workspaces should not contain intent/plan fields

export enum PlanStatus {
  Pending = 'Pending',
  InProgress = 'InProgress',
  Completed = 'Completed',
  Failed = 'Failed',
  Skipped = 'Skipped',
}

// Alias for backward compatibility
export const PlanNodeStatus = PlanStatus;

export enum WorkspaceStatus {
  Active = 'Active',
  Inactive = 'Inactive',
  Archived = 'Archived',
  Deleted = 'Deleted',
}

// Alias for backward compatibility
export const WorkspaceStatusEnum = WorkspaceStatus;

/**
 * First Visit State
 *
 * Tracks the progress of the first visit flow for a workspace.
 * Used to persist which UI panels have been revealed during incremental restoration.
 */
export interface FirstVisitState {
  version: number;
  workspaceId: WorkspaceId;
  // Renamed from hasVisited for clearer semantics:
  // true = first visit setup is complete (agent created, panels hidden once)
  // false = first visit setup still needed
  // After setup is ready, we ALWAYS restore panel visibility from the other state fields
  firstVisitSetupReady: boolean;
  mainContentRevealed: boolean;
  navigationRailRevealed: boolean;
  workspaceDockRevealed: boolean;
  lastUpdated: string;
}

// FileChange is now defined in shared/types/change-detector.types.ts
// Re-export for convenience
import type {
  FileChange,
  FileChangeAction,
} from './types/change-detector.types';
export type { FileChange, FileChangeAction };

export interface ChangeSet {
  id: string;
  description: string;
  files: FileChange[];
  author: Actor;
  createdAt: string;
  validationInfo?: ValidationInfo;
}

export interface TimelineEntry {
  id: string;
  type: TimelineEventType;
  eventType?: TimelineEventType; // Legacy compatibility alias
  actor: Actor;
  timestamp: string;
  description: string;
  metadata?: Record<string, any>;
}

export enum TimelineEventType {
  WorkspaceCreated = 'WorkspaceCreated',
  PlanUpdated = 'PlanUpdated',
  ChangesetAdded = 'ChangesetAdded',
  ValidationRun = 'ValidationRun',
  ConversationStarted = 'ConversationStarted',
  ConversationEnded = 'ConversationEnded',
  PullRequestCreated = 'PullRequestCreated',
  PullRequestMerged = 'PullRequestMerged',
  FileModified = 'FileModified',
  FileCreated = 'FileCreated',
  FileDeleted = 'FileDeleted',
  AgentStarted = 'AgentStarted',
  AgentCompleted = 'AgentCompleted',
  DiffCreated = 'DiffCreated',
  NoteCreated = 'NoteCreated',
}

export interface ConversationInfo {
  agentId: string;
  threadId: string;
  model: string;
  startedAt: string;
  endedAt?: string;
}

export interface PullRequestInfo {
  id: string;
  number: number;
  url: string;
  title: string;
  description?: string; // Legacy compatibility
  status: PullRequestStatus;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  checks?: any; // Legacy compatibility
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeConflicts?: boolean;
  comments?: number;
  isDraft?: boolean;
  baseRef?: string;
  headRef?: string;
  author?: string;
  assignees?: string[];
  reviewers?: string[];
  labels?: string[];
  mergeable?: boolean;
  closedAt?: string;
  /** GitHub mergeability state: 'clean', 'dirty', 'blocked', 'behind', 'unstable', 'unknown' */
  mergeableState?: string;
  /** Number of review comments on the PR */
  reviewComments?: number;
  /** CI status summary */
  ciStatus?: { total: number; passed: number; failed: number; pending: number };
  /** Review decision: 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', or null (no actionable reviews) */
  reviewDecision?: string | null;
  /** SHA of the head commit (for fetching CI status) */
  headSha?: string;
  /** List of usernames who approved the PR */
  approvedBy?: string[];
  /** Number of approvals */
  approvalCount?: number;
}

export enum PullRequestStatus {
  Open = 'Open',
  Closed = 'Closed',
  Merged = 'Merged',
  Draft = 'Draft',
}

export interface DiffChunk {
  file: string;
  files?: string[]; // Legacy compatibility
  chunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
  }>;
  /** Original file content (before changes) - used for new/untracked files */
  oldContent?: string;
  /** New file content (after changes) - used for new/untracked files */
  newContent?: string;
  /** Whether this is a binary file (not diffable) */
  isBinary?: boolean;
  /** Whether this file was too large to diff */
  isTooLarge?: boolean;
}

export const CURRENT_DIFF_SUMMARY_VERSION = 1 as const;

export type DiffSummaryFileAction = 'create' | 'modify' | 'delete' | 'rename';

export interface WorkspaceDiffSummaryFile {
  path: string;
  action: DiffSummaryFileAction;
  additions: number;
  deletions: number;
}

export interface WorkspaceDiffSummary {
  schemaVersion: number;
  updatedAt: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: WorkspaceDiffSummaryFile[];
}

/**
 * Lightweight agent info for workspace list view
 * Only includes data needed for avatars and status indicators
 */
export interface WorkspaceAgentInfo {
  id: string;
  name: string;
  status: string; // AgentStatus as string for serialization
  specialist?: 'spec-writer' | 'implementor' | 'verifier' | null;
  lastActivity?: string;
  isStreaming?: boolean;
  isResponding?: boolean;
}

/**
 * Individual task info for workspace list view tooltips
 */
export interface WorkspaceTaskInfo {
  title: string;
  status: TaskStatus;
}

/**
 * Task progress statistics for workspace list view
 * Shows completion progress like the flame graph
 */
export interface WorkspaceTaskStats {
  total: number;
  completed: number;
  inProgress: number;
  /** Individual task details for tooltip display (ordered: in_progress, not_started, complete) */
  tasks?: WorkspaceTaskInfo[];
}

/**
 * Individual commit info for display
 */
export interface WorkspaceCommitInfo {
  sha: string; // Short SHA
  title: string; // First line of commit message
}

/**
 * Git summary for workspace list view
 * Shows commit and branch info without loading full history
 */
export interface WorkspaceGitSummary {
  ahead: number; // Number of commits ahead of base
  behind: number; // Number of commits behind base
  hasUnpushed: boolean; // Has local commits not pushed
  commits?: WorkspaceCommitInfo[]; // Recent commits (up to 6) for tooltips
}

/**
 * Canonical task facts for a workspace, returned by the on-demand
 * WORKSPACE_CHANNELS.GET_TASKS endpoint. Renderer selectors derive counts,
 * progress, and in-progress/completed groupings from this list.
 */
export interface WorkspaceTask {
  /** Task note ID */
  id: string;
  title: string;
  status: TaskStatus;
  updatedAt?: string;
  /**
   * Optimistic-concurrency revision (§11.4-D). Populated by the live read
   * normalization when the daemon returns it; `undefined` when absent — callers
   * then omit `expectedVersion` and last-writer-wins applies.
   */
  rev?: number;
}

/**
 * Payload for the 'workspace:tasks-changed' renderer event, emitted when a
 * workspace's task set or task statuses may have changed.
 */
export interface WorkspaceTasksChangedEvent {
  workspaceId: WorkspaceId;
}

export interface CodeChange {
  id: string;
  fileName: string;
  filePath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  additions: number;
  deletions: number;
  diff?: string;
  oldContent?: string;
  newContent?: string;
  staged?: boolean;
}

export interface CodeChangeEvent {
  filePath: string;
  action: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  diff?: string;
  oldContent?: string;
  newContent?: string;
  toolName: string;
  toolCallId: string;
}

export interface DiffLine {
  type: LineType;
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

export enum LineType {
  Context = 'Context',
  Addition = 'Addition',
  Deletion = 'Deletion',
}

export interface ValidationInfo {
  tests: TestResult[];
  checks: CheckResult[];
}

export interface TestResult {
  name: string;
  status: TestStatus;
  output?: string;
}

export enum TestStatus {
  Pending = 'Pending',
  Running = 'Running',
  Passed = 'Passed',
  Failed = 'Failed',
  Skipped = 'Skipped',
}

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message?: string;
}

export enum CheckStatus {
  Pending = 'Pending',
  InProgress = 'InProgress',
  Success = 'Success',
  Failure = 'Failure',
  Neutral = 'Neutral',
  Cancelled = 'Cancelled',
  TimedOut = 'TimedOut',
  ActionRequired = 'ActionRequired',
}

// ============================================================================
// Actor Types
// ============================================================================

/**
 * Actor type representing who made a change.
 * For agent actors, sessionId and turnNumber enable linking changes back to specific agent turns.
 */
export type Actor =
  | { type: 'user'; id?: string; name: string; email: string }
  | {
      type: 'agent';
      id: string;
      name: string;
      /** Session ID for linking to agent conversation */
      sessionId?: string;
      /** Turn number within the session */
      turnNumber?: number;
      /** Message ID for linking to specific message */
      messageId?: string;
    };

// ============================================================================
// Note Types
// ============================================================================

// Legacy types for backward compatibility
export interface NoteSearchParams {
  query?: string;
  tags?: string[];
  workspaceId?: WorkspaceId;
  limit?: number;
  offset?: number;
}

export interface Note {
  id: NoteId;
  workspaceId: WorkspaceId;
  title: string;
  content: string;
  contentType: ContentType;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  isDefault?: boolean; // For workspace spec
  parentId?: NoteId;
  visibility: NoteVisibility;
  metadata?: NoteMetadata;
  references?: Reference[];
  versions?: NoteVersion[];
  /**
   * Optimistic-concurrency revision (§11.4-D). Populated by the live read
   * normalization when the daemon returns it; `undefined` when absent (older
   * daemons) — callers then omit `expectedVersion` and last-writer-wins applies.
   */
  rev?: number;
  createdAt: string;
  updatedAt: string;
  is_pinned?: boolean; // Legacy compatibility
  created_at?: string; // Legacy compatibility
  updated_at?: string; // Legacy compatibility
  is_archived?: boolean; // Legacy compatibility
}

export enum ContentType {
  Markdown = 'markdown',
  PlainText = 'plain_text',
  Json = 'json',
  Code = 'code',
}

export enum NoteVisibility {
  Private = 'private',
  Workspace = 'workspace',
  Shared = 'shared',
  Public = 'public',
}

export interface NoteMetadata {
  author?: Author;
  lastAccessedAt?: string;
  accessCount?: number;
  wordCount?: number;
  characterCount?: number;
  sharedWith?: string[];
  task?: TaskMetadata;
  // Note: Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph
  // The old dependencies array has been removed
}

/**
 * Task-specific metadata for notes that are tasks
 * Phase 1A: Basic task metadata
 * Phase 1C: Agent assignment tracking
 */
export interface TaskMetadata {
  status: TaskStatus;
  assignedAgentIds?: AgentId[]; // Phase 1C: Agents working on this task
  acceptanceCriteria?: string[];
  estimatedEffort?: string;
  actualEffort?: string;
  blockedReason?: string;
  completedAt?: string;
  startedAt?: string;
  peerOrder?: number; // Order among sibling tasks with same parentId (uses gaps of 100 for easy insertion)
}

/**
 * Task status values
 * Designed for user-to-agent workflow:
 * - not_started: Task accepted but not yet being worked on
 * - waiting: Waiting on dependencies
 * - discussion_needed: Agent signals need for user planning input
 * - in_progress: Agent actively working on task
 * - review_required: Agent signals work ready for user review
 * - complete: User accepts the task output
 * - cancelled: Task abandoned
 */
export type TaskStatus =
  | 'not_started' // Task accepted but not started
  | 'waiting' // Waiting on dependencies
  | 'discussion_needed' // Agent needs user planning input
  | 'in_progress' // Agent actively working
  | 'review_required' // Work ready for user review
  | 'complete' // User accepts output
  | 'cancelled'; // Cancelled/abandoned

export interface Author {
  id: string;
  name: string;
  type: AuthorType;
  turnNumber?: number;
}

export enum AuthorType {
  User = 'user',
  Agent = 'agent',
  System = 'system',
}

export interface NoteVersion {
  versionId: string;
  versionNumber: number;
  content: string;
  title: string;
  author?: Author;
  createdAt: string;
  changeSummary?: string;
  diff?: string;
}

export interface Reference {
  type: ReferenceType;
  target: string;
  title?: string;
  description?: string;
}

export enum ReferenceType {
  File = 'file',
  Url = 'url',
  Note = 'note',
  Commit = 'commit',
  Issue = 'issue',
  PullRequest = 'pull_request',
}

// ============================================================================
// Comment & Annotation Types
// ============================================================================

export interface AnchorConfig {
  // Position type
  type?: 'mark' | 'selection' | 'position' | 'custom';

  // Mark-based positioning
  markThreadId?: string;

  // Selection-based positioning
  selectionFrom?: number;
  selectionTo?: number;

  // Absolute positioning
  position?: number;

  // Custom calculation
  calculatePosition?: (editor: any) => number;

  // Legacy properties
  line?: number;
  column?: number;
  offset?: number;
  text?: string;
}

// ============================================================================
// Agent Types
// ============================================================================

// Legacy types for backward compatibility
export interface CreateAgentRequest {
  workspaceId: WorkspaceId;
  agentName: AgentName;
  config?: any;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'end';
  content: string;
  metadata?: any;
}

export interface AgentStreamEvent {
  sessionId: AgentId;
  chunk: StreamChunk;
}

// Re-export the unified AgentSession type from agent-session.ts
export type AgentSession = NewAgentSession;
export type PendingAgentSession = NewPendingAgentSession;
export type QueuedMessage = NewQueuedMessage;
export type QueuedMessageContextItem = NewQueuedMessageContextItem;
export type SessionStats = NewSessionStats;

// Re-export type guards
export const isPendingAgentSession = isNewPendingAgentSession;
export const isAgentSession = isNewAgentSession;

export interface AgentInfo {
  id: AgentId;
  name: string;
  model: string;
  scope: AgentScope;
}

export type AgentScope =
  | 'workspace'
  | { diffs: string[] }
  | { filePattern: string }
  | { taskType: string };

// Auggie output markers
export const AUGGIE_MARKERS = {
  USER: 'USER:',
  ASSISTANT: 'ASSISTANT:',
  TOOL_CALL: 'TOOL_CALL:',
  TOOL_RESULT: 'TOOL_RESULT:',
  TOOL_SUCCESS: 'SUCCESS',
  ERROR: 'ERROR:',
} as const;

// Helper functions for MCP tools
export function isMCPTool(toolName: string): boolean {
  const mcpTools = ['mcp_', 'workspace_', 'file_', 'git_', 'terminal_'];
  return mcpTools.some((prefix) => toolName.toLowerCase().startsWith(prefix));
}

export function getMCPActivityType(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.startsWith('file_')) return 'file_operation';
  if (name.startsWith('git_')) return 'git_operation';
  if (name.startsWith('terminal_')) return 'terminal_operation';
  if (name.startsWith('workspace_')) return 'workspace_operation';
  return 'mcp_tool';
}

export interface AgentActivity {
  type: 'message' | 'tool_call' | 'error';
  timestamp: string;
  preview?: string;
}

export interface AgentProgress {
  current: number;
  total: number;
  description: string;
}

// AgentMetadata definition
// Note: Also defined in agent.types.ts but we define it here to avoid circular dependency
export interface AgentMetadata {
  contextRefs?: ContextReference[] | any[];
  contextReferences?: ContextReference[] | any[]; // Alias for contextRefs for compatibility
  launchedFrom?: string;
  provider?: string;
  model?: string;
  isBackground?: boolean;
  appliedRules?: string | null;
  workspacePath?: string; // Path to the workspace
  source?: 'workspace-initializer' | 'contextual-menu' | 'chat-panel' | 'api' | string; // Source of agent creation
  agentType?: string; // Type of agent (e.g., "investigate", "implement", "verify")
  specialist?: string; // Specialist type (e.g., "spec-writer", "implementor", "verifier")
  isInitialAgent?: boolean; // Whether this is the initial agent for a workspace
  isInitialWorkspaceAgent?: boolean; // Alias for isInitialAgent
  originalAgentId?: string; // Original agent ID if this is a restored/migrated agent
  triggerType?: string; // Type of trigger (e.g., 'commit', 'pr', 'review')
  taskNoteId?: NoteId; // Phase 1C: Task note this agent is working on
  // Agent sandbox (CoW workspace clone) fields — set by the daemon on
  // sandboxed agents (agent.list / agent.get carry them in `metadata`).
  sandboxPath?: string; // Absolute daemon-host path of the sandbox directory
  sandboxId?: string; // Sandbox identifier
  sandboxBranch?: string; // Git branch checked out inside the sandbox
  // Allow additional properties for flexibility with proper typing
  [key: string]: string | number | boolean | null | undefined | any[] | ContextReference[];
}

/**
 * @deprecated Use CreateAgentOptions from '$shared/types/agent.types' instead.
 * This legacy interface is kept for backward compatibility only.
 * The full interface in agent.types.ts includes agentType, isBackground, etc.
 */
export interface CreateAgentOptions {
  workspaceId: string;
  name: string;
  model?: string;
  scope?: 'workspace' | 'file' | 'selection';
  metadata?: AgentMetadata;
}

export interface SendMessageOptions {
  stdinContext?: string;
  shouldSendContext?: boolean;
  currentContext?: {
    type: 'file' | 'note' | 'spec';
    path?: string;
    title?: string;
    noteId?: string;
  };
}

export interface AgentServiceState {
  sessions: Map<string, AgentSession>;
  activeSessionId: string | null;
}

/**
 * @deprecated Use ContextReference from '$features/agent/agent-context' instead.
 * This is a minimal version kept for backward compatibility.
 * The canonical definition is in agent-context.ts with full support for all reference types.
 */
export interface ContextReference {
  type: 'file' | 'selection' | 'diff' | 'note';
  path?: string;
  range?: { start: number; end: number };
  content?: string;
}

// ContentBlock is now imported from ./types/content-block.ts
// See that file for the consolidated definition

export interface ToolUseBlock {
  type: 'tool_use';
  /** Addressable block id (`{messageId}:{blockIndex}`, PROTOCOL §7.1) */
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Provider tool-call id — tool_result blocks reference it via `tool_use_id` (PROTOCOL §7.1) */
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  /** Addressable block id (PROTOCOL §7.1) */
  id?: string;
  tool_use_id: string;
  /** Tool result payload (PROTOCOL §7.1) */
  output?: unknown;
  /** Legacy payload field — superseded by `output` */
  content?: string;
  is_error?: boolean;
}

// ToolCall is now imported from ./types/agent-message.ts
// See that file for the consolidated definition

// AgentMessage is now imported from ./types/agent-message.ts
// See that file for the consolidated definition

// ============================================================================
// Git Types
// ============================================================================

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  /** True when local and remote branches have diverged (both ahead > 0 and behind > 0) */
  diverged: boolean;
  files: FileStatus[];
  hasUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
}

export interface FileStatus {
  path: string;
  status: GitFileStatus;
  staged: boolean;
}

export enum GitFileStatus {
  Modified = 'M',
  Added = 'A',
  Deleted = 'D',
  Renamed = 'R',
  Copied = 'C',
  Untracked = '?',
  Ignored = '!',
}

export interface CommitInfo {
  hash: string;
  sha?: string;
  author: string;
  email: string;
  date: string;
  message: string;
  /**
   * Omitted by the metadata-only `git.commits` list payload (PROTOCOL §5.6);
   * fetched on demand via `git.commitDetails`.
   */
  files?: string[];
  /** Agent ID if this commit was made by an agent (e.g., via auto-commit) */
  agentId?: string;
  /** Linked note ID for the task the agent was working on */
  linkedNoteId?: string;
}

// ============================================================================
// Terminal Types
// ============================================================================

export interface TerminalSession {
  id: string;
  workspaceId: WorkspaceId;
  agentId?: AgentId;
  type: 'agent' | 'user' | 'system';
  command?: string;
  cwd: string;
  status: TerminalStatus;
  output: string[];
  createdAt: string;
  updatedAt: string;
}

export enum TerminalStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Killed = 'killed',
}

// Terminal types - simplified after removing legacy terminal system
export interface ExecuteCommandOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onExit?: (code: number) => void;
}

// CommandResult is defined in features/tools/types.ts - import from there if needed

export interface TerminalOutputLine {
  type: 'stdout' | 'stderr' | 'command' | 'info';
  content: string;
  timestamp: string;
  sessionId?: string;
}

export interface SessionEvent {
  type: string;
  sessionId: string;
  timestamp: string;
  data?: any;
}

export interface AuggieToolCall {
  id?: string;
  toolName?: string;
  toolUseId?: string;
  name?: string;
  input?: Record<string, any>;
  output?: string;
  result?: string;
  isError?: boolean;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  messageId?: string;
  metadata?: {
    reasoning?: string;
    [key: string]: any;
  };
  fileOperations?: FileOperation[];
}

export interface ITerminalRenderer {
  render(lines: TerminalOutputLine[]): void;
  clear(): void;
  write(data: string): void;
  focus(): void;
  dispose(): void;
}

export interface AgentTerminalSession {
  id: string;
  workspaceId: WorkspaceId;
  agentId?: AgentId;
  type: 'agent' | 'user' | 'system';
  command?: string;
  cwd: string;
  status: TerminalStatus;
  output: string[];
  createdAt: string;
  updatedAt: string;
  agentName?: string;
  agentModel?: string;
}

// ============================================================================
// API Types
// ============================================================================

// Command response format (used by IPC handlers)
export interface CommandResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Legacy types for backward compatibility
export interface FileOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface FileSaveResult extends FileOperationResult {
  filePath?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SettingsOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface SystemOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AugmentCommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface AugmentStreamOptions {
  onData?: (data: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

// EventActor is imported from the canonical definition in events/types.ts
export type { ActorType, EventActor } from '../features/events/types';

/**
 * Provenance information for tracking the origin of changes
 */
export interface ProvenanceInfo {
  source: 'agent' | 'user' | 'system' | 'external' | 'git';
  agent?: {
    id: string;
    name: string;
    sessionId?: string;
    model?: string;
    temperature?: number;
  };
  chat?: {
    messageId?: string;
    exchangeId?: string;
    threadId?: string;
    turnNumber?: number;
  };
  execution?: {
    model?: string;
    temperature?: number;
    reasoning?: string;
    toolCallId?: string;
    timestamp?: string;
  };
}

// WorkspaceEvent and WorkspaceEventType have been moved to $features/events/types
// Import from there instead

export interface NoteEvent {
  type: NoteEventType;
  noteId: NoteId;
  workspaceId: WorkspaceId;
  timestamp: string;
  data?: any;
}

export enum NoteEventType {
  Created = 'note:created',
  Updated = 'note:updated',
  Deleted = 'note:deleted',
  Pinned = 'note:pinned',
  Unpinned = 'note:unpinned',
}

// ============================================================================
// Workspace UI Context Types
// ============================================================================

export interface WorkspaceUIContext {
  workspaceId: WorkspaceId;
  mainContentType: 'empty' | 'file' | 'note' | 'diff' | 'terminal' | 'source' | 'browser';
  mainContentId?: string;
  mainContentPath?: string;
  mainContentUrl?: string; // For third-party sources
  diffInfo?: {
    additions: number;
    deletions: number;
    isStaged: boolean;
    gitStatus: string; // "untracked", "modified", "added", "deleted", "renamed"
    changeType: 'created' | 'modified' | 'deleted' | 'renamed';
  };
  secondaryContentType?: 'empty' | 'file' | 'note' | 'diff' | 'terminal' | 'source' | 'browser';
  secondaryContentId?: string;
  secondaryContentPath?: string;
  secondaryContentUrl?: string; // For third-party sources
  lastUpdated: string;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreateWorkspaceRequest {
  title?: string;
  statusMessage?: string;
  repositoryPath?: string;
  githubUrl?: string; // GitHub URL to clone (e.g., https://github.com/owner/repo)
  clonePath?: string; // User-selected folder path where the GitHub repo should be cloned
  branch?: string;
  baseRef?: string;
  remote?: string; // Git remote to use (default: 'origin', e.g., 'upstream' for forks)
  scope?: string; // Optional relative path within worktreePath
  setupScript?: string; // Shell script to run in worktree after creation
  environmentConfig?: EnvironmentConfig; // Remote environment configuration
  isNewRepo?: boolean; // If true, initialize a new git repository at repositoryPath
  skipIsolation?: boolean; // If true, skip the isolated checkout (worktree or CoW clone) and work directly in the repo folder (wire: canonical for the deprecated skipWorktree alias)
  initialAgent?: {
    /**
     * DEPRECATED: the daemon assigns the initial agent's id and returns it on
     * the `workspace.create` result (`initialAgent.id`). Clients must no
     * longer pre-mint or send this field; a follow-up intentd change rejects
     * client-supplied agent ids outright.
     */
    agentId?: string;
    name?: string;
    model?: string;
    prompt?: string;
    rules?: string;
    agentType?: string;
    specialist?: string; // Specialist or team coordinator ID (supports any specialist)
    behaviorPrompt?: string; // Custom behavior instructions (from team coordinator or specialist)
    provider?: string; // ACP provider ID (auggie, claude-code, codex)
    contextReferences?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
    metadata?: Record<string, any>;
  };
  /** Linear issue to link to this workspace */
  linearIssue?: {
    id: string;
    identifier: string; // e.g., "ENG-123"
    title: string;
    description?: string;
    url?: string;
    teamName?: string;
    teamKey?: string;
    state?: string;
    priority?: number;
  };
  /** Sentry issue to link to this workspace */
  sentryIssue?: {
    id: string;
    shortId: string; // e.g., "PROJ-123"
    title: string;
    culprit?: string;
    permalink?: string;
    projectSlug?: string;
    projectName?: string;
    level?: string;
    status?: string;
    count?: number;
    firstSeen?: string;
    lastSeen?: string;
  };
}

export interface UpdateWorkspaceRequest {
  id: WorkspaceId;
  title?: string;
  branch?: string;
  baseRef?: string;
  baseCommitSha?: string;
  status?: WorkspaceStatus;
  statusMessage?: string;
  tags?: string[];
  prUrl?: string | null;
  prNumber?: number | null;
  prStatus?: PullRequestStatus | null;
  activePullRequest?: PullRequestInfo | null;
  pullRequests?: PullRequestInfo[];
}

export interface CreateNoteRequest {
  workspaceId: WorkspaceId;
  title: string;
  content: string;
  contentType?: ContentType;
  tags?: string[];
  parentId?: NoteId;
  visibility?: NoteVisibility;
}

export interface UpdateNoteRequest {
  id: NoteId;
  workspaceId?: WorkspaceId; // Required by IPC layer for validation
  title?: string;
  content?: string;
  contentType?: ContentType;
  tags?: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  visibility?: NoteVisibility;
  metadata?: Record<string, any>; // Note metadata
  isUserAction?: boolean; // Flag to indicate this is a direct user action
}

// ============================================================================
// Utility Types
// ============================================================================

export type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type AsyncResult<T> = Promise<Result<T>>;

// ============================================================================
// Configuration Types
// ============================================================================

export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  autoSave: boolean;
  autoSaveInterval: number;
  defaultBranch: string;
  workspacesPath: string;
  enableTelemetry: boolean;
  enableAutoUpdate: boolean;
}

export interface UserPreferences {
  editorFontSize: number;
  editorTheme: string;
  showLineNumbers: boolean;
  wordWrap: boolean;
  tabSize: number;
  insertSpaces: boolean;
}

// ============================================================================
// Auggie Message Types (re-exported from agent.types.ts above)
// ============================================================================

// ============================================================================
// Agent Activity Types
// ============================================================================

export type AgentActivityType =
  | 'agent-start'
  | 'agent-content'
  | 'agent'
  | 'tool-call-start'
  | 'tool-call-complete'
  | 'tool'
  | 'mcp-call'
  | 'mcp-result'
  | 'mcp'
  | 'agent-complete'
  | 'error'
  | 'file_operation'
  | 'file-operation'
  | 'git_operation'
  | 'terminal_operation'
  | 'workspace_operation'
  | 'mcp_tool'
  | 'note'
  | 'note-created'
  | 'note-read'
  | string;

export interface AgentActivityEvent {
  id: string;
  type: AgentActivityType;
  timestamp: string;
  description?: string;
  sessionId: string;
  workspaceId: string;
  content?: string;
  agentName?: string;
  toolCall?: {
    toolName?: string;
    parameters?: any;
    result?: any;
    status?: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    id?: string;
    startTime?: number;
    endTime?: number;
    name?: string;
    input?: Record<string, any>;
    output?: string;
  };
  mcpCall?: MCPToolCall;
  fileOperation?: FileOperation;
  error?: string;
  metadata?: Record<string, any>;
}

export interface MCPToolCall {
  id: string;
  name: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  result?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  duration?: number;
  arguments?: Record<string, any>;
}

export interface AgentResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  mcpCalls?: MCPToolCall[];
}

export interface ParsedAuggieOutput {
  content?: string;
  toolCalls?: ToolCall[];
  mcpCalls?: MCPToolCall[];
  errors?: string[];
  [key: string]: any;
}

export interface AgentActivityLogEntry {
  id: string;
  sessionId: string;
  workspaceId: string;
  type: AgentActivityType;
  timestamp: string;
  description?: string;
  data?: any;
  level?: 'info' | 'warning' | 'error' | 'debug';
  context?: string;
  [key: string]: any;
}

export interface FileOperation {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  type?: 'create' | 'modify' | 'delete' | 'rename';
  content?: string;
  oldContent?: string;
  timestamp: string;
  diff?: string;
  additions?: number;
  deletions?: number;
}

export interface AgentSessionState {
  id: string;
  status: 'active' | 'inactive' | 'completed';
  messages: any[];
  [key: string]: any;
}

// ============================================================================
// Auggie Session Types
// ============================================================================

/**
 * Response from `auggie session list --json`
 * This is what Auggie returns when listing sessions
 */
export interface AuggieSessionListItem {
  sessionId: string;
  created: string;
  modified: string;
  exchangeCount: number;
  workspaceRoot: string;
  firstUserMessage: string;
  lastUserMessage: string;
  userMessages: string[];
  lastRequestId: string;
  requestIds: string[];
}

export interface AuggieSession {
  sessionId: string;
  chatHistory: ChatExchange[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatExchange {
  exchange: {
    request_id: string;
    response_nodes?: ResponseNode[];
  };
  finishedAt?: string;
}

export interface ResponseNode {
  type: number;
  tool_use?: {
    tool_name: string;
    tool_use_id: string;
    input_json: string;
  };
}

export interface ExtractedFileChange {
  sessionId: string;
  exchangeId: string;
  filePath: string;
  changeType?: 'create' | 'modify' | 'delete';
  timestamp: string;
  toolName: string;
  toolUseId: string;
  content?: string;
  oldContent?: string;
  newContent?: string;
  startLine?: number;
  endLine?: number;
  [key: string]: any; // Allow additional properties
}

// ============================================================================
// File Explorer Types
// ============================================================================

export interface FileGitStatus {
  status: string; // Git status code (e.g., "M ", " M", "??", "A ", etc.)
  additions?: number;
  deletions?: number;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modified?: string;
  /** Whether this file/directory is matched by .gitignore patterns */
  isGitignored?: boolean;
}

// ============================================================================
// API Types
// ============================================================================

export interface CommandResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
}

// Export comment types
export type { NoteComment, NoteCommentsData } from './types/comment.types';
