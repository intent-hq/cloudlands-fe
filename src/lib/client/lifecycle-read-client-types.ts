import type { CommitHistoryPageOptions } from './commit-history-types';
// Canonical read contracts shared by renderer bindings; no transport or Store dependency.
import type {
  AgentDelegatedCounts,
  AgentListScope,
  AgentScopeCounts,
  AgentSession,
  GitStatus,
  PullRequestStatus,
  PullRequestInfo,
  WorkspaceTask,
  WorkspaceTaskStats,
} from '../../shared/types';
import type { CommitInfo, TrackedChange } from '../../features/file-tracking/types';
import type { WorkspaceEvent } from '../../features/events/types';
import type { ScriptArchiveFilter } from '../../features/scripts/types';
import type { ScriptWithState } from '../../store/renderer/slices/scripts/scripts-types';
import type { SkillInfo } from '../../store/renderer/slices/skills/skills-types';
import type { TerminalTab } from '../../store/renderer/slices/terminals/terminals-slice';
import type { TaskAgentAssociationsByTaskKey } from '../../store/renderer/slices/task-agent-associations/task-agent-associations-types';
import type { WorkspacesClient } from './workspaces-client-types';

/**
 * Post-refresh linkage state returned by `pr.refresh` (PROTOCOL §5.7
 * extension). `prNumber`/`prUrl`/`prStatus` are absent when no PR is linked
 * after the refresh; `pullRequests` is always an array (possibly empty) —
 * the daemon-owned per-branch PR list.
 */
export interface PrRefreshResult {
  outcome: 'skipped' | 'unchanged' | 'linked' | 'updated' | 'unlinked';
  prNumber?: number;
  prUrl?: string;
  prStatus?: PullRequestStatus;
  pullRequests: PullRequestInfo[];
}

/**
 * `agent.list` read options (§5.5). `retiredOnly` and a bin `scope` are
 * mutually exclusive daemon-side (retired sessions are their own bin).
 */
export interface AgentListOptions {
  retiredOnly?: boolean;
  /** Row scope (intent-hq/intent#5383): one bin of the non-retired sessions; `all` / absent is the default read. */
  scope?: AgentListScope;
  /**
   * Narrows a `scope: "delegated"` read to that parent's DIRECT sub-agents
   * (§5.5; the daemon rejects it with any other scope).
   */
  parentAgentId?: string;
  /**
   * Narrows a `scope: "delegated"` read to the ORPHANED delegated rows —
   * those whose parent is no longer a non-retired session of the workspace
   * (§5.5; the daemon rejects it with any other scope or alongside
   * `parentAgentId`). Older daemons ignore it, so callers gate on
   * `delegatedCounts.orphaned` presence.
   */
  orphanedOnly?: boolean;
}

export interface AgentListResult {
  agents: AgentSession[];
  retiredCount: number;
  /**
   * Per-bin counts (`scopeCounts`, §5.5 row scope) — present only when the
   * daemon serves them. An older daemon ignores `scope` and answers the
   * default (all-rows) read without this field.
   */
  scopeCounts?: AgentScopeCounts;
  /**
   * Per-parent delegated counts (`delegatedCounts`, §5.5) — present only when
   * the daemon serves them; workspace-wide even on a narrowed read.
   */
  delegatedCounts?: AgentDelegatedCounts;
}

/**
 * `terminal.list` result envelope (PROTOCOL §5.13). `daemonBootId` identifies
 * the daemon boot that produced the snapshot, letting the store distinguish an
 * authoritative same-boot empty list (every PTY genuinely gone — converge to
 * zero tabs) from a post-restart empty (PTYs respawn via auto-reconnect —
 * preserve tabs). Absent when a legacy pre-envelope daemon returned a bare
 * array.
 */
