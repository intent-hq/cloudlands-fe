/**
 * AppClient — the single boundary the renderer uses to reach "the backend".
 *
 * Domains mirror today's Redux slices and the existing `ws.*` shape. Each
 * domain exposes async query methods returning `Promise<T>`, reactive
 * `subscribe(handler) => Unsubscribe` streams, and mutation methods returning
 * `Promise<MutationResult>`. `MockAppClient` implements this now with in-memory
 * fixtures; a future `WebSocketAppClient` implements the same contract.
 *
 * All method types are anchored to the existing slice `*-types.ts` so the seam
 * stays aligned with the live store shape.
 */
import type {
  AgentMessage,
  AgentSession,
  ContentBlock,
  CreateNoteRequest,
  CreateWorkspaceRequest,
  DiffChunk,
  FileGitStatus,
  FileNode,
  GitStatus,
  Note,
  QueuedMessage,
  TaskStatus,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceTask,
  WorkspaceTaskStats,
} from "$shared/types";
import type { CommitInfo, TrackedChange } from "$features/file-tracking/types";
import type { WorkspaceEvent } from "$features/events/types";
import type { TokenUsage } from "$features/token-usage/token-usage-types";
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type {
  ScriptRuntimeState,
  ScriptWithState,
  WorkspaceScript,
} from "$store/renderer/slices/scripts/scripts-types";
import type { ScriptCategory, ScriptMode } from "$features/scripts/types";
import type { SetupScript } from "$store/renderer/slices/setup-scripts/setup-scripts-types";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import type { RecentUrl } from "$store/renderer/slices/browser/browser-types";
import type { McpServerConfig } from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import type { UserPreferencesState } from "$store/renderer/slices/user-preferences/user-preferences-slice";
import type { ProviderSettingsState } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import type { SingleWorkspaceSettings } from "$store/renderer/slices/workspace-settings/workspace-settings-slice";
import type { BackgroundAgentSettingsState } from "$store/renderer/slices/background-agent-settings/background-agent-settings-slice";
import type { GitHubUser } from "$features/github-auth/types";
import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";
import type { SentryIssueResult } from "$features/sentry-auth/types";
import type { ReleaseNotes } from "$store/renderer/slices/release-notes/release-notes-types";
import type { SystemStatusState } from "$store/renderer/slices/system-status/system-status-slice";
import type { AutoUpdateState } from "$store/renderer/slices/auto-update/auto-update-types";
import type { CommentV2 } from "$store/renderer/slices/comments/comments-types";
import type { CommentType } from "$features/comments/comment-types-v2";
import type { FileContentEntry } from "$store/renderer/slices/files/files-types";

/** Disposer returned by every `subscribe()` call. */
export type Unsubscribe = () => void;

/** Reactive subscription callback invoked with the latest snapshot. */
export type SubscriptionHandler<T> = (snapshot: T) => void;

/** Uniform result for mutation methods. */
export interface MutationResult {
  success: boolean;
  error?: string;
  /**
   * Canonical id of the entity the mutation created/affected, surfaced when the
   * daemon returns one (e.g. `task.createPrerequisite` returns a WorkspaceTask
   * per Rev 2 §7.9). Additive and optional: call sites that ignore it are
   * unaffected, so it stays backward-compatible across all domains.
   */
  id?: string;
  /**
   * Optimistic-concurrency conflict outcome (§11.4-D): present ONLY when the
   * daemon rejected the mutation with the conflict error (numeric `-32005` AND
   * `data.code === "conflict"`). Carries the authoritative server entity
   * (`data.current`, including its advanced `rev`) so the caller can
   * reload-to-latest. Additive: success and non-conflict error paths never set
   * it, so existing call sites are unaffected. The live clients normalize
   * `current` into the domain entity (`Note` / `WorkspaceTask`) before returning.
   */
  conflict?: { current: unknown };
  /**
   * Queued-message surface returned by `agents.queue` (`agent.queueMessage`,
   * §5.5). Surfaced on the uniform mutation result so the queue-on-send caller
   * can seed the local `agent-queue` slice from the server snapshot without an
   * extra `agent.getQueue` round-trip. Additive and optional: other mutation
   * paths never set it.
   */
  queuedMessage?: QueuedMessage;
}

