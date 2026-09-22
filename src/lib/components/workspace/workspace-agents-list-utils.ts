import type { AgentDelegatedParentCounts, AgentSession } from '$shared/types';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { isAgentRunningState, toAgentRuntimeStateInput } from '$shared/utils/agent-runtime-state';
import { agentDelegationParentOf, isBackgroundAgentSession } from '$shared/utils/agent-scope';
import { normalizeSidebarSearchText, sidebarSearchMatches } from './sidebar/sidebar-search';

export interface FlatWorkspaceAgentRow {
  agent: AgentSession;
  depth: number;
}

/** Threshold above which a top-level foreground list switches to virtual scrolling. */
export const WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD = 20;
/** Stable height for every row in the Agents panel (selectable rows, group bars, skeletons). */
export const WORKSPACE_AGENT_ROW_HEIGHT = 40;
/** Horizontal indent of one nesting level in the Agents panel. */
export const WORKSPACE_AGENT_ROW_INDENT = 26;
/** Placeholder rows shown under a parent whose delegated children are still loading. */
const DELEGATION_SKELETON_ROWS = 2;

/**
 * One rendered row of the Agents panel. Both render paths — the nested
 * `{#each}` list and the flat virtualized list — consume the same row array,
 * so a row kind that renders in one path renders in the other.
 */
export type WorkspaceAgentListRow =
  | { kind: 'header'; key: string; depth: 0; section: 'coordinator' | 'yourAgents' }
  | { kind: 'agent'; key: string; depth: number; agent: AgentSession }
  | {
      kind: 'delegatedGroup';
      key: string;
      depth: number;
      parent: AgentSession;
      total: number;
      running: number;
      expanded: boolean;
    }
  | { kind: 'delegatedSkeleton'; key: string; depth: number; parentId: string };

export interface WorkspaceAgentListRowOptions {
  /** Loaded direct children of a parent that the list may render right now. */
  getChildren: (agentId: string) => AgentSession[];
  /** Daemon-served `{ total, running }` for a parent whose children are not hydrated. */
  getCountedChildren: (agentId: string) => AgentDelegatedParentCounts | undefined;
  isExpanded: (agentId: string) => boolean;
  isRunning: (agentId: string) => boolean;
  /** True while the workspace-level Delegated bin shows its own skeleton instead. */
  binSkeletonShown: boolean;
}

/**
 * Flattens an agent list into rows: each agent, then — when it has loaded or
 * counted delegated children — its group bar, followed (while expanded) by
 * either per-parent skeleton rows or the children recursively one level deeper.
 * The daemon count wins until the children are hydrated; loaded rows are
 * authoritative after that.
 */
export function buildWorkspaceAgentListRows(
  agents: AgentSession[],
  options: WorkspaceAgentListRowOptions,
  depth = 0,
): WorkspaceAgentListRow[] {
  const rows: WorkspaceAgentListRow[] = [];
  for (const agent of agents) {
    rows.push({ kind: 'agent', key: `agent:${agent.id}`, depth, agent });

    const children = options.getChildren(agent.id);
    const counted = options.getCountedChildren(agent.id);
    const total = Math.max(counted?.total ?? 0, children.length);
    if (total === 0) continue;

    const expanded = options.isExpanded(agent.id);
    const running =
      counted?.running ?? children.filter((child) => options.isRunning(child.id)).length;
    rows.push({
      kind: 'delegatedGroup',
      key: `group:${agent.id}`,
      depth,
      parent: agent,
      total,
      running,
      expanded,
    });
    if (!expanded) continue;

    if (counted !== undefined && children.length === 0 && !options.binSkeletonShown) {
      for (let index = 0; index < DELEGATION_SKELETON_ROWS; index += 1) {
        rows.push({
          kind: 'delegatedSkeleton',
          key: `skeleton:${agent.id}:${index}`,
          depth: depth + 1,
          parentId: agent.id,
        });
      }
    } else {
      rows.push(...buildWorkspaceAgentListRows(children, options, depth + 1));
    }
  }
  return rows;
}

export function isCoordinatorAgentSession(agent: AgentSession): boolean {
  return (agent.metadata?.specialist ?? agent.agentMetadata?.specialist) === 'spec-writer';
}

export function isRetiredAgentSession(agent: AgentSession): boolean {
  return !!agent.retiredAt;
}

/**
 * Virtualize lists with more top-level foreground agents than the threshold.
 * Delegations do not opt out: group bars, skeletons and children are uniform
 * rows of the shared row model (`buildWorkspaceAgentListRows`), so the flat
 * virtual path renders them too. Coordinator workspaces keep the regular
 * rendering for their Coordinator / "Your agents" section layout.
 */
