/**
 * Fleet HUD Selectors
 *
 * Reads over the hud slice plus HUD-shaped rollups derived from the canonical
 * workspace slice (`workspace.list` aggregates: `displayStatus`,
 * `agentSummary`, `taskStats` — PROTOCOL §5.1). The hud slice's live
 * `displayStatusByWorkspaceId` overrides win over the entity's enrichment
 * value so `workspace:displayStatus-changed` transitions render without a
 * refetch. An override is retired by the slice once an entity delivery shows
 * the store has caught up (see `reconcileDisplayStatusOverride`).
 */

import { store } from '../../store';
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoreState } from '../../types';
import type { HudFeedEntry } from './hud-slice';
import {
  WORKSPACE_DISPLAY_STATUS_VALUES,
  WorkspaceStatus,
  isWorkspaceDisplayStatus,
  type NoteId,
  type WorkspaceDisplayStatus,
  type Workspace,
  type WorkspaceAgentInfo,
  type WorkspaceId,
} from '$shared/types';
import type { TaskAgentAssociation } from '../task-agent-associations/task-agent-associations-types';
import type { HudAgentStateBucket, HudCardStateKey } from './hud-types';
import {
  HUD_AGENT_STATE_BUCKETS,
  displayStatusCardStateKey,
  isHudAttentionValue,
  isHudTrackedAttentionValue,
  isWaitingWireStatus,
  toHudAgentStateBucket,
} from './hud-types';
import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
} from '../agent-session/agent-session-selectors';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { isQuestionMessageDismissed } from '$shared/utils/question-dismissal';
import { deriveAgentPreviewLine } from '$lib/utils/text-utils';

export const selectHudActive = store.createSelector((state) => state.hud.active);

export const selectHudFeed = store.createSelector((state) => state.hud.feed);

export const selectHudUsage = store.createSelector((state) => state.hud.usage);

export const selectHudUsageError = store.createSelector((state) => state.hud.usageError);

export const selectHudRateHistory = store.createSelector((state) => state.hud.rateHistory);

/** Daemon status view the HUD footer LEFT zone and SYSTEM panel render. */
export interface HudSystemView {
  /** Whether the daemon is reachable (see the health mapping below). */
  online: boolean;
  /** Daemon uptime at the last successful poll; null when unknown. */
  uptimeSeconds: number | null;
  /** Daemon version string; null when unknown. */
  version: string | null;
  /** Epoch-ms of the last successful poll; null before the first one. */
  fetchedAtMs: number | null;
}

/**
 * Daemon online/version/uptime for the HUD — a view over the daemon-health
 * slice, which the daemon-health middleware keeps fresh with its 10s
 * `system.status` poll in every renderer (the HUD adds NO fetch of its own).
 * `online` maps the tri-state health: 'healthy' AND 'degraded' render ONLINE
 * (degraded means a poll failed while the connection is up — the daemon is
 * still reachable, and the HUD has only a binary ONLINE/OFFLINE treatment);
 * only 'down' renders OFFLINE. Stats survive a disconnect, so version stays
 * rendered and the SYSTEM panel freezes the last-known uptime while down.
 */
export const selectHudSystem = store.createSelector((state): HudSystemView => {
  const { health, stats, lastUpdated } = state.daemonHealth;
  return {
    online: health !== 'down',
    uptimeSeconds: typeof stats?.uptimeSeconds === 'number' ? stats.uptimeSeconds : null,
    version: stats?.version ?? null,
    fetchedAtMs: lastUpdated ? Date.parse(lastUpdated) : null,
  };
});

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
 * the same attention-aware bucketing as the card agent rows
 * (`agentBucketOf`) so the header RUN/IDLE counters agree with the grid.
 */
export const selectHudAgentStateCounts = store.createSelector(
  (state): Record<HudAgentStateBucket, number> => {
    const counts = Object.fromEntries(
      HUD_AGENT_STATE_BUCKETS.map((bucket) => [bucket, 0]),
    ) as Record<HudAgentStateBucket, number>;
    for (const workspace of selectHudWorkspaces.select(state)) {
      for (const agent of agentInfosOf(workspace)) {
        counts[agentBucketOf(state, agent).bucket] += 1;
      }
    }
    return counts;
  },
);