/**
 * Request shape for creating an agent through the seam (PROTOCOL §5.5). The
 * widened P2-12a wire lets the FE hand the daemon everything it needs when it
 * stops spawning agent processes locally and routes creation through
 * `agent.create` instead. All new fields are optional and additive — omitted
 * fields fall back to the pre-widening behavior.
 *
 * - `prompt` maps to the wire `behaviorPrompt` (the seam field predates the
 *   §5.5 rename; kept as `prompt` here for caller ergonomics).
 * - `name` names the session at creation instead of the auto-generated
 *   `"Agent <hex>"` fallback.
 * - `agentId` is honored verbatim by the daemon (`agent-{uuid}` shape); used
 *   so the caller can address `agent.sendMessage` at the same id it just
 *   handed us (fixes the create→send race).
 * - `provider` / `agentType` / `metadata` / `workspacePath` / `workspaceContext`
 *   are the widened FE-facing spawn hints — the daemon persists `provider` on
 *   the session; the rest are accepted but not yet stored (deferred).
 */
export interface AgentCreateRequest {
  workspaceId: string;
  prompt?: string;
  model?: string;
  specialist?: string | null;
  name?: string;
  agentId?: string;
  provider?: string;
  agentType?: string;
  metadata?: Record<string, unknown>;
  workspacePath?: string;
  workspaceContext?: Record<string, unknown>;
}

/** Pull-request summary surfaced by the git domain. */
export interface PrStatusSummary {
  prNumber?: number;
  url?: string;
  state?: string;
}

/**
 * Branch listing for an arbitrary repo path (`git.getBranches`, §5.6). Mirrors
 * the daemon `GitBranches` shape: `branches` is the local branch list,
 * `remoteBranches` is the remote-only list (only populated when
 * `includeRemote=true`), and `currentBranch`/`defaultBranch` carry the
 * checkout/default names.
 */
export interface GitBranchesResult {
  branches: string[];
  remoteBranches: string[];
  currentBranch: string;
  defaultBranch: string;
}

/**
 * Branch status for an arbitrary repo path (`git.branchStatus`, §5.6). Mirrors
 * the daemon `GitBranchStatus` shape: ahead/behind of the queried branch's
 * upstream (`origin/<branchName>`), the worktree's currently-checked-out branch
 * with a derived `isCurrentBranch` flag, and a porcelain dirty-tree flag.
 */
export interface GitBranchStatusResult {
  branch: string;
  currentBranch: string;
  isCurrentBranch: boolean;
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
}

/** `workspace.update` outcome — carries the daemon's updated workspace on success. */
export interface WorkspaceUpdateResult extends MutationResult {
  workspace?: Workspace;
}

/** `workspace.create` outcome — carries the daemon's created workspace on success. */
export interface WorkspaceCreateResult extends MutationResult {
  workspace?: Workspace;
}

export interface WorkspacesClient {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | null>;
  /**
   * Open a workspace by id (route loader entry point). Returns the matching
   * workspace, or `null` when it cannot be resolved. The daemon exposes no
   * separate `workspace.open` RPC today — implementations resolve the workspace
   * via `workspace.get` and let the daemon own any side effects (watchers,
   * monitoring) that the legacy main-process handler used to start.
   */
  open(id: string): Promise<Workspace | null>;
  /**
   * Create a workspace (`workspace.create`, §5.1). The daemon returns
   * `{ workspace }` — surfaced as `workspace` so the legacy `workspace:create`
   * bridge can hand callers the created entity without a follow-up read.
   */
  create(request: CreateWorkspaceRequest): Promise<WorkspaceCreateResult>;
  /**
   * Update workspace fields (`workspace.update`, §5.1). The FE request `id`
   * maps to the wire `workspaceId`. On success the daemon's authoritative
   * updated `Workspace` is surfaced as `workspace` so callers can upsert it
   * without a follow-up `workspace.get`.
   */
  update(request: UpdateWorkspaceRequest): Promise<WorkspaceUpdateResult>;
  delete(id: string): Promise<MutationResult>;
  /** Archive a workspace (`workspace.archive`, §5.1). */
  archive(id: string): Promise<MutationResult>;
  /** Unarchive a workspace (`workspace.unarchive`, §5.1) — the archive-undo path. */
  unarchive(id: string): Promise<MutationResult>;
  setActive(id: string): Promise<MutationResult>;
  recentViews(): Promise<Record<string, number>>;
  /**
   * `workspace.getTokenUsage` (PROTOCOL §5.23): the daemon-owned usage rollup
   * for one workspace (the scan job itself is daemon-internal). Returns `null`
   * when the workspace is unknown. Updated rollups are pushed via the
   * `workspace:tokenUsage-changed` event (§6.5).
   */
  getTokenUsage(workspaceId: string): Promise<TokenUsage | null>;
  subscribe(handler: SubscriptionHandler<Workspace[]>): Unsubscribe;
}

