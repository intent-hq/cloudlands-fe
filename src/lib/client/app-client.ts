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
  CreateWorkspaceRequest,
  GitStatus,
  Note,
  Workspace,
  WorkspaceTask,
} from "$shared/types";
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
import type { FileContentEntry } from "$store/renderer/slices/files/files-types";

/** Disposer returned by every `subscribe()` call. */
export type Unsubscribe = () => void;

/** Reactive subscription callback invoked with the latest snapshot. */
export type SubscriptionHandler<T> = (snapshot: T) => void;

/** Uniform result for mutation methods. */
export interface MutationResult {
  success: boolean;
  error?: string;
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
  explorerTree(workspaceId: string): Promise<string[]>;
  subscribe(handler: SubscriptionHandler<FileContentEntry[]>): Unsubscribe;
}

export interface GitClient {
  status(workspaceId: string): Promise<GitStatus | null>;
  changes(workspaceId: string): Promise<GitStatus | null>;
  prStatus(workspaceId: string): Promise<PrStatusSummary | null>;
  subscribe(handler: SubscriptionHandler<GitStatus | null>): Unsubscribe;
}

export interface NotesClient {
  list(workspaceId: string): Promise<Note[]>;
  get(noteId: string): Promise<Note | null>;
  subscribe(handler: SubscriptionHandler<Note[]>): Unsubscribe;
}

export interface TasksClient {
  list(workspaceId: string): Promise<WorkspaceTask[]>;
  get(taskId: string): Promise<WorkspaceTask | null>;
  subscribe(handler: SubscriptionHandler<WorkspaceTask[]>): Unsubscribe;
}

export interface CommentsClient {
  list(noteId: string): Promise<CommentV2[]>;
  subscribe(noteId: string, handler: SubscriptionHandler<CommentV2[]>): Unsubscribe;
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