export function shouldVirtualizeWorkspaceAgentRows(rows: FlatWorkspaceAgentRow[]): boolean {
  let topLevelForegroundCount = 0;
  for (const row of rows) {
    if (row.depth > 0) continue;
    if (isBackgroundAgentSession(row.agent)) continue;
    if (isCoordinatorAgentSession(row.agent)) return false;
    topLevelForegroundCount += 1;
  }
  return topLevelForegroundCount > WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD;
}

function getAgentRecency(agent: AgentSession): number {
  const timestamp = agent.updatedAt ?? agent.lastActivity ?? agent.createdAt;
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Parked-wait precedence, mirroring the HUD's `agentBucketOf`: an agent
 * holding completion watches (`isWaitingForOtherAgents`/`waitingForAgentIds`,
 * §5.5), active background hooks (`waitingOnHooks`, §3.1), or active PR
 * monitors (`waitingOnPrMonitors`, §5.42) is idle even when its lagging
 * `status: "active"` / `isResponding` flags say otherwise — unless a turn is
 * genuinely in flight (`turnInFlight`/`liveTurnOpen`/`isStreaming`/
 * `isProcessing`).
 */
function isParkedWaiting(agent: AgentSession): boolean {
  const parked =
    agent.isWaitingForOtherAgents === true ||
    (Array.isArray(agent.waitingForAgentIds) && agent.waitingForAgentIds.length > 0) ||
    (Array.isArray(agent.waitingOnHooks) && agent.waitingOnHooks.length > 0) ||
    (Array.isArray(agent.waitingOnPrMonitors) && agent.waitingOnPrMonitors.length > 0);
  if (!parked) return false;
  return (
    agent.turnInFlight !== true &&
    (agent as AgentSession & { liveTurnOpen?: boolean }).liveTurnOpen !== true &&
    agent.isStreaming !== true &&
    agent.isProcessing !== true
  );
}

/**
 * Idle classification for sibling ordering, mirroring the HUD card's
 * running / failed / attention-request buckets: a live turn per the shared
 * runtime-state predicates, a failed status, or a pending attention request
 * keeps the row in the non-idle partition; everything else (waiting,
 * parked on watches/hooks/monitors, completed, genuinely idle) sorts after
 * it. Known gap vs the HUD: its `needs-attention` bucket also covers an
 * outstanding §7.1 question, but `AgentSession` carries no pending-question
 * field, so a question-pending-but-otherwise-idle agent sorts idle here.
 */
function isIdleForOrdering(agent: AgentSession): boolean {
  const status = typeof agent.status === 'string' ? agent.status.toLowerCase() : '';
  if (status === 'error' || status === 'failed') return false;
  if (getAgentAttentionRequest(agent) !== null) return false;
  if (isParkedWaiting(agent)) return true;
  return !isAgentRunningState(toAgentRuntimeStateInput(agent));
}

/** Per-agent ordering keys, precomputed once per sort (matches the HUD's precomputed buckets). */
interface AgentSortKey {
  coordinator: boolean;
  idle: boolean;
  recency: number;
}

function getAgentSortKey(agent: AgentSession): AgentSortKey {
  return {
    coordinator: isCoordinatorAgentSession(agent),
    idle: isIdleForOrdering(agent),
    recency: getAgentRecency(agent),
  };
}

/**
 * Sibling comparator: coordinator first, then non-idle agents by recency
 * descending, idle agents last (also by recency descending), with a stable
 * agent-id tiebreak so rows don't jump between refreshes. Keys are read from
 * the precomputed map so comparisons stay allocation-free.
 */
function makeAgentComparator(
  keyById: ReadonlyMap<string, AgentSortKey>,
): (a: AgentSession, b: AgentSession) => number {
  return (a, b) => {
    const aKey = keyById.get(a.id) ?? getAgentSortKey(a);
    const bKey = keyById.get(b.id) ?? getAgentSortKey(b);
    if (aKey.coordinator !== bKey.coordinator) return aKey.coordinator ? -1 : 1;
    const idleDelta = Number(aKey.idle) - Number(bKey.idle);
    if (idleDelta !== 0) return idleDelta;
    if (aKey.recency !== bKey.recency) return bKey.recency - aKey.recency;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export function getFlatWorkspaceAgentRows(agents: AgentSession[]): FlatWorkspaceAgentRow[] {
  const dedupedAgents: AgentSession[] = [];
  const seen = new Set<string>();

  for (const agent of Array.isArray(agents) ? agents : []) {
    if (agent?.id && !seen.has(agent.id)) {
      seen.add(agent.id);
      dedupedAgents.push(agent);
    }
  }

  const agentIds = new Set(dedupedAgents.map((agent) => agent.id));
  const delegatedIds = new Set<string>();
  const childrenByParent = new Map<string, AgentSession[]>();

  for (const agent of dedupedAgents) {
    const parentId = agentDelegationParentOf(agent);
    if (parentId && agentIds.has(parentId)) {
      delegatedIds.add(agent.id);
      const children = childrenByParent.get(parentId) ?? [];
      children.push(agent);
      childrenByParent.set(parentId, children);
    }
  }

  const keyById = new Map(dedupedAgents.map((agent) => [agent.id, getAgentSortKey(agent)]));
  const sortAgents = makeAgentComparator(keyById);

  for (const children of childrenByParent.values()) children.sort(sortAgents);

  const rows: FlatWorkspaceAgentRow[] = [];
  const renderedIds = new Set<string>();

  function append(agent: AgentSession, depth: number) {
    if (renderedIds.has(agent.id)) return;
    renderedIds.add(agent.id);
    rows.push({ agent, depth });
    for (const child of childrenByParent.get(agent.id) ?? []) append(child, depth + 1);
  }

  const topLevelAgents = dedupedAgents
    .filter((agent) => !delegatedIds.has(agent.id))
    .sort(sortAgents);
  for (const agent of topLevelAgents) append(agent, 0);

  // Preserve malformed cyclic/orphaned data as top-level rows rather than hiding it.
  for (const agent of dedupedAgents.sort(sortAgents)) append(agent, 0);

  return rows;
}

/** Filters agents by visible metadata and keeps every ancestor of a matching descendant. */
export function filterWorkspaceAgentRows(
  rows: FlatWorkspaceAgentRow[],
  query: string,
): FlatWorkspaceAgentRow[] {
  const normalizedQuery = normalizeSidebarSearchText(query).trim();
  if (!normalizedQuery) return rows;

  const visibleIds = new Set<string>();
  const ancestors: FlatWorkspaceAgentRow[] = [];
  for (const row of rows) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= row.depth) {
      ancestors.pop();
    }
    const { agent } = row;
    const metadata = agent.metadata;
    const agentMetadata = agent.agentMetadata;
    if (
      sidebarSearchMatches(normalizedQuery, [
        agent.name,
        agent.id,
        metadata?.specialist,
        agentMetadata?.specialist,
        metadata?.agentType,
        agentMetadata?.agentType,
        metadata?.role,
        agentMetadata?.role,
      ])
    ) {
      visibleIds.add(agent.id);
      for (const ancestor of ancestors) visibleIds.add(ancestor.agent.id);
    }
    ancestors.push(row);
  }
  return rows.filter((row) => visibleIds.has(row.agent.id));
}

/** Direct-child counts per agent id, derived from the flat depth-ordered rows. */
export function getDirectChildCounts(rows: FlatWorkspaceAgentRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  const ancestors: { id: string; depth: number }[] = [];

  for (const row of rows) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= row.depth) {
      ancestors.pop();
    }
    const parent = ancestors[ancestors.length - 1];
    if (parent && parent.depth === row.depth - 1) {
      counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    }
    ancestors.push({ id: row.agent.id, depth: row.depth });
  }

  return counts;
}

