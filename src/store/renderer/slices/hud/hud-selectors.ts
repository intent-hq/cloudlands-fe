/**
 * Fleet HUD Selectors
 *
 * Reads over the hud slice plus HUD-shaped rollups derived from the canonical
 * workspace slice (`workspace.list` aggregates: `displayStatus`,
 * `agentSummary`, `taskStats` — PROTOCOL §5.1). The hud slice's live
 * `displayStatusByWorkspaceId` overrides win over the entity's enrichment
 * value so `workspace:displayStatus-changed` transitions render without a
 * refetch.
 */

import { store } from '../../store';
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoreState } from '../../types';
import type { HudFeedEntry } from './hud-slice';
import {
  WORKSPACE_DISPLAY_STATUS_VALUES,
  WorkspaceStatus,
  type WorkspaceDisplayStatus,
  type Workspace,
  type WorkspaceAgentInfo,
  type WorkspaceId,
} from '$shared/types';
import type { HudAgentStateBucket, HudCardStateKey } from './hud-types';
import { HUD_AGENT_STATE_BUCKETS, toHudAgentStateBucket } from './hud-types';
import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
} from '../agent-session/agent-session-selectors';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { getWorkspaceGroupingStatus } from '$lib/components/workspace/utils/workspace-status-grouping';

export const selectHudActive = store.createSelector((state) => state.hud.active);

export const selectHudFeed = store.createSelector((state) => state.hud.feed);

export const selectHudUsage = store.createSelector((state) => state.hud.usage);

export const selectHudUsageError = store.createSelector((state) => state.hud.usageError);

export const selectHudRateHistory = store.createSelector((state) => state.hud.rateHistory);

export const selectHudSystem = store.createSelector((state) => state.hud.system);

/** Live 5s token buckets for the AGENT ACTIVITY · TOK/S chart. */
export const selectHudRate5s = store.createSelector((state) => state.hud.rate5s);

/** Header FLEET OPS repo + status filter (shared with the center grid). */
export const selectHudGridFilter = store.createSelector((state) => state.hud.gridFilter);

export const selectHudAttentionByWorkspaceId = store.createSelector(
  (state) => state.hud.attentionByWorkspaceId,
);

/** Pending grid-card click for the takeover overlay; null when none. */
export const selectHudTakeoverRequestWorkspaceId = store.createSelector(
  (state) => state.hud.takeoverRequestWorkspaceId,
);

/**
 * Effective display status for a workspace: the live event override when one
 * arrived, else the entity's `workspace.list` enrichment value.
 */
function effectiveDisplayStatus(
  workspace: Workspace,
  overrides: Record<string, WorkspaceDisplayStatus>,
): WorkspaceDisplayStatus | undefined {
  return overrides[String(workspace.id)] ?? workspace.displayStatus;
}

/** Non-archived workspaces the HUD renders, with live displayStatus applied. */
export const selectHudWorkspaces = store.createSelector((state): Workspace[] => {
  const overrides = state.hud.displayStatusByWorkspaceId;
  return getItems(state.workspace.workspaces)
    .filter(
      (workspace) =>
        workspace.status !== WorkspaceStatus.Archived &&
        workspace.status !== WorkspaceStatus.Deleted,
    )
    .map((workspace) => {
      const displayStatus = effectiveDisplayStatus(workspace, overrides);
      return displayStatus && displayStatus !== workspace.displayStatus
        ? { ...workspace, displayStatus }
        : workspace;
    });
});

/** WORKSPACES panel state bars: count per displayStatus wire value. */
export const selectHudWorkspaceStateCounts = store.createSelector(
  (state): Record<WorkspaceDisplayStatus, number> => {
    const counts = Object.fromEntries(
      WORKSPACE_DISPLAY_STATUS_VALUES.map((value) => [value, 0]),
    ) as Record<WorkspaceDisplayStatus, number>;
    for (const workspace of selectHudWorkspaces.select(state)) {
      const status = workspace.displayStatus;
      if (status) counts[status] += 1;
    }
    return counts;
  },
);