export interface AgentsClient {
  list(workspaceId: string): Promise<AgentSession[]>;
  get(agentId: string): Promise<AgentSession | null>;
  /**
   * Full retained transcript for an agent (`agent.getConversation`, §5.5). Returns
   * AgentMessage-granular messages (role/turn structure preserved) — the source
   * the conversation UI hydrates from, unlike `chat.history` (flattened blocks).
   * `limit` caps the most-recent-N returned; `truncated`/`totalMessages` report
   * whether older history was dropped beyond the cap.
   */
  getConversation(
    agentId: string,
    limit?: number,
  ): Promise<{ messages: AgentMessage[]; truncated: boolean; totalMessages: number }>;
  /**
   * Create an agent session (`agent.create`, §5.5). The daemon returns the
   * full `AgentLite` projection of the newly persisted session (widened in
   * P2-12a from the earlier `{id, name}` snippet), which this method
   * normalizes into the renderer `AgentSession` shape and returns directly so
   * callers can upsert into the store without a follow-up `agent.get`.
   * Transport / daemon errors propagate as rejections.
   */
  create(request: AgentCreateRequest): Promise<AgentSession>;
  send(agentId: string, message: string): Promise<MutationResult>;
  queue(agentId: string, message: string): Promise<MutationResult>;
  /**
   * Remove a queued message (`agent.removeQueuedMessage`, §5.5). The daemon is
   * **idempotent** — it always returns `{ success: true }` even when the queue
   * is empty or the messageId is unknown — so callers MUST treat any thrown
   * error as a transport failure, never as a "not found" that should roll the
   * optimistic delete back. Emits `agent:queue:updated` (§6.5) only when the
   * queue actually changed.
   */
  removeQueued(agentId: string, messageId: string): Promise<MutationResult>;
  setAvailability(agentId: string, available: boolean): Promise<MutationResult>;
  follow(agentId: string, follow: boolean): Promise<MutationResult>;
  lock(agentId: string, locked: boolean): Promise<MutationResult>;
  /**
   * Permanently delete an agent session (`agent.delete`, §5.5). The daemon is
   * **idempotent** — it returns `{ success: true }` even when the agent is
   * already gone — and emits `agent:deleted` (in `AGENT_LIFECYCLE_EVENTS`), so
   * the reactive `subscribe` refetch reconciles the list. `workspaceId` is
   * optional per the contract; the daemon resolves the workspace itself.
   */
  delete(agentId: string, workspaceId?: string): Promise<MutationResult>;
  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe;
}

export interface ChatClient {
  history(agentId: string): Promise<ContentBlock[]>;
  tokenUsage(agentId: string): Promise<{ input: number; output: number }>;
  subscribe(agentId: string, handler: SubscriptionHandler<ContentBlock[]>): Unsubscribe;
}

/** Parameters for `terminal.create` (PROTOCOL §5.13). `command` omitted ⇒ default shell. */
export interface TerminalCreateParams {
  workspaceId: string;
  cols: number;
  rows: number;
  cwd?: string;
  command?: string;
}

/** Decoded `terminal:data` payload — `chunk` is the UTF-8 string the daemon base64-encoded. */
export interface TerminalDataEvent {
  terminalId: string;
  chunk: string;
}

/** `terminal:exit` payload. */
export interface TerminalExitEvent {
  terminalId: string;
  exitCode: number;
}

/** `terminal:cwd` payload. */
export interface TerminalCwdEvent {
  terminalId: string;
  cwd: string;
}

/** `terminal:title` payload. */
export interface TerminalTitleEvent {
  terminalId: string;
  title: string;
}

/** Per-terminal event sink registered via `TerminalsClient.subscribeEvents`. */
export interface TerminalEventHandlers {
  onData?(event: TerminalDataEvent): void;
  onExit?(event: TerminalExitEvent): void;
  onCwd?(event: TerminalCwdEvent): void;
  onTitle?(event: TerminalTitleEvent): void;
}

export interface TerminalsClient {
  list(workspaceId: string): Promise<TerminalTab[]>;
  /**
   * `terminal.create` (PROTOCOL §5.13). On success the daemon-assigned
   * terminalId is surfaced as `MutationResult.id`.
   */
  create(params: TerminalCreateParams): Promise<MutationResult>;
  /** `terminal.write` — `data` is plain text; the live client base64-encodes it. */
  write(terminalId: string, data: string): Promise<MutationResult>;
  /** `terminal.resize`. */
  resize(terminalId: string, cols: number, rows: number): Promise<MutationResult>;
  /** `terminal.kill` — signals the PTY; the daemon then emits `terminal:exit`. */
  kill(terminalId: string): Promise<MutationResult>;
  /**
   * `terminal.getBuffer` — base64 scrollback for replay on (re)connect. The
   * live client decodes the base64 payload so callers receive a plain string.
   */
  getBuffer(terminalId: string, maxBytes?: number): Promise<string>;
  /** Ported `terminal.readOutput` — plaintext convenience read for MCP-style callers. */
  output(terminalId: string): Promise<string>;
  /** Subscribe to `terminal:*` events scoped to a single terminalId. */
  subscribeEvents(terminalId: string, handlers: TerminalEventHandlers): Unsubscribe;
  subscribe(handler: SubscriptionHandler<TerminalTab[]>): Unsubscribe;
}