export interface TerminalListResult {
  terminals: TerminalTab[];
  daemonBootId?: string;
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

/** Cursor options for the opt-in paginated `event.query` envelope. */
export interface EventQueryPageOptions extends EventQueryOptions {
  nextToken?: string;
}

/** One newest→oldest page returned by paginated `event.query`. */
export interface EventQueryPage {
  items: WorkspaceEvent[];
  nextToken: string | null;
}

export interface AgentsReadClient {
  /**
   * Agents of one workspace (`agent.list`, §5.5). Soft-retired sessions
   * (`retiredAt` set) are excluded from the default read daemon-side;
   * `options.retiredOnly: true` serves ONLY retired rows, each
   * carrying the presence-detected `retiredAt` ISO timestamp. `options.scope`
   * narrows the read to one bin of the non-retired sessions (§5.5 row scope).
   * Flags only ride the wire when supplied so the default read carries none.
   */
  list(workspaceId: string, options?: AgentListOptions): Promise<AgentSession[]>;
  /**
   * Same read as `list` plus response metadata: `retiredCount` (§5.5 soft retire) is the
   * number of soft-retired sessions in the workspace, served on every
   * `agent.list` variant (defaults to 0 if the field is absent); `scopeCounts`
   * is the per-bin count triple, absent on daemons predating `scope`.
   */
  listWithMeta(workspaceId: string, options?: AgentListOptions): Promise<AgentListResult>;
}

export interface TasksReadClient {
  /**
   * `task.list` (PROTOCOL §5.4) → `{ tasks, stats }`. `stats` is the workspace-wide
   * rollup the BE owns (excludes `cancelled`; `complete` counts toward `completed`;
   * `in_progress` + `review_required` count toward `inProgress`). The FE renders
   * `stats` verbatim and never re-derives task progress from `note.list`.
   */
  list(workspaceId: string): Promise<{ tasks: WorkspaceTask[]; stats: WorkspaceTaskStats }>;
  /**
   * `task.listAgentLinks` (PROTOCOL §5.4): daemon-owned `byNoteId → byTaskKey`
   * map answering "which agent is working on this checkbox?". Returns the map
   * already grouped so the FE can dispatch it straight into
   * `hydrateTaskAgentAssociations`. `task:agent-linked` /
   * `task:agent-unlinked` events (§6.5) drive incremental updates.
   */
  listAgentLinks(workspaceId: string): Promise<Record<string, TaskAgentAssociationsByTaskKey>>;
}

export interface EventsReadClient {
  /** Paginated historical read; `nextToken` continues toward older events. */
  queryPage(workspaceId: string, options?: EventQueryPageOptions): Promise<EventQueryPage>;
}

export interface GitReadClient {
  /** `forceRefresh` bypasses client and daemon status caches for post-mutation reconciliation. */
  status(workspaceId: string, options?: { forceRefresh?: boolean }): Promise<GitStatus | null>;
  /** Returns `null` when the tracked-change read fails; an empty array is a successful empty result. */
  trackedChanges(workspaceId: string): Promise<TrackedChange[] | null>;
  /**
   * `file-tracking.loadCommits` with full envelope — returns commits, boundarySha, and nextToken.
   * The `boundarySha` is the workspace boundary commit SHA or null when no boundary exists.
   * When `includeOlder` is true, walks backward from the workspace boundary (inclusive).
   * Explicit pagination options select strict reads; errors/malformed envelopes reject.
   * Callers without options retain the legacy best-effort response contract.
   */
  commitsWithBoundary(
    workspaceId: string,
    includeOlder?: boolean,
    options?: Omit<CommitHistoryPageOptions, 'includeOlder'>,
  ): Promise<{ commits: CommitInfo[]; boundarySha: string | null; nextToken: string | null }>;
  /**
   * `pr.refresh` (§5.7) — forces the daemon's PR discovery/refresh (link,
   * relink-after-merge, stale-link clearing) for one workspace on demand and
   * returns the post-refresh linkage state. An active PR is not required.
   * Automatic callers opt into daemon idle admission; omitted options preserve
   * explicit refresh semantics. Errors fold to `null`.
   */
  prRefresh(workspaceId: string, options?: { automatic: boolean }): Promise<PrRefreshResult | null>;
}

export interface ScriptsReadClient {
  supportsLifecycle?(): Promise<boolean>;
  /** `script.list` — definitions with merged runtime state. */
  list(
    workspaceId: string,
    options?: { archive?: ScriptArchiveFilter },
  ): Promise<ScriptWithState[]>;
}

export interface SkillsReadClient {
  list(workspaceId: string): Promise<SkillInfo[]>;
}

export interface TerminalsReadClient {
  list(workspaceId: string): Promise<TerminalListResult>;
}

/** §5.20 `Metrics` — workspace-level stats include `byAgent`; per-agent stats omit it. */
export interface Metrics {
  additions: number;
  deletions: number;
  filesChanged: number;
  byAgent?: Record<string, { additions: number; deletions: number; filesChanged: number }>;
}

export interface LifecycleReadClient {
  workspaces: Pick<WorkspacesClient, 'getTokenUsage' | 'getContext'>;
  agents: AgentsReadClient;
  tasks: TasksReadClient;
  events: EventsReadClient;
  git: GitReadClient;
  scripts: ScriptsReadClient;
  skills: SkillsReadClient;
  terminals: TerminalsReadClient;
}
