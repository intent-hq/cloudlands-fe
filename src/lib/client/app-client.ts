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
  AgentSession,
  ContentBlock,
  CreateNoteRequest,
  CreateWorkspaceRequest,
  DiffChunk,
  FileGitStatus,
  FileNode,
  GitStatus,
  Note,
  TaskStatus,
  Workspace,
  WorkspaceTask,
} from "$shared/types";
import type { CommitInfo, TrackedChange } from "$features/file-tracking/types";
import type { WorkspaceEvent } from "$features/events/types";
import type { TerminalTab } from "$store/renderer/slices/terminals/terminals-slice";
import type { ScriptWithState } from "$store/renderer/slices/scripts/scripts-types";
import type { SetupScript } from "$store/renderer/slices/setup-scripts/setup-scripts-types";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import type {
  CustomSpecialist,
  FileSpecialist,
} from "$store/renderer/slices/specialists/specialists-slice";
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
}

/** Minimal request shape for creating an agent through the seam. */
export interface AgentCreateRequest {
  workspaceId: string;
  prompt?: string;
  model?: string;
  specialist?: string | null;
}

/** Pull-request summary surfaced by the git domain. */
export interface PrStatusSummary {
  prNumber?: number;
  url?: string;
  state?: string;
}

export interface WorkspacesClient {
  list(): Promise<Workspace[]>;
  get(id: string): Promise<Workspace | null>;
  create(request: CreateWorkspaceRequest): Promise<MutationResult>;
  delete(id: string): Promise<MutationResult>;
  setActive(id: string): Promise<MutationResult>;
  recentViews(): Promise<Record<string, number>>;
  subscribe(handler: SubscriptionHandler<Workspace[]>): Unsubscribe;
}

export interface AgentsClient {
  list(workspaceId: string): Promise<AgentSession[]>;
  get(agentId: string): Promise<AgentSession | null>;
  create(request: AgentCreateRequest): Promise<MutationResult>;
  send(agentId: string, message: string): Promise<MutationResult>;
  queue(agentId: string, message: string): Promise<MutationResult>;
  setAvailability(agentId: string, available: boolean): Promise<MutationResult>;
  follow(agentId: string, follow: boolean): Promise<MutationResult>;
  lock(agentId: string, locked: boolean): Promise<MutationResult>;
  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe;
}

export interface ChatClient {
  history(agentId: string): Promise<ContentBlock[]>;
  tokenUsage(agentId: string): Promise<{ input: number; output: number }>;
  subscribe(agentId: string, handler: SubscriptionHandler<ContentBlock[]>): Unsubscribe;
}

export interface TerminalsClient {
  list(workspaceId: string): Promise<TerminalTab[]>;
  create(workspaceId: string): Promise<MutationResult>;
  write(terminalId: string, data: string): Promise<MutationResult>;
  output(terminalId: string): Promise<string>;
  subscribe(handler: SubscriptionHandler<TerminalTab[]>): Unsubscribe;
}

export interface SettingsClient {
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

export interface GitClient {
  status(workspaceId: string): Promise<GitStatus | null>;
  changes(workspaceId: string): Promise<GitStatus | null>;
  diffs(workspaceId: string): Promise<DiffChunk[]>;
  trackedChanges(workspaceId: string): Promise<TrackedChange[]>;
  commits(workspaceId: string): Promise<CommitInfo[]>;
  prStatus(workspaceId: string): Promise<PrStatusSummary | null>;
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
  list(workspaceId: string): Promise<WorkspaceTask[]>;
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

export interface ScriptsClient {
  list(workspaceId: string): Promise<ScriptWithState[]>;
  subscribe(handler: SubscriptionHandler<ScriptWithState[]>): Unsubscribe;
}

export interface SetupScriptsClient {
  list(): Promise<SetupScript[]>;
  subscribe(handler: SubscriptionHandler<SetupScript[]>): Unsubscribe;
}

export interface SkillsClient {
  list(workspaceId: string): Promise<SkillInfo[]>;
  subscribe(handler: SubscriptionHandler<SkillInfo[]>): Unsubscribe;
}

export interface SpecialistsClient {
  listCustom(): Promise<CustomSpecialist[]>;
  listFile(): Promise<FileSpecialist[]>;
  subscribe(handler: SubscriptionHandler<CustomSpecialist[]>): Unsubscribe;
}

export interface ModelsClient {
  list(): Promise<AuggieModel[]>;
  subscribe(handler: SubscriptionHandler<AuggieModel[]>): Unsubscribe;
}

export interface BrowserClient {
  recentUrls(workspaceId: string): Promise<RecentUrl[]>;
  subscribe(handler: SubscriptionHandler<RecentUrl[]>): Unsubscribe;
}

export interface IntegrationsClient {
  githubUser(): Promise<GitHubUser | null>;
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

export interface EventsClient {
  list(workspaceId: string): Promise<WorkspaceEvent[]>;
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