/**
 * Wire-level setting definition (PROTOCOL §5.12 `SettingDefinition`). The
 * `value` field is appended by `settings.list` / `settings.get` (the spec calls
 * this `SettingDefinitionWithValue`); sensitive entries surface a redacted
 * placeholder rather than the raw secret.
 */
export interface SettingDefinitionWithValue {
  path: string;
  label: string;
  description: string;
  category: string;
  type: "boolean" | "number" | "string" | "enum" | "object";
  enumValues?: string[];
  min?: number;
  max?: number;
  defaultValue?: unknown;
  sensitive?: boolean;
  value: unknown;
}

/** Wire-level change entry for `settings.update` (PROTOCOL §5.12 `AppSettingChange`). */
export interface AppSettingChange {
  path: string;
  value: unknown;
  reason?: string;
}

/** Applied entry surfaced by `settings.update` / `settings:changed` (§5.12 / §6.5). */
export interface AppliedSettingChange {
  path: string;
  value: unknown;
}

/** One user-override rule as read via `rules.get` (§5.21). */
export interface UserRuleState {
  enabled: boolean;
  content: string;
  updatedAt: number;
}

export interface SettingsClient {
  /** `settings.list` (§5.12). Returns every BE-owned setting with its current value (sensitive values redacted). */
  list(): Promise<SettingDefinitionWithValue[]>;
  /** `settings.get` (§5.12). Returns the single setting + its definition; `null` when the daemon rejects the path. */
  get(path: string): Promise<SettingDefinitionWithValue | null>;
  /** `settings.update` (§5.12). Atomic batch update; emits `settings:changed` on success. */
  update(changes: AppSettingChange[]): Promise<AppliedSettingChange[]>;
  /** `settings.reset` (§5.12). Restores one setting to its `defaultValue`. */
  reset(path: string): Promise<AppliedSettingChange | null>;
  /** `rules.get` (§5.21). Reads one global user-override rule type; `null` when the probe fails. */
  getUserRule(ruleType: string): Promise<UserRuleState | null>;
  /** `rules.update` (§5.21). Upserts the global user-override body (+ `enabled`) for one rule type. */
  updateUserRule(ruleType: string, content: string, enabled?: boolean): Promise<MutationResult>;
  getUserPreferences(): Promise<UserPreferencesState | null>;
  setUserPreferences(prefs: Partial<UserPreferencesState>): Promise<MutationResult>;
  getProviderSettings(): Promise<ProviderSettingsState | null>;
  setProviderSettings(settings: Partial<ProviderSettingsState>): Promise<MutationResult>;
  getMcpServers(): Promise<McpServerConfig[]>;
  setMcpServers(servers: McpServerConfig[]): Promise<MutationResult>;
  getWorkspaceSettings(workspaceId: string): Promise<SingleWorkspaceSettings | null>;
  setWorkspaceSettings(
    workspaceId: string,
    settings: Partial<SingleWorkspaceSettings>,
  ): Promise<MutationResult>;
  getBackgroundAgentSettings(): Promise<BackgroundAgentSettingsState | null>;
  setBackgroundAgentSettings(
    settings: Partial<BackgroundAgentSettingsState>,
  ): Promise<MutationResult>;
  subscribe(handler: SubscriptionHandler<UserPreferencesState | null>): Unsubscribe;
}