/** WORKSPACE STATS buckets (header counters + WORKSPACES panel bars). */
export interface HudWorkspaceStateBars {
  /** `not_started` / `idle` / no displayStatus. */
  idle: number;
  /** Non-urgent `unread` (blue-dot flag on an otherwise idle card). */
  unread: number;
  /** `in_progress`. */
  progress: number;
  /** Attention states (`wait` / `blocked`). */
  attention: number;
  /** `pr_open` + `pr_ready`. */
  prOpen: number;
  /** `pr_merged`. */
  prMerged: number;
  /** `failed`. */
  failed: number;
  /** `complete`. */
  completed: number;
  /** All HUD workspaces (bar denominators). */
  total: number;
}

/**
 * WORKSPACE STATS: per-state workspace counts shared by the header counters
 * and the WORKSPACES panel bars — derived from the card `stateKey` (the
 * verbatim BE displayStatus plus the HUD attention overlays) so the rollups
 * always agree with the center grid: `wait`/`blocked` bucket as ATTENTION,
 * `failed` as FAILED, `in_progress` as PROGRESS, `complete` as COMPLETED,
 * PR states as PR OPEN / PR MERGED, `unread` as UNREAD, and everything else
 * (`idle`/`not_started`) as IDLE. An unread `complete`/`pr_merged` workspace
 * folds to UNREAD (its card `stateKey` does — see `cardStateKey`), so it
 * counts as UNREAD, not COMPLETED / PR MERGED.
 */