/**
 * The `agentSummary` aggregate is typed as the slim `WorkspaceAgentIdSummary`
 * on the FE `Workspace`, but the daemon emits the richer
 * `{ count, agents, agentIds }` form (PROTOCOL §5.1) and `normalizeWorkspace`
 * spreads it through verbatim. Read `agents` structurally when present.
 */
function agentInfosOf(workspace: Workspace): WorkspaceAgentInfo[] {
  const summary = workspace.agentSummary as { agents?: unknown; agentIds?: string[] } | undefined;
  if (!summary || !Array.isArray(summary.agents)) return [];
  return summary.agents.filter(
    (agent): agent is WorkspaceAgentInfo =>
      !!agent && typeof agent === 'object' && typeof (agent as { id?: unknown }).id === 'string',
  );
}

/**
 * AGENTS panel state bars: bucketed counts across all HUD workspaces, using
 * the same live-session-first bucketing as the card agent rows
 * (`liveAgentBucket`) so the header RUN/IDLE counters agree with the grid.
 */
export const selectHudAgentStateCounts = store.createSelector(
  (state): Record<HudAgentStateBucket, number> => {
    const counts = Object.fromEntries(
      HUD_AGENT_STATE_BUCKETS.map((bucket) => [bucket, 0]),
    ) as Record<HudAgentStateBucket, number>;
    for (const workspace of selectHudWorkspaces.select(state)) {
      for (const agent of agentInfosOf(workspace)) {
        counts[liveAgentBucket(state, agent.id, agent.status)] += 1;
      }
    }
    return counts;
  },
);

/** WORKSPACES BY STATE panel buckets (mock's five bars). */
export interface HudWorkspaceStateBars {
  /** `in_progress` + `complete` (mock: PROGRESS). */
  progress: number;
  /** `pr_open` + `pr_ready` (mock: PR OPEN). */
  prOpen: number;
  /** `pr_merged`. */
  prMerged: number;
  /** Workspaces whose live attention flag is raised (mock: ATTENTION). */
  attention: number;
  /** Everything else (`not_started` / no displayStatus). */
  idle: number;
  /** All HUD workspaces (bar denominators). */
  total: number;
}

/**
 * WORKSPACES panel state bars, bucketed like the mock's `wsCounts` — derived
 * from the card `stateKey` (the sidebar-agreeing grouping derivation plus the
 * HUD attention overlays) so the rollup always agrees with the center grid:
 * the attention states (`wait`/`blocked`/`failed`) bucket as ATTENTION,
 * in_progress/complete as PROGRESS, PR states as PR OPEN / PR MERGED, and
 * everything else (`idle`/`not_started`) as IDLE.
 */
export const selectHudWorkspaceStateBars = store.createSelector((state): HudWorkspaceStateBars => {
  const bars: HudWorkspaceStateBars = {
    progress: 0,
    prOpen: 0,
    prMerged: 0,
    attention: 0,
    idle: 0,
    total: 0,
  };
  for (const card of selectHudWorkspaceCards.select(state)) {
    bars.total += 1;
    switch (card.stateKey) {
      case 'wait':
      case 'blocked':
      case 'failed':
        bars.attention += 1;
        break;
      case 'in_progress':
      case 'complete':
        bars.progress += 1;
        break;
      case 'pr_open':
      case 'pr_ready':
        bars.prOpen += 1;
        break;
      case 'pr_merged':
        bars.prMerged += 1;
        break;
      default:
        bars.idle += 1;
    }
  }
  return bars;
});

/** Discriminates what raised an ATTENTION panel row. */
export type HudAttentionKind = 'agent_waiting' | 'agent_failed' | 'workspace_attention';