export interface FilesClient {
  list(workspaceId: string): Promise<FileContentEntry[]>;
  read(workspaceId: string, path: string): Promise<FileContentEntry | null>;
  /** Root node of the workspace file tree, or `null` when no tree is available. */
  explorerTree(workspaceId: string): Promise<FileNode | null>;
  /**
   * Immediate children of one directory (`file.list`), as tree nodes for the
   * explorer's lazy expand/refresh. Workspace-relative `path`; `""` lists the
   * workspace root. Resolves `[]` when the directory is empty or unavailable.
   */
  listDirectory(workspaceId: string, path: string): Promise<FileNode[]>;
  /** Per-file git status keyed by workspace-relative path, for the explorer overlay. */
  gitStatusMap(workspaceId: string): Promise<Record<string, FileGitStatus>>;
  subscribe(handler: SubscriptionHandler<FileContentEntry[]>): Unsubscribe;
  /** Write file content (`file.write`); create-ish, so the live client attaches an idempotencyKey (§5.6). */
  write(workspaceId: string, path: string, content: string): Promise<MutationResult>;
  /** Delete a file (`file.delete`). */
  delete(workspaceId: string, path: string): Promise<MutationResult>;
  /** Create a directory (`file.mkdir`); create, so the live client attaches an idempotencyKey (§5.6). */
  mkdir(workspaceId: string, path: string): Promise<MutationResult>;
  /** Rename/move a file (`file.rename`); carries a best-effort idempotencyKey. */
  rename(workspaceId: string, oldPath: string, newPath: string): Promise<MutationResult>;
}

/** Parameters for a `git.commit` mutation. `userRequested` MUST be true (§7.7). */
export interface GitCommitParams {
  message: string;
  files?: string[];
  amend?: boolean;
  /** Required `true`: the daemon rejects commits that are not explicitly user-requested. */
  userRequested: boolean;
}