export const selectHudWorkspaceStateBars = store.createSelector((state): HudWorkspaceStateBars => {
  const bars: HudWorkspaceStateBars = {
    idle: 0,
    unread: 0,
    progress: 0,
    attention: 0,
    prOpen: 0,
    prMerged: 0,
    failed: 0,
    completed: 0,
    total: 0,
  };
  for (const card of selectHudWorkspaceCards.select(state)) {
    bars.total += 1;
    switch (card.stateKey) {
      case 'wait':
      case 'blocked':
        bars.attention += 1;
        break;
      case 'unread':
        bars.unread += 1;
        break;
      case 'failed':
        bars.failed += 1;
        break;
      case 'in_progress':
        bars.progress += 1;
        break;
      case 'complete':
        bars.completed += 1;
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
  /** Wire attention value (HUD allowlist, e.g. `"review_required"`); only for `workspace_attention`. */
  attention?: string;
  /**
   * The raising signal on `agent_waiting` rows — drives the mock's per-signal
   * kind chip (QUESTION / DISCUSSION REQUIRED / BLOCKED); absent when the row
   * pends without a captured reason (generic NEEDS ATTENTION chip).
   */
  signal?: 'question' | 'discussion' | 'blocker';
  /** Raising agent's display name (wire identifier); only for agent rows. */
  agentName?: string;
  /**
   * Detail line under the row (mock `q.msg`) — the captured question text or
   * the §5.5 attention-request reason for waiting agents when one is known
   * (agent content; i18n-exempt); null else.
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
 * ATTENTION panel rows, newest first: agents in the needs-attention/failed
 * buckets (from `agentSummary.agents`, PROTOCOL §5.1, via the attention-aware
 * `agentBucketOf`) plus workspaces whose live `workspace:attention-changed`
 * flag is raised (the hud slice mirrors the event stream; the wire attention
 * enum is only `none | unread | review_required` (§9.9) —
 * question/blocker/discussion attention never travels on it, so the
 * `review_required` allowlist stays exact and `unread` stays excluded). An
 * attention card state (`wait`/`blocked`/`failed` — the BE rollup, §5.1) no
 * other row already covers raises a generic workspace row — the same
 * authoritative-rollup fallback the ATTN counter applies, so a question hold
 * the FE never captured still gets a panel row. Rows for workspaces no longer
 * in the list are dropped.
 */
export const selectHudAttentionItems = store.createSelector((state): HudAttentionItem[] => {
  const flags = state.hud.attentionByWorkspaceId;
  const questions = state.hud.questionsByAgentId;
  const items: HudAttentionItem[] = [];
  for (const workspace of selectHudWorkspaces.select(state)) {
    const workspaceId = String(workspace.id);
    let covered = false;
    for (const agent of agentInfosOf(workspace)) {
      const { bucket, attentionKind, hasQuestion } = agentBucketOf(state, agent);
      if (bucket !== 'needs-attention' && bucket !== 'failed') continue;
      // Raising signal + detail text: the agent's outstanding §7.1 question
      // block (most actionable — the user can answer it verbatim), else the
      // §5.5 attention-request kind/reason from the tracked session; attention
      // rows only. Drives the mock's per-signal kind chip (QUESTION /
      // DISCUSSION REQUIRED / BLOCKED) and the row's message line.
      const question = hasQuestion ? questions[agent.id] : undefined;
      const attentionReason = attentionKind
        ? getAgentAttentionRequest(state.agentSessions?.byAgentId[agent.id])?.reason
        : undefined;
      const signal: HudAttentionItem['signal'] = question
        ? 'question'
        : (attentionKind ?? undefined);
      items.push({
        workspaceId,
        workspaceTitle: workspace.title,
        kind: bucket === 'needs-attention' ? 'agent_waiting' : 'agent_failed',
        ...(bucket === 'needs-attention' && signal ? { signal } : {}),
        agentName: agent.name,
        message: question?.question ?? attentionReason ?? null,
        sinceTs: agent.lastActivity ?? null,
      });
      covered = true;
    }
    const flag = flags[workspaceId];
    // Only urgent flags raise a row: the tracked non-urgent `unread` (blue
    // UNREAD card state) is never a call to action on the ATTENTION panel.
    if (flag && isHudAttentionValue(flag.attention)) {
      items.push({
        workspaceId,
        workspaceTitle: workspace.title,
        kind: 'workspace_attention',
        attention: flag.attention,
        message: null,
        sinceTs: flag.raisedAtTs,
      });
      covered = true;
    }
    if (ATTENTION_CARD_STATES.has(cardStateKey(workspace)) && !covered) {
      items.push({
        workspaceId,
        workspaceTitle: workspace.title,
        kind: 'workspace_attention',
        message: null,
        sinceTs: null,
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
   * Latest activity line for the swap animation (wire/agent content;
   * i18n-exempt), else null. Derived by the shared
   * `deriveAgentPreviewLine` helper (same precedence as the AgentCard
   * footer preview: live response > newest user message > digest/report >
   * persisted `lastAgentResponse`) over the AgentLite projection
   * (`agent.list`, §5.5) folded in by the HUD's per-workspace hydration and
   * kept fresh by live status events.
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
   * agent and the agent is waiting on it (dismissal marker honored).
   */
  hasQuestion: boolean;
  /**
   * The agent parents pending completion watches (session
   * `isWaitingForOtherAgents` / non-empty `waitingForAgentIds`, §5.5 — folded
   * in by the HUD's per-workspace `agent.list` hydration). A waiting
   * coordinator stays VISIBLE on the card (idle bucket) between turns.
   */
  isWaitingForAgents: boolean;
  /**
   * Distinct child agent ids this agent waits on (session
   * `waitingForAgentIds`, §5.5); empty when none or untracked. The awaited
   * agents' rows are kept visible even when between turns.
   */
  waitingForAgentIds: string[];
}

/**
 * Attention-reason strip content for a card in an attention state: what the
 * raising top-level agent actually needs (its §7.1 question text or §5.5
 * attention-request reason), so the card says WHY it blinks. `pending` is
 * the no-text fallback for a wire `needs_attention` rollup whose reason the
 * HUD never captured (e.g. the question was asked before the window opened —
 * the slice is live-only) — the component renders a generic localized line
 * instead of leaving the workspace status text in place. `failed` carries
 * the failing agent's §5.5 `stopReason` (empty text when none is tracked —
 * the component renders a generic failed line, never the status message).
 */
export interface HudCardAttentionSnippet {
  kind: 'question' | 'blocker' | 'discussion' | 'pending' | 'failed';
  /**
   * Question/reason/error text (agent content; i18n-exempt); empty for
   * `pending` and for `failed` without a known stopReason.
   */
  text: string;
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
  /** Attention-reason strip content; null outside `wait`/`blocked`/`failed` or when no reason is known. */
  attentionSnippet: HudCardAttentionSnippet | null;
  prNumber: number | null;
  /** BE-owned task rollup (`task.list` stats; zeros until loaded). */
  tasks: { total: number; completed: number; inProgress: number };
  /** Sum of the four token counters from the workspace usage rollup. */
  tokens: number;
  /** Live agents only (running / needs-attention / failed buckets), wire order. */
  agents: HudCardAgent[];
}

const ZERO_TASKS = { total: 0, completed: 0, inProgress: 0 };

/**
 * Card state key: the BE-owned `workspace.displayStatus` rendered VERBATIM
 * (cloudlands-fe#578). The daemon owns the whole canonical precedence
 * (intentd#945 — `failed` > `blocked` > `needs_attention` > `in_progress` >
 * `unread` > the PR/task rollup, PROTOCOL §5.1), including the agent-running
 * promotion, the idle demotion (intentd#793), the blocker/failed axes and the
 * blue-dot `unread` promotion — so the HUD applies NO local promotion or
 * demotion over live sessions or attention flags. The only mapping left is
 * presentational: the wire `needs_attention` renders as `wait` (NEEDS
 * ATTENTION, yellow). Unknown or absent wire values default to `not_started`
 * so the card never vanishes (same convention as `AllWorkspacesCard`).
 */
function cardStateKey(workspace: Workspace): HudCardStateKey {
  const displayStatus = isWorkspaceDisplayStatus(workspace.displayStatus)
    ? workspace.displayStatus
    : 'not_started';
  return displayStatusCardStateKey(displayStatus) ?? 'not_started';
}

/** Card states that are a call to action (ATTN counter + ATTENTION panel). */
const ATTENTION_CARD_STATES: ReadonlySet<HudCardStateKey> = new Set<HudCardStateKey>([
  'wait',
  'blocked',
  'failed',
]);

/**
 * Attention-reason strip content for a card the BE put in the `wait` /
 * `blocked` / `failed` states — a DETAIL-TEXT lookup only; the state itself
 * comes from `cardStateKey` (the wire `displayStatus`). It surfaces the first
 * TOP-LEVEL NON-BACKGROUND agent's raising signal, by the precedence question
 * > blocker > discussion (a captured §7.1 question is the most actionable —
 * the user can answer it verbatim). The text is the captured question or the
 * §5.5 `attentionRequestReason` (read from the tracked session, where the
 * attention-request trio lives). When no gated agent carries a reason (e.g.
 * the question was asked before the HUD window opened, or the daemon raised
 * the axis off the workspace `attention` flag), the `pending` fallback keeps
 * the strip on the attention reason (a generic localized "awaiting your
 * input" line) — the workspace status text must never mask pending attention.
 *
 * A `failed` card always gets a `failed` snippet: the first failed-bucket
 * agent's §5.5 `stopReason` (read from the tracked session) is the error the
 * user needs, and when no stopReason is known the empty text renders a
 * generic failed line — never the workspace status message.
 */
function cardAttentionSnippet(
  state: StoreState,
  stateKey: HudCardStateKey,
  agents: HudCardAgent[],
): HudCardAttentionSnippet | null {
  if (stateKey === 'failed') {
    const failed = agents.find((agent) => agent.bucket === 'failed');
    const stopReason = failed ? state.agentSessions?.byAgentId[failed.id]?.stopReason : null;
    return {
      kind: 'failed',
      text: typeof stopReason === 'string' && stopReason.length > 0 ? stopReason : '',
    };
  }
  if (stateKey !== 'wait' && stateKey !== 'blocked') return null;
  const gated = agents.filter((agent) => agent.topLevel && !agent.isBackground);
  for (const agent of gated) {
    if (!agent.hasQuestion) continue;
    const question = state.hud.questionsByAgentId[agent.id];
    if (question?.question) return { kind: 'question', text: question.question };
  }
  for (const kind of ['blocker', 'discussion'] as const) {
    for (const agent of gated) {
      if (agent.attentionKind !== kind) continue;
      const session = state.agentSessions?.byAgentId[agent.id];
      const reason = getAgentAttentionRequest(session)?.reason;
      if (reason) return { kind, text: reason };
    }
  }
  return { kind: 'pending', text: '' };
}

const LIVE_BUCKETS: ReadonlySet<HudAgentStateBucket> = new Set([
  'running',
  'needs-attention',
  'failed',
]);

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

/** Attention-aware bucket + predicates for one summary agent. */
interface HudAgentBucketInfo {
  bucket: HudAgentStateBucket;
  attentionKind: 'discussion' | 'blocker' | null;
  hasQuestion: boolean;
}

/**
 * State bucket for an agent: the live agent-session slice wins when it
 * tracks the agent (the daemon-events-bridge folds `agent:status-changed`
 * live, while the workspace entity's `agentSummary` only refreshes with the
 * next workspace snapshot), else the summary's wire status. Waiting on OTHER
 * AGENTS wins first (`isWaitingForOtherAgents`/`waitingForAgentIds`, §5.5): a
 * coordinator between turns holding completion watches buckets `idle` even
 * when its status/`isResponding` flags lag at active — it is not running
 * work, merely parked on children (visibility on the card is handled
 * separately by `keepLiveWithAncestors`, never by inflating the bucket).
 * Genuine turn work still buckets running — a coordinator can take a turn
 * while its watches pend: the daemon's `turnInFlight` (§5.5 STAB-125, the
 * emit-time "a worker is draining a turn NOW" signal, refreshed by the
 * STAB-9 `agent.list` re-hydration on every status event) or the FE-owned
 * `isStreaming`/`isProcessing` send signals defeat the waiting gate. THEN an in-flight
 * turn wins (`selectAgentIsResponding` — BE activity flags including
 * `isWaitingOnTool`, §5.5: a mid-turn tool call is running work, not idle),
 * THEN a merely-waiting agent buckets as `idle` — `needs-attention` is
 * reserved for a pending attention request (blocker/discussion, §5.5) or an
 * outstanding §7.1 question (dismissal marker honored), mirroring main's
 * `avatar-state` precedence (failed > attention > running > idle). Every HUD
 * surface (header bar, card rows, overlay active/idle lists, cell chips)
 * derives from this one function so they can never disagree.
 */
function agentBucketOf(state: StoreState, info: WorkspaceAgentInfo): HudAgentBucketInfo {
  const session = state.agentSessions?.byAgentId[info.id];
  const metadata = (session?.metadata ?? {}) as Record<string, unknown>;
  const attentionKind = session ? (getAgentAttentionRequest(session)?.kind ?? null) : null;
  // Waiting check: the canonical selector (PascalCase `Waiting` status /
  // `isWaitingOnTool` / waiting-for-other-agents) plus the lowercase wire
  // status the summary and `agent:status-changed` events carry.
  const waiting = session
    ? selectAgentIsWaiting.select(state, info.id) ||
      (typeof session.status === 'string' && isWaitingWireStatus(session.status))
    : isWaitingWireStatus(info.status);
  // Parked on completion watches (§5.5): the daemon can leave `status:
  // "active"` / `isResponding: true` on a coordinator BETWEEN turns while it
  // waits on children — those lagging flags must not present as running.
  // Terminal statuses (failed/done) win over stale watch fields.
  const sessionStatusBucket = session
    ? toHudAgentStateBucket(typeof session.status === 'string' ? session.status : info.status)
    : null;
  const waitsOnOtherAgents =
    !!session &&
    sessionStatusBucket !== 'failed' &&
    sessionStatusBucket !== 'done' &&
    (session.isWaitingForOtherAgents === true ||
      (Array.isArray(session.waitingForAgentIds) && session.waitingForAgentIds.length > 0));
  // STAB-125 turn-liveness (§5.5, additive AgentLite field — structural read,
  // same convention as chat-read-service): `turnInFlight: true` is the
  // daemon's authoritative "an active worker is draining a turn NOW" signal,
  // derived at emit time (never a persisted lag like `status: "active"`).
  // Watch-pending and turn-running are ORTHOGONAL: a coordinator holding a
  // completion watch on a child still takes turns of its own, and the
  // `agent.list` hydration the events bridge refires on every
  // `agent:status-changed` (STAB-9) reports isWaitingForOtherAgents: true
  // THROUGHOUT that turn — so waiting may only win while no turn is in
  // flight, else the card square stays grey for the whole turn while the
  // feed shows AGENT RUNNING off the same event stream. `turnInFlight` alone
  // is racy: the daemon emits the turn-start event BEFORE opening the
  // live-turn slot, so the refetch that very event triggers can land with
  // `turnInFlight: false` mid-turn (green flicker → grey, 3rd repro). The
  // slice's FE-owned sticky `liveTurnOpen` slot (opened by the running event
  // fold, closed only by a terminal/isActive:false signal) covers that gap.
  const turnInFlight =
    !!session &&
    ((session as { turnInFlight?: unknown }).turnInFlight === true ||
      session.liveTurnOpen === true);
  let base: HudAgentStateBucket;
  if (!session) {
    // No tracked session (the HUD window never chat-subscribes): the summary's
    // own turn-liveness flags (`isStreaming`/`isResponding`, §5.1) mark an
    // in-flight turn even when the persisted status string lags at idle/waiting
    // — a mid-turn delegated agent must bucket running everywhere.
    base =
      info.isResponding === true || info.isStreaming === true
        ? 'running'
        : toHudAgentStateBucket(info.status);
  } else if (
    waitsOnOtherAgents &&
    !turnInFlight &&
    session.isStreaming !== true &&
    session.isProcessing !== true
  ) {
    // Not running: a waiting coordinator counts IDLE everywhere (counters,
    // rows, overlay lists, chips); `keepLiveWithAncestors` keeps the row
    // visible via `isWaitingForAgents`, never by inflating this bucket.
    base = 'idle';
  } else if (selectAgentIsResponding.select(state, info.id)) base = 'running';
  else if (waiting) base = 'idle';
  else {
    base = toHudAgentStateBucket(typeof session.status === 'string' ? session.status : info.status);
  }
  // A captured §7.1 question pends PERSISTENTLY (spec §Decisions): a plain
  // user message and the turn it starts no longer supersede it, so the
  // capture survives the agent running again — it only stops pending when
  // the daemon's `needs_attention` rollup drops
  // (`hudQuestionsResolvedForWorkspace` clears the slice entry on answer /
  // dismissal), when the agent fails, or when the user dismissed it (its
  // message id === metadata.dismissedQuestionsMessageId, §5.5) — the same
  // predicate the chat wizard gate uses. It raises `needs-attention` from
  // any non-failed base — including `running`, exactly like an outstanding
  // attention request does: the user still owes an answer while the agent
  // works on an unrelated message.
  const question = state.hud.questionsByAgentId[info.id];
  const hasQuestion =
    base !== 'failed' &&
    !!question &&
    !isQuestionMessageDismissed(metadata, question.messageId);
  const bucket =
    base === 'failed'
      ? 'failed'
      : attentionKind !== null || hasQuestion
        ? 'needs-attention'
        : base;
  return { bucket, attentionKind, hasQuestion };
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
  return orderAgentTree(agentInfosOf(workspace)).map(({ info, depth, parentAgentId }) => {
    const session = state.agentSessions?.byAgentId[info.id];
    const metadata = (session?.metadata ?? {}) as Record<string, unknown>;
    const { bucket, attentionKind, hasQuestion } = agentBucketOf(state, info);
    const waitingForAgentIds = Array.isArray(session?.waitingForAgentIds)
      ? session.waitingForAgentIds.filter((id): id is string => typeof id === 'string')
      : [];
    return {
      id: info.id,
      name: info.name,
      bucket,
      lastActivityTs: info.lastActivity ?? null,
      // Same precedence as the AgentCard footer preview (shared helper) over
      // the AgentLite fields the HUD hydration carries.
      line: session
        ? deriveAgentPreviewLine({
            lastAgentResponse: session.lastAgentResponse,
            lastUserMessage: session.lastUserMessage,
            lastMessageRole: session.lastMessageRole,
            digest: session.digest,
            isResponding: session.isResponding === true,
            completionReport:
              typeof metadata.completionReport === 'string' ? metadata.completionReport : null,
          })
        : null,
      parentAgentId,
      depth,
      treePrefix: '',
      topLevel: isTopLevelAgent(info, metadata),
      isBackground: session?.isBackground === true || metadata.isBackground === true,
      attentionKind,
      hasQuestion,
      isWaitingForAgents: session?.isWaitingForOtherAgents === true || waitingForAgentIds.length > 0,
      waitingForAgentIds,
    };
  });
}

/**
 * The mock's card-row filter (~lines 972–984): keep live agents
 * (running/needs-attention/failed) plus idle ancestors that still have a
 * live agent below them in the tree, then assign the connector glyphs over
 * the kept list (`├─`/`└─`, `│ ` rail at depth ≥ 2; roots have none).
 *
 * Coordination visibility: a coordinator that ended its turn to WAIT on
 * children (`isWaitingForOtherAgents` / `waitingForAgentIds`, §5.5) buckets
 * idle, and its awaited children are often between turns (also idle) — a
 * naive live-only filter would empty the card while the delegation is very
 * much in flight. So a waiting agent is kept, and every agent it awaits is
 * kept too (plus their idle ancestors, via the same below-check), preserving
 * the parentage-tree presentation across turn boundaries.
 */
function keepLiveWithAncestors(agents: HudCardAgent[]): HudCardAgent[] {
  const awaitedIds = new Set<string>();
  for (const agent of agents) {
    for (const id of agent.waitingForAgentIds) awaitedIds.add(id);
  }
  const keepsRow = (agent: HudCardAgent): boolean =>
    LIVE_BUCKETS.has(agent.bucket) || agent.isWaitingForAgents || awaitedIds.has(agent.id);
  const kept = agents.filter((agent, index) => {
    if (keepsRow(agent)) return true;
    for (let next = index + 1; next < agents.length; next++) {
      if (agents[next].depth <= agent.depth) break;
      if (keepsRow(agents[next])) return true;
    }
    return false;
  });
  return kept.map((agent, index, arr) => {
    if (agent.depth === 0) return { ...agent, treePrefix: '' };
    // Last sibling = no later kept row at the same depth before the walk
    // leaves this parent's subtree (depth drops below the agent's).
    let lastSibling = true;
    for (let next = index + 1; next < arr.length; next++) {
      if (arr[next].depth < agent.depth) break;
      if (arr[next].depth === agent.depth) {
        lastSibling = false;
        break;
      }
    }
    return {
      ...agent,
      // i18n-ignore (box-drawing tree connector glyphs)
      treePrefix: (agent.depth >= 2 ? '│ ' : '') + (lastSibling ? '└─' : '├─'),
    };
  });
}

/**
 * Center-grid card view-models: one per HUD workspace, joining the workspace
 * entity (`workspace.list` §5.1) with the BE task rollup (`task.list` §5.4),
 * the token usage rollup (`workspace.getTokenUsage` §5.23), the attention
 * flag, and the agent-session slice's last-response lines. All values are
 * served verbatim from their owning slices — no re-derivation.
 *
 * Attention sources: the hud slice's live `workspace:attention-changed` flag
 * when one arrived, else the entity's daemon-served `attention` field
 * (`workspace.list`/`workspace.get` §5.1, kept fresh by the events bridge)
 * when it is a tracked value — so a workspace already unread at app start
 * renders UNREAD without waiting for a live event.
 */
export const selectHudWorkspaceCards = store.createSelector((state): HudWorkspaceCard[] => {
  const flags = state.hud.attentionByWorkspaceId;
  return selectHudWorkspaces.select(state).map((workspace) => {
    const workspaceId = String(workspace.id);
    const attention =
      flags[workspaceId]?.attention ??
      (typeof workspace.attention === 'string' && isHudTrackedAttentionValue(workspace.attention)
        ? workspace.attention
        : null);
    const agents = cardAgentsOf(workspace, state);
    const stateKey = cardStateKey(workspace);
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
      attentionSnippet: cardAttentionSnippet(state, stateKey, agents),
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

/**
 * Header ATTN counter (mock `stats.attn` — per-agent wait + fail): counts
 * exactly what renders an attention state on the grid, so the blinking
 * counter always agrees with the cards. An agent counts when it would raise
 * its card's banner — `failed` bucket (ungated, like `cardStateKey`), or a
 * TOP-LEVEL NON-BACKGROUND agent with a pending attention request /
 * outstanding question (the daemon's step-0 `needs_attention` gating,
 * intentd#825, mirrored per-agent; delegated (`parentAgentId`, §5.1 v2.9 —
 * the parentage signal main's #573 uses to skip toasts) and background
 * agents never count). Each raised workspace-level attention flag adds one
 * (it renders NEEDS ATTENTION with no raising agent), as does an attention
 * card state (`wait`/`blocked`/`failed` — the BE rollup, §5.1) no per-agent
 * signal already covered (the daemon rollup is authoritative — e.g. a
 * question hold the FE never captured must still blink). Pending requests
 * clear only on user-origin deliveries (`attentionRequestCleared`, §5.5), so
 * a cleared request drops out live — no stale entries linger.
 *
 * The ungated `failed` bucket is a DELIBERATE per-agent axis, not a leftover
 * of the removed card-state synthesis: the BE rollup deliberately ignores
 * child/background sessions, so a failed delegated agent leaves every card
 * `in_progress` while still being actionable. The counter and the ATTENTION
 * panel share this rule (they stay mutually consistent), and the card keeps
 * rendering the daemon value verbatim — the per-agent counter is a separate
 * axis over the agent roster, not a second opinion on the workspace status.
 */
export const selectHudAttnCount = store.createSelector((state): number => {
  const flags = state.hud.attentionByWorkspaceId;
  let count = 0;
  for (const workspace of selectHudWorkspaces.select(state)) {
    let agentCounted = false;
    for (const agent of cardAgentsOf(workspace, state)) {
      if (
        agent.bucket === 'failed' ||
        (agent.topLevel &&
          !agent.isBackground &&
          (agent.attentionKind !== null || agent.hasQuestion))
      ) {
        count += 1;
        agentCounted = true;
      }
    }
    // Only urgent flags count: the tracked non-urgent `unread` (blue UNREAD
    // card state) never inflates the blinking ATTN counter.
    const flag = flags[String(workspace.id)];
    const flagged = flag !== undefined && isHudAttentionValue(flag.attention);
    if (flagged) count += 1;
    if (ATTENTION_CARD_STATES.has(cardStateKey(workspace)) && !agentCounted && !flagged) count += 1;
  }
  return count;
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
  /**
   * Body text for COMPLETE cells (agent/wire content; i18n-exempt): the
   * completing agent's final progress report (`completionReport` persisted by
   * `agent.reportToParent` on the linked agent's session metadata, §5.5),
   * falling back to the task note's content when no report exists. Null on
   * non-complete tasks and when neither source has text.
   */
  report: string | null;
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
  /** Live agents (running/needs-attention/failed) with their activity lines. */
  activeAgents: HudCardAgent[];
  /** Everyone else on the workspace roster. */
  idleAgents: HudCardAgent[];
}

/**
 * COMPLETE-cell body text: the newest linked agent's persisted
 * `completionReport` (session `metadata`, `agent.reportToParent` §5.5) when
 * any linked session carries one, else the task note's own content (the task
 * id IS its note id, §5.4) — both served verbatim; null when neither has text.
 */
function completeTaskReport(
  state: StoreState,
  workspaceId: string,
  taskId: string,
  links: TaskAgentAssociation[],
): string | null {
  const newestFirst = links.slice().sort((a, b) => b.createdAt - a.createdAt);
  for (const link of newestFirst) {
    const metadata = state.agentSessions?.byAgentId[link.agentId]?.metadata as
      | Record<string, unknown>
      | undefined;
    const report = metadata?.completionReport;
    if (typeof report === 'string' && report.trim().length > 0) return report;
  }
  const notes = state.workspaceNotes?.byWorkspaceId[workspaceId]?.notes;
  const content = notes ? getItem(notes, taskId as NoteId)?.content : undefined;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
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
          .map((task) => {
            const links = Object.values(linksByNoteId[task.id] ?? {});
            return {
              id: task.id,
              title: task.title,
              status: task.status,
              agents: links
                .map((link) => agentById.get(link.agentId))
                .filter((agent): agent is HudCardAgent => !!agent),
              report:
                task.status === 'complete'
                  ? completeTaskReport(state, workspaceId, task.id, links)
                  : null,
            };
          })
      : [];
    return {
      workspaceId,
      title: card.title,
      repoRef: card.repoRef,
      statusMessage: card.statusMessage,
      stats: card.tasks,
      tasks,
      // Both lists partition the SAME per-agent buckets (`agentBucketOf` via
      // `cardAgentsOf`) the AGENTS BY STATE bar counts — no idle ancestors in
      // the active list (that tree-keep is a card-row rendering concern), so
      // the overlay and the header can never disagree on who is running.
      activeAgents: allAgents.filter((agent) => LIVE_BUCKETS.has(agent.bucket)),
      idleAgents: allAgents.filter((agent) => !LIVE_BUCKETS.has(agent.bucket)),
    };
  },
);
