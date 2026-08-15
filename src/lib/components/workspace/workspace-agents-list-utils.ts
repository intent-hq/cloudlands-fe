import type { AgentSession } from '$shared/types';
import { normalizeSidebarSearchText, sidebarSearchMatches } from './sidebar/sidebar-search';

export interface FlatWorkspaceAgentRow {
  agent: AgentSession;
  depth: number;
}

/** Threshold above which a flat top-level foreground list switches to virtual scrolling. */
export const WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD = 20;

export function isBackgroundAgentSession(agent: AgentSession): boolean {
  return !!(agent.isBackground || agent.metadata?.isBackground);
}

export function isCoordinatorAgentSession(agent: AgentSession): boolean {
  return (agent.metadata?.specialist ?? agent.agentMetadata?.specialist) === 'spec-writer';
}

/**
 * Virtualize only flat lists (no delegations — tree heights are variable) with more
 * top-level foreground agents than the threshold. Coordinator workspaces keep the
 * regular rendering: its Coordinator / "Your agents" section headers have no
 * equivalent in the uniform-row virtual path.
 */
export function shouldVirtualizeWorkspaceAgentRows(rows: FlatWorkspaceAgentRow[]): boolean {
  let topLevelForegroundCount = 0;
  for (const row of rows) {
    if (row.depth > 0) return false;
    if (isBackgroundAgentSession(row.agent)) continue;
    if (isCoordinatorAgentSession(row.agent)) return false;
    topLevelForegroundCount += 1;
  }
  return topLevelForegroundCount > WORKSPACE_AGENTS_VIRTUALIZATION_THRESHOLD;
}

function getParentAgentId(agent: AgentSession): AgentSession['id'] | undefined {
  return typeof agent.metadata?.createdByAgentId === 'string'
    ? (agent.metadata.createdByAgentId as AgentSession['id'])
    : undefined;
}

function getAgentRecency(agent: AgentSession): number {
  const timestamp = agent.updatedAt ?? agent.lastActivity ?? agent.createdAt;
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortAgents(a: AgentSession, b: AgentSession): number {
  const aIsCoordinator = isCoordinatorAgentSession(a);
  const bIsCoordinator = isCoordinatorAgentSession(b);
  if (aIsCoordinator !== bIsCoordinator) return aIsCoordinator ? -1 : 1;
  return getAgentRecency(b) - getAgentRecency(a);
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
    const parentId = getParentAgentId(agent);
    if (parentId && agentIds.has(parentId)) {
      delegatedIds.add(agent.id);
      const children = childrenByParent.get(parentId) ?? [];
      children.push(agent);
      childrenByParent.set(parentId, children);
    }
  }

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