/** Filters flat rows, hiding descendants of collapsed agents. */
export function getVisibleWorkspaceAgentRows(
  rows: FlatWorkspaceAgentRow[],
  collapsedAgentIds: ReadonlySet<string>,
  alwaysVisibleAgentIds: ReadonlySet<string> = new Set(),
): FlatWorkspaceAgentRow[] {
  const forcedVisibleIds = new Set(alwaysVisibleAgentIds);
  const ancestors: FlatWorkspaceAgentRow[] = [];

  for (const row of rows) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= row.depth) {
      ancestors.pop();
    }
    if (forcedVisibleIds.has(row.agent.id)) {
      for (const ancestor of ancestors) forcedVisibleIds.add(ancestor.agent.id);
    }
    ancestors.push(row);
  }

  const visible: FlatWorkspaceAgentRow[] = [];
  let collapsedDepth: number | null = null;

  for (const row of rows) {
    if (collapsedDepth !== null && row.depth <= collapsedDepth) collapsedDepth = null;
    const hiddenByCollapsedAncestor = collapsedDepth !== null && row.depth > collapsedDepth;
    if (!hiddenByCollapsedAncestor || forcedVisibleIds.has(row.agent.id)) visible.push(row);
    if (!hiddenByCollapsedAncestor && collapsedAgentIds.has(row.agent.id)) {
      collapsedDepth = row.depth;
    }
  }

  return visible;
}