/** Per-file `(additions, deletions)` entry on a `CommitDetailsResult`. */
export interface CommitFileDetail {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * Flattened result of a `git.commitDetails` read (PROTOCOL §5.6) — metadata +
 * per-file stats for a single commit. `files` mirrors `fileDetails[].path` for
 * callers that only want the path list.
 */
export interface CommitDetailsResult {
  commitHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  files: string[];
  fileDetails: CommitFileDetail[];
}

/** Optional filters for the `git.diffs` read (PROTOCOL §5.6). */
export interface GitDiffsOptions {
  /** Filter the result to a single workspace-relative file path. */
  path?: string;
  /** When `true`, returns the HEAD→index (staged) diff; ignored if `commitHash` is set. */
  staged?: boolean;
  /** When set, returns the per-file hunks for `<commitHash>^..<commitHash>`. */
  commitHash?: string;
}

export interface GitClient {
  status(workspaceId: string): Promise<GitStatus | null>;
  changes(workspaceId: string): Promise<GitStatus | null>;
  /**
   * `git.diffs` — per-file hunks. Defaults to the index→workdir (unstaged)
   * diff; `options.staged` selects HEAD→index; `options.commitHash` returns the
   * commit's own changes against its first parent (`<commitHash>^..<commitHash>`).
   */
  diffs(workspaceId: string, options?: GitDiffsOptions): Promise<DiffChunk[]>;
  trackedChanges(workspaceId: string): Promise<TrackedChange[]>;
  commits(workspaceId: string): Promise<CommitInfo[]>;
  /**
   * `git.commitDetails` — metadata + per-file `(additions, deletions)` for one
   * commit. Returns `null` on transport failure so callers degrade gracefully.
   */
  commitDetails(workspaceId: string, commitHash: string): Promise<CommitDetailsResult | null>;
  prStatus(workspaceId: string): Promise<PrStatusSummary | null>;
  /**
   * Path-based branch listing (`git.getBranches`, §5.6). Used by the
   * workspace initializer to populate the branch picker against an arbitrary
   * repo path BEFORE a workspace exists. Errors fold to `null` so callers can
   * surface a friendly fallback instead of crashing.
   */
  getBranches(repoPath: string, includeRemote: boolean): Promise<GitBranchesResult | null>;
  /**
   * Path-based branch status (`git.branchStatus`, §5.6). Used by the
   * workspace-initializer `BranchSelector` to surface ahead/behind +
   * uncommitted-changes indicators against an arbitrary repo path BEFORE a
   * workspace exists. Errors fold to `null` so callers can surface a friendly
   * fallback without crashing on `result.success` against undefined.
   */
  branchStatus(repoPath: string, branchName: string): Promise<GitBranchStatusResult | null>;
  /**
   * Path-based pull (`git.pull`, §5.6) — ports the legacy `git:pullBranch` IPC
   * used by the workspace-create auto-pull, which runs against an arbitrary
   * repo path BEFORE a workspace exists. Ordinary pull failures (conflicts,
   * unreachable remote, stash recovery) are the daemon's structured
   * `{ ok: false, error }` result, folded into `{ success: false, error }`;
   * transport/validation errors fold the same way. Never throws.
   */
  pull(repoPath: string, branchName: string): Promise<MutationResult>;
  subscribe(handler: SubscriptionHandler<GitStatus | null>): Unsubscribe;
  /**
   * Stage explicit paths (`git.stage`). Rejects all-files globs ('.'/'*'/'--all')
   * — staging requires explicit paths per contract.
   */
  stage(workspaceId: string, paths: string[]): Promise<MutationResult>;
  /**
   * Create a commit (`git.commit`). REQUIRES `userRequested: true`; the live
   * client attaches an idempotencyKey (§5.6/§7.7). DESTRUCTIVE.
   */
  commit(workspaceId: string, params: GitCommitParams): Promise<MutationResult>;
}

/** Optional placement for a surgical `note.add`. */
export interface NoteAddOptions {
  heading?: string;
  /** `"start"`, `"end"`, or `"after:Heading"`. */
  position?: string;
}

/** Metadata fields a `note.updateMetadata` mutation may change. */
export interface NoteMetadataPatch {
  title?: string;
  tags?: string[];
}

export interface NotesClient {
  list(workspaceId: string): Promise<Note[]>;
  get(noteId: string): Promise<Note | null>;
  subscribe(handler: SubscriptionHandler<Note[]>): Unsubscribe;
  /** Create a note (`note.create`); the live client attaches an idempotencyKey (§5.6). */
  create(request: CreateNoteRequest): Promise<MutationResult>;
  /**
   * Full-replacement of a note's content (`note.setContent`). Optional
   * `expectedVersion` (§11.4-D) is forwarded ONLY when the caller knows the
   * current `rev`; omitted otherwise → last-writer-wins, exactly as today.
   */
  setContent(noteId: string, content: string, expectedVersion?: number): Promise<MutationResult>;
  /** Surgical, append-safe insert (`note.add`). `expectedVersion` is optional (§11.4-D). */
  add(
    noteId: string,
    content: string,
    options?: NoteAddOptions,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Surgical search/replace of the first match (`note.edit`). `expectedVersion` is optional (§11.4-D). */
  edit(
    noteId: string,
    oldText: string,
    newText: string,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Inclusive line-range replace (`note.editLines`). `expectedVersion` is optional (§11.4-D). */
  editLines(
    noteId: string,
    start: number,
    end: number,
    content: string,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Delete a note (`note.delete`). `expectedVersion` is optional (§11.4-D). */
  delete(noteId: string, expectedVersion?: number): Promise<MutationResult>;
  /** Update a note's title/tags metadata (`note.updateMetadata`). `expectedVersion` is optional (§11.4-D). */
  updateMetadata(
    noteId: string,
    metadata: NoteMetadataPatch,
    expectedVersion?: number,
  ): Promise<MutationResult>;
}

/** Inline checkbox status vocabulary (`task.updateStatus` / `task.update`). */
export type TaskCheckboxStatus = "todo" | "in-progress" | "done";

/** Fields a `task.update` mutation may change on a single checkbox line. */
export interface TaskUpdatePatch {
  text?: string;
  status?: TaskCheckboxStatus;
  expected?: string;
}

/** Options for converting a note into a task note (`task.markAsTask`). */
export interface MarkAsTaskOptions {
  acceptanceCriteria?: string[] | string;
  effort?: string;
}

/** Options for creating a prerequisite task dependency (`task.createPrerequisite`). */
export interface CreatePrerequisiteOptions {
  content?: string;
  status?: string;
}

export interface TasksClient {
  /**
   * `task.list` (PROTOCOL §5.4) → `{ tasks, stats }`. `stats` is the workspace-wide
   * rollup the BE owns (excludes `cancelled`; `complete` counts toward `completed`;
   * `in_progress` + `review_required` count toward `inProgress`). The FE renders
   * `stats` verbatim and never re-derives task progress from `note.list`.
   */
  list(workspaceId: string): Promise<{ tasks: WorkspaceTask[]; stats: WorkspaceTaskStats }>;
  get(taskId: string): Promise<WorkspaceTask | null>;
  subscribe(handler: SubscriptionHandler<WorkspaceTask[]>): Unsubscribe;
  /** Toggle a single checkbox by its task text (`task.updateStatus`). `expectedVersion` is optional (§11.4-D). */
  updateStatus(
    noteId: string,
    taskText: string,
    status: TaskCheckboxStatus,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Edit a single checkbox line by 1-based line number (`task.update`). `expectedVersion` is optional (§11.4-D). */
  update(
    noteId: string,
    line: number,
    patch: TaskUpdatePatch,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Update a task note's metadata status (`task.updateNoteStatus`). `expectedVersion` is optional (§11.4-D). */
  updateNoteStatus(
    noteId: string,
    status: TaskStatus,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Convert a note into a task note (`task.markAsTask`). `expectedVersion` is optional (§11.4-D). */
  markAsTask(
    noteId: string,
    status: TaskStatus,
    options?: MarkAsTaskOptions,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  /** Assign an existing agent to a task note (`task.assignAgent`). `expectedVersion` is optional (§11.4-D). */
  assignAgent(noteId: string, agentId: string, expectedVersion?: number): Promise<MutationResult>;
  /** Create a prerequisite task dependency (`task.createPrerequisite`); carries an idempotencyKey. */
  createPrerequisite(
    dependentNoteId: string,
    title: string,
    options?: CreatePrerequisiteOptions,
  ): Promise<MutationResult>;
}

/** Parameters for creating a note-anchored comment (`comment.add`). */
export interface CommentAddParams {
  searchContext: string;
  commentTarget: string;
  comment: string;
  type?: CommentType;
  author?: string;
}

/** Parameters for replying to a thread or comment (`comment.respond`). */
export interface CommentRespondParams {
  threadId?: string;
  commentId?: string;
  comment: string;
  type?: CommentType;
  suggestionOriginal?: string;
  suggestionProposed?: string;
}

export interface CommentsClient {
  list(noteId: string): Promise<CommentV2[]>;
  subscribe(noteId: string, handler: SubscriptionHandler<CommentV2[]>): Unsubscribe;
  /** Create a note-anchored comment (`comment.add`); the live client attaches an idempotencyKey (§5.6). */
  add(noteId: string, params: CommentAddParams): Promise<MutationResult>;
  /** Reply to a thread or comment (`comment.respond`). */
  respond(noteId: string, params: CommentRespondParams): Promise<MutationResult>;
  /** Delete a comment (`comment.delete`). */
  delete(noteId: string, commentId: string): Promise<MutationResult>;
}

/** Wire input for `script.create` (PROTOCOL §5.8); `workspaceId` is passed separately. */
export interface ScriptCreateInput {
  name: string;
  command: string;
  mode: ScriptMode;
  cwd?: string;
  env?: Record<string, string>;
  category?: ScriptCategory;
  autoStart?: boolean;
  scriptId?: string;
}

/** `script.create` outcome — carries the daemon's created definition on success. */
export interface ScriptCreateResult extends MutationResult {
  script?: WorkspaceScript;
}

/** `script.run` result envelope (PROTOCOL §5.8). */
export interface ScriptRunResult {
  exitCode?: number;
  output: string;
  timedOut?: boolean;
  warning?: string;
}

export interface ScriptsClient {
  /** `script.list` — definitions with merged runtime state. */
  list(workspaceId: string): Promise<ScriptWithState[]>;
  /** `script.create` — register a definition; returns the stored record. */
  create(workspaceId: string, input: ScriptCreateInput): Promise<ScriptCreateResult>;
  /** `script.remove` — stop (if running) and forget a script. */
  remove(scriptId: string): Promise<MutationResult>;
  /** `script.start`. */
  start(scriptId: string): Promise<MutationResult>;
  /** `script.stop`. */
  stop(scriptId: string): Promise<MutationResult>;
  /** `script.restart`. */
  restart(scriptId: string): Promise<MutationResult>;
  /** `script.output` — historical output-buffer text. */
  output(scriptId: string, maxLines?: number): Promise<string>;
  /** `script.status` — the script's runtime state, or null when unavailable. */
  status(scriptId: string): Promise<ScriptRuntimeState | null>;
  /** `script.run` — run a command-mode script to completion. */
  run(
    scriptId: string,
    options?: { maxLines?: number; timeoutSeconds?: number },
  ): Promise<ScriptRunResult | null>;
  subscribe(handler: SubscriptionHandler<ScriptWithState[]>): Unsubscribe;
}

/** Wire `SetupScript` record (PROTOCOL §5.25) — the per-workspace worktree setup script. */
export interface WorkspaceSetupScript {
  script: string;
  projectType?: string | null;
  updatedAt: number;
  generatedBy?: "user" | "agent";
}

export interface SetupScriptsClient {
  list(): Promise<SetupScript[]>;
  subscribe(handler: SubscriptionHandler<SetupScript[]>): Unsubscribe;
  /** `workspace.getSetupScript` (§5.25). */
  get(workspaceId: string): Promise<WorkspaceSetupScript | null>;
  /** `workspace.saveSetupScript` (§5.25) — persists the body; returns the stored record. */
  save(workspaceId: string, script: string): Promise<WorkspaceSetupScript | null>;
  /** `workspace.detectProjectType` (§5.25) — null when no known manifest is found. */
  detectProjectType(workspaceId: string): Promise<string | null>;
  /** `workspace.generateSetupScript` (§5.25) — AI-assisted draft (not auto-saved). */
  generate(workspaceId: string): Promise<WorkspaceSetupScript | null>;
}

export interface SkillsClient {
  list(workspaceId: string): Promise<SkillInfo[]>;
  subscribe(handler: SubscriptionHandler<SkillInfo[]>): Unsubscribe;
}

/**
 * Wire `SpecialistDef` (`specialist.list`, PROTOCOL §5.11): the resolved view
 * of one definition. `source` is the winning tier (project > user > bundled)
 * and `path` the file it resolved from (omitted for `bundled`). The optional
 * frontmatter scalars (`codingAgent`/`model`/`modelTier`/`roleReminder`/
 * `agentType`) are carried through verbatim when present; `behaviorPrompt`
 * mirrors `prompt` (the markdown body).
 */
export interface SpecialistDef {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  modelTier?: string;
  roleReminder?: string;
  agentType?: string;
  prompt?: string;
  behaviorPrompt?: string;
  source: "project" | "user" | "bundled";
  isCustomized?: boolean;
  path?: string;
}

export interface SpecialistsClient {
  /** Merged bundled + user + project definitions (`specialist.list`, PROTOCOL §5.11). */
  list(): Promise<SpecialistDef[]>;
  subscribe(handler: SubscriptionHandler<SpecialistDef[]>): Unsubscribe;
}

export interface ModelsClient {
  list(): Promise<AuggieModel[]>;
  subscribe(handler: SubscriptionHandler<AuggieModel[]>): Unsubscribe;
}

export interface BrowserClient {
  recentUrls(workspaceId: string): Promise<RecentUrl[]>;
  subscribe(handler: SubscriptionHandler<RecentUrl[]>): Unsubscribe;
}

/**
 * GitHub-URL branch listing (`github.branches.list` + `github.repos.get`,
 * §5.27) for a repo the user has not cloned yet: remote branch names plus the
 * repo's default branch when the metadata read succeeds.
 */
export interface GitHubBranchListing {
  branches: string[];
  defaultBranch?: string;
}

export interface IntegrationsClient {
  githubUser(): Promise<GitHubUser | null>;
  /**
   * Remote branch names for a GitHub repo (`github.branches.list`, §5.27),
   * with the default branch from `github.repos.get` (best-effort). Unlike the
   * issue reads this THROWS on transport/daemon errors (e.g. "GitHub is not
   * configured.") so the workspace-initializer BranchSelector can render an
   * explicit error/auth state — never a fabricated branch list.
   */
  githubBranches(owner: string, repo: string): Promise<GitHubBranchListing>;
  linearIssues(): Promise<LinearIssueResult[]>;
  sentryIssues(): Promise<SentryIssueResult[]>;
  subscribe(handler: SubscriptionHandler<{ githubUser: GitHubUser | null }>): Unsubscribe;
}

export interface SystemClient {
  status(): Promise<SystemStatusState>;
  releaseNotes(): Promise<ReleaseNotes | null>;
  autoUpdate(): Promise<AutoUpdateState | null>;
  subscribe(handler: SubscriptionHandler<SystemStatusState>): Unsubscribe;
}

/** Filter options for `event.query` (PROTOCOL §5.10); all optional. */
export interface EventQueryOptions {
  eventType?: string;
  actorType?: string;
  actorId?: string;
  path?: string;
  minutesAgo?: number;
  limit?: number;
}

export interface EventsClient {
  /** Boot snapshot of the workspace event stream, oldest→newest. */
  list(workspaceId: string): Promise<WorkspaceEvent[]>;
  /**
   * Historical `event.query` read (PROTOCOL §5.10). Returns matching events in
   * wire order (newest→oldest); the daemon defaults `limit` to 50.
   */
  query(workspaceId: string, options?: EventQueryOptions): Promise<WorkspaceEvent[]>;
  subscribe(workspaceId: string, handler: SubscriptionHandler<WorkspaceEvent[]>): Unsubscribe;
}

/** The aggregate seam exposing every backend domain to the renderer. */
export interface AppClient {
  workspaces: WorkspacesClient;
  agents: AgentsClient;
  chat: ChatClient;
  terminals: TerminalsClient;
  settings: SettingsClient;
  files: FilesClient;
  git: GitClient;
  notes: NotesClient;
  tasks: TasksClient;
  comments: CommentsClient;
  scripts: ScriptsClient;
  setupScripts: SetupScriptsClient;
  skills: SkillsClient;
  specialists: SpecialistsClient;
  models: ModelsClient;
  browser: BrowserClient;
  integrations: IntegrationsClient;
  system: SystemClient;
  events: EventsClient;
}