/** One ATTENTION panel row. */
export interface HudAttentionItem {
  workspaceId: string;
  workspaceTitle: string;
  kind: HudAttentionKind;
  /** Wire attention value (`"unread" | "review_required" | ...`); only for `workspace_attention`. */
  attention?: string;
  /** Raising agent's display name (wire identifier); only for agent rows. */
  agentName?: string;
  /**
   * Detail line under the row (mock `q.msg`) — the captured question text for
   * waiting agents when one is known (agent content; i18n-exempt); null else.
   */
  message: string | null;
  /** ISO timestamp the item became active (drives the elapsed timer); null when unknown. */
  sinceTs: string | null;
}

/**
 * agentId → display name across all HUD workspaces' `agentSummary.agents`
 * (PROTOCOL §5.1). The join point for "never show raw agent UUIDs".
 */
export const selectHudAgentNamesById = store.createSelector(
  (state): Record<string, string> => {
    const names: Record<string, string> = {};
    for (const workspace of selectHudWorkspaces.select(state)) {
      for (const agent of agentInfosOf(workspace)) {
        if (typeof agent.name === 'string' && agent.name.length > 0) names[agent.id] = agent.name;
      }
    }
    return names;
  },
);

function sinceMs(item: HudAttentionItem): number {
  if (!item.sinceTs) return 0;
  const ms = Date.parse(item.sinceTs);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * ATTENTION panel rows, newest first: agents in the waiting/failed buckets
 * (from `agentSummary.agents`, PROTOCOL §5.1) plus workspaces whose live
 * `workspace:attention-changed` flag is raised (the FE `Workspace` entity
 * carries no `attention` field — the hud slice mirrors the event stream).
 * Rows for workspaces no longer in the list are dropped.
 */
export const selectHudAttentionItems = store.createSelector((state): HudAttentionItem[] => {
  const flags = state.hud.attentionByWorkspaceId;
  const questions = state.hud.questionsByAgentId;
  const items: HudAttentionItem[] = [];
  for (const workspace of selectHudWorkspaces.select(state)) {
    const workspaceId = String(workspace.id);
    for (const agent of agentInfosOf(workspace)) {
      const bucket = toHudAgentStateBucket(agent.status);
      if (bucket !== 'waiting' && bucket !== 'failed') continue;
      // Question text: the agent's captured §7.1 question block, waiting rows only.
      const question = bucket === 'waiting' ? questions[agent.id] : undefined;
      items.push({
        workspaceId,
        workspaceTitle: workspace.title,
        kind: bucket === 'waiting' ? 'agent_waiting' : 'agent_failed',
        agentName: agent.name,
        message: question?.question ?? null,
        sinceTs: agent.lastActivity ?? null,
      });
    }
    const flag = flags[workspaceId];
    if (flag) {
      items.push({
        workspaceId,
        workspaceTitle: workspace.title,
        kind: 'workspace_attention',
        attention: flag.attention,
        message: null,
        sinceTs: flag.raisedAtTs,
      });
    }
  }
  return items.sort((a, b) => sinceMs(b) - sinceMs(a));
});

/** One FEED panel row: the feed entry joined with its workspace title. */
export interface HudFeedItem extends HudFeedEntry {
  /** Display title of the source workspace; null when it left the list. */
  workspaceTitle: string | null;
  /**
   * Resolved agent display name for agent rows — the entry's wire `agentName`
   * or the agentSummary lookup; null when unresolvable (the row omits the
   * name — never the raw UUID).
   */
  resolvedAgentName: string | null;
}

/** FEED panel rows (newest first) with workspace titles and agent names resolved. */
export const selectHudFeedItems = store.createSelector((state): HudFeedItem[] => {
  const names = selectHudAgentNamesById.select(state);
  return state.hud.feed.map((entry) => ({
    ...entry,
    workspaceTitle: getItem(state.workspace.workspaces, entry.source as WorkspaceId)?.title ?? null,
    resolvedAgentName:
      entry.agentName ?? (entry.agentId ? (names[entry.agentId] ?? null) : null),
  }));
});

/** One live agent row on a workspace card. */
export interface HudCardAgent {
  id: string;
  /** Agent display name (wire identifier; i18n-exempt). */
  name: string;
  bucket: HudAgentStateBucket;
  /** ISO timestamp of the agent's last activity (drives the elapsed timer). */
  lastActivityTs: string | null;
  /**
   * Latest activity line for the swap animation — the session's
   * `lastAgentResponse` summary when the agent-session slice has it (wire/agent
   * content; i18n-exempt), else null. Sourced from the persisted AgentLite
   * projection (`agent.list`, §5.5) folded in by the HUD's per-workspace
   * hydration, and kept fresh by live status events
   * (`agent:status-changed` → `lastResponseSummary`).
   */
  line: string | null;
  /** Delegating agent's id (`parentAgentId`, PROTOCOL §5.1 v2.9); null on roots. */
  parentAgentId: string | null;
  /** Delegation-tree depth (0 for roots; wire flat order when no parentage). */
  depth: number;
  /**
   * Tree connector glyphs rendered before the row (mock's `pre`: `├─`/`└─`
   * with a `│ ` rail at depth ≥ 2); empty for roots / flat fallback.
   */
  treePrefix: string;
  /**
   * True for delegation-tree roots: no summary `parentAgentId` (§5.1 v2.9)
   * and no session `metadata.createdByAgentId` fallback (§5.5). Gates the
   * workspace-level NEEDS INPUT / BLOCKED derivation.
   */
  topLevel: boolean;
  /** Background agent (session `isBackground` / `metadata.isBackground`, §5.5). */
  isBackground: boolean;
  /**
   * Pending attention request kind (PROTOCOL §5.5 `attentionRequestKind`,
   * via the agent-session slice); null when none is pending or untracked.
   */
  attentionKind: 'discussion' | 'blocker' | null;
  /**
   * A §7.1 captured question is outstanding: the hud slice holds one for the
   * agent and the agent is not running/done (waiting or idle bucket).
   */
  hasQuestion: boolean;
}

/** View-model for one workspace card in the HUD center grid. */
export interface HudWorkspaceCard {
  workspaceId: string;
  /** Workspace display title (user content; i18n-exempt). */
  title: string;
  /** `owner/repo` line, or the branch when no repository is known. */
  repoRef: string;
  /** Card state key driving the label/color/animation (mock `wsMeta`). */
  stateKey: HudCardStateKey;
  /** Raised live attention value, null when none. */
  attention: string | null;
  /** Workspace status message (agent content; i18n-exempt), null when empty. */
  statusMessage: string | null;
  prNumber: number | null;
  /** BE-owned task rollup (`task.list` stats; zeros until loaded). */
  tasks: { total: number; completed: number; inProgress: number };
  /** Sum of the four token counters from the workspace usage rollup. */
  tokens: number;
  /** Live agents only (running / waiting / failed buckets), wire order. */
  agents: HudCardAgent[];
}

const ZERO_TASKS = { total: 0, completed: 0, inProgress: 0 };

/**
 * Card state key precedence: a failed live agent wins, then `blocked` /
 * `wait` from the pending attention signals, then the sidebar-agreeing
 * grouping status (`getWorkspaceGroupingStatus`, the same util
 * `AllWorkspacesCard` groups with): running workspaces
 * (`workspace.activity === 'agent_running'` or any running-bucket card
 * agent — the HUD's live agent-session join stands in for the sidebar's
 * streaming tracker) are always `in_progress`; otherwise a BE-sent
 * `displayStatus` renders VERBATIM (`idle` is a wire value since
 * intentd#793 — the daemon owns the idle/in_progress split), and only the
 * absent-displayStatus fallback demotes not-running
 * `in_progress`/`not_started` to `idle`; PR states and `complete` keep
 * their status.
 *
 * The agent-driven states are gated on TOP-LEVEL (delegation-tree root),
 * NON-BACKGROUND agents only — a child or background agent raising a blocker
 * / discussion / question never flips the workspace banner (its row and the
 * attention feed still show it). `blocked` (red) = a pending `blocker`
 * attention request (§5.5); `wait` (NEEDS INPUT, orange) = a pending
 * `discussion` request or an outstanding §7.1 question. The workspace-level
 * live attention flag (`workspace:attention-changed`) keeps raising `wait` —
 * it is a workspace signal, not an agent one.
 */
function cardStateKey(
  workspace: Workspace,
  attention: string | null,
  agents: HudCardAgent[],
): HudCardStateKey {
  if (agents.some((agent) => agent.bucket === 'failed')) return 'failed';
  const gated = agents.filter((agent) => agent.topLevel && !agent.isBackground);
  if (gated.some((agent) => agent.attentionKind === 'blocker')) return 'blocked';
  if (
    attention ||
    gated.some((agent) => agent.attentionKind === 'discussion' || agent.hasQuestion)
  ) {
    return 'wait';
  }
  const runningAgentIds = agents
    .filter((agent) => agent.bucket === 'running')
    .map((agent) => agent.id);
  return getWorkspaceGroupingStatus(
    workspace,
    workspace.displayStatus ?? 'not_started',
    runningAgentIds,
  );
}

const LIVE_BUCKETS: ReadonlySet<HudAgentStateBucket> = new Set(['running', 'waiting', 'failed']);

/**
 * Depth-first delegation-tree order over the summary agents: roots in wire
 * order, each followed by its children (`parentAgentId`, PROTOCOL §5.1 v2.9).
 * Agents with no / unknown / self parent are roots (flat fallback when
 * parentage is absent); parent cycles degrade to flat roots via the seen
 * guard.
 */
function orderAgentTree(
  infos: WorkspaceAgentInfo[],
): Array<{ info: WorkspaceAgentInfo; depth: number; parentAgentId: string | null }> {
  const ids = new Set(infos.map((info) => info.id));
  const childrenByParent = new Map<string, WorkspaceAgentInfo[]>();
  const roots: WorkspaceAgentInfo[] = [];
  for (const info of infos) {
    const parent =
      typeof info.parentAgentId === 'string' &&
      info.parentAgentId !== info.id &&
      ids.has(info.parentAgentId)
        ? info.parentAgentId
        : null;
    if (parent) {
      const siblings = childrenByParent.get(parent) ?? [];
      siblings.push(info);
      childrenByParent.set(parent, siblings);
    } else {
      roots.push(info);
    }
  }
  const ordered: Array<{ info: WorkspaceAgentInfo; depth: number; parentAgentId: string | null }> =
    [];
  const seen = new Set<string>();
  const visit = (info: WorkspaceAgentInfo, depth: number, parentAgentId: string | null) => {
    if (seen.has(info.id)) return;
    seen.add(info.id);
    ordered.push({ info, depth, parentAgentId });
    for (const child of childrenByParent.get(info.id) ?? []) visit(child, depth + 1, info.id);
  };
  for (const root of roots) visit(root, 0, null);
  for (const info of infos) visit(info, 0, null); // unreached (cycle) leftovers, flat
  return ordered;
}

/**
 * State bucket for a card agent: the live agent-session slice wins when it
 * tracks the agent (the daemon-events-bridge folds `agent:status-changed`
 * live, while the workspace entity's `agentSummary` only refreshes with the
 * next workspace snapshot), else the summary's wire status. Waiting is
 * checked before responding, mirroring `WorkspaceAgentsList`.
 */
function liveAgentBucket(
  state: StoreState,
  agentId: string,
  summaryStatus: string,
): HudAgentStateBucket {
  const session = state.agentSessions?.byAgentId[agentId];
  if (!session) return toHudAgentStateBucket(summaryStatus);
  if (selectAgentIsWaiting.select(state, agentId)) return 'waiting';
  if (selectAgentIsResponding.select(state, agentId)) return 'running';
  return toHudAgentStateBucket(typeof session.status === 'string' ? session.status : summaryStatus);
}

/**
 * Top-level check for the workspace-state gating: the summary's
 * `parentAgentId` (§5.1 v2.9) when present, else the tracked session's
 * `metadata.createdByAgentId` (§5.5) — no parent reference anywhere = root.
 * Unlike the tree ordering, a dangling parent still marks the agent as a
 * child (delegated agents must not flip the workspace banner even when
 * their parent left the summary).
 */
function isTopLevelAgent(
  info: WorkspaceAgentInfo,
  metadata: Record<string, unknown>,
): boolean {
  if (typeof info.parentAgentId === 'string' && info.parentAgentId !== info.id) return false;
  const createdBy = metadata.createdByAgentId;
  return !(typeof createdBy === 'string' && createdBy.length > 0 && createdBy !== info.id);
}

/** Tree-ordered card agent rows for a workspace (prefixes empty until kept). */
function cardAgentsOf(workspace: Workspace, state: StoreState): HudCardAgent[] {
  const questions = state.hud.questionsByAgentId;
  return orderAgentTree(agentInfosOf(workspace)).map(({ info, depth, parentAgentId }) => {
    const session = state.agentSessions?.byAgentId[info.id];
    const metadata = (session?.metadata ?? {}) as Record<string, unknown>;
    const bucket = liveAgentBucket(state, info.id, info.status);
    return {
      id: info.id,
      name: info.name,
      bucket,
      lastActivityTs: info.lastActivity ?? null,
      line: session?.lastAgentResponse ?? null,
      parentAgentId,
      depth,
      treePrefix: '',
      topLevel: isTopLevelAgent(info, metadata),
      isBackground: session?.isBackground === true || metadata.isBackground === true,
      attentionKind: session ? (getAgentAttentionRequest(session)?.kind ?? null) : null,
      // A captured §7.1 question is outstanding while the agent is in the
      // waiting bucket (same pairing as the ATTENTION panel rows) — once it
      // runs again or finishes the question is answered/moot.
      hasQuestion: bucket === 'waiting' && !!questions[info.id],
    };
  });
}

/**
 * The mock's card-row filter (~lines 972–984): keep live agents
 * (running/waiting/failed) plus idle ancestors that still have a live agent
 * below them in the tree, then assign the connector glyphs over the kept
 * list (`├─`/`└─`, `│ ` rail at depth ≥ 2; roots have none).
 */
function keepLiveWithAncestors(agents: HudCardAgent[]): HudCardAgent[] {
  const kept = agents.filter((agent, index) => {
    if (LIVE_BUCKETS.has(agent.bucket)) return true;
    for (let next = index + 1; next < agents.length; next++) {
      if (agents[next].depth <= agent.depth) break;
      if (LIVE_BUCKETS.has(agents[next].bucket)) return true;
    }
    return false;
  });
  return kept.map((agent, index, arr) => ({
    ...agent,
    treePrefix:
      agent.depth === 0
        ? ''
        : // i18n-ignore (box-drawing tree connector glyphs)
          (agent.depth >= 2 ? '│ ' : '') + (index === arr.length - 1 ? '└─' : '├─'),
  }));
}

/**
 * Center-grid card view-models: one per HUD workspace, joining the workspace
 * entity (`workspace.list` §5.1) with the BE task rollup (`task.list` §5.4),
 * the token usage rollup (`workspace.getTokenUsage` §5.23), the live
 * attention flag, and the agent-session slice's last-response lines. All
 * values are served verbatim from their owning slices — no re-derivation.
 */
export const selectHudWorkspaceCards = store.createSelector((state): HudWorkspaceCard[] => {
  const flags = state.hud.attentionByWorkspaceId;
  return selectHudWorkspaces.select(state).map((workspace) => {
    const workspaceId = String(workspace.id);
    const attention = flags[workspaceId]?.attention ?? null;
    const agents = cardAgentsOf(workspace, state);
    const stateKey = cardStateKey(workspace, attention, agents);
    const usageTotals = state.tokenUsage?.byWorkspaceId[workspaceId]?.totals;
    const stats = state.workspaceTasks?.byWorkspaceId[workspaceId]?.stats;
    const statusMessage =
      typeof workspace.statusMessage === 'string' && workspace.statusMessage.trim().length > 0
        ? workspace.statusMessage
        : null;
    return {
      workspaceId,
      title: workspace.title,
      repoRef: workspace.repositoryName
        ? `${workspace.repositoryOwner ? `${workspace.repositoryOwner}/` : ''}${workspace.repositoryName}`
        : workspace.branch,
      stateKey,
      attention,
      statusMessage,
      prNumber: typeof workspace.prNumber === 'number' ? workspace.prNumber : null,
      tasks: stats
        ? { total: stats.total, completed: stats.completed, inProgress: stats.inProgress }
        : ZERO_TASKS,
      tokens: usageTotals
        ? usageTotals.inputTokens +
          usageTotals.outputTokens +
          usageTotals.cacheReadTokens +
          usageTotals.cacheCreationTokens
        : 0,
      agents: keepLiveWithAncestors(agents),
    };
  });
});

/** One task cell on the takeover map (order index drives spiral placement). */
export interface HudTakeoverTask {
  id: string;
  /** Task title (user/agent content; i18n-exempt). */
  title: string;
  /** Wire task status (PROTOCOL §5.4 `TaskStatus`). */
  status: string;
  /** Live agents linked to this task note (wire names; i18n-exempt). */
  agents: HudCardAgent[];
}

/** View-model for the takeover overlay (one workspace, joined rollups). */
export interface HudTakeoverView {
  workspaceId: string;
  title: string;
  repoRef: string;
  /** Status message (agent content; i18n-exempt), null when empty. */
  statusMessage: string | null;
  /** BE-owned task rollup (`task.list` stats §5.4). */
  stats: { total: number; completed: number; inProgress: number };
  /** Display-ordered non-cancelled tasks for the map (wire order §5.4). */
  tasks: HudTakeoverTask[];
  /** Live agents (running/waiting/failed) with their activity lines. */
  activeAgents: HudCardAgent[];
  /** Everyone else on the workspace roster. */
  idleAgents: HudCardAgent[];
}

/**
 * Takeover view for a workspace id, or null when the workspace left the HUD
 * list. Joins the grid card view-model with the canonical task list
 * (`task.list` §5.4) and the task↔agent links (`task.listAgentLinks` §5.4)
 * so map cells can show which agent is on which task. Values are served
 * verbatim from their owning slices — no re-derivation.
 */
export const selectHudTakeoverView = store.createSelector(
  (state, workspaceId: string): HudTakeoverView | null => {
    const card = selectHudWorkspaceCards
      .select(state)
      .find((entry) => entry.workspaceId === workspaceId);
    if (!card) return null;
    const workspace = getItem(state.workspace.workspaces, workspaceId as WorkspaceId);
    const allAgents: HudCardAgent[] = workspace ? cardAgentsOf(workspace, state) : [];
    const agentById = new Map(allAgents.map((agent) => [agent.id, agent]));
    const linksByNoteId = state.taskAgentAssociations?.byWorkspaceId[workspaceId]?.byNoteId ?? {};
    const taskState = state.workspaceTasks?.byWorkspaceId[workspaceId];
    const tasks: HudTakeoverTask[] = taskState
      ? getItems(taskState.tasks)
          .filter((task) => task.status !== 'cancelled')
          .map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            agents: Object.values(linksByNoteId[task.id] ?? {})
              .map((link) => agentById.get(link.agentId))
              .filter((agent): agent is HudCardAgent => !!agent),
          }))
      : [];
    return {
      workspaceId,
      title: card.title,
      repoRef: card.repoRef,
      statusMessage: card.statusMessage,
      stats: card.tasks,
      tasks,
      activeAgents: card.agents,
      idleAgents: allAgents.filter(
        (agent) =>
          agent.bucket !== 'running' && agent.bucket !== 'waiting' && agent.bucket !== 'failed',
      ),
    };
  },
);
