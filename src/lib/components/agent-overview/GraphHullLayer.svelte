<script lang="ts">
  import { GRAPH_NODE_DIMENSIONS } from './constants';
  import { paddedHull, smoothClosedHullPath, type HullMember } from './hull-geometry';
  import type { AgentNode, GraphEdge, GraphNode, TaskNode } from './types';

  interface Position {
    x: number;
    y: number;
  }

  interface HullGroup {
    task: TaskNode;
    agents: AgentNode[];
    memberIds: string[];
  }

  interface Props {
    edges: GraphEdge[];
    nodes: GraphNode[];
    positions: Map<string, Position>;
    focusNodeId?: string | null;
    spotlightNodeId?: string | null;
  }

  let { edges, nodes, positions, focusNodeId = null, spotlightNodeId = null }: Props = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));
  const activeFocusNodeId = $derived(focusNodeId ?? spotlightNodeId);
  const groups = $derived.by((): HullGroup[] => {
    const result: HullGroup[] = [];
    for (const task of nodes.filter((node): node is TaskNode => node.type === 'task')) {
      const assignments = edges.filter(
        (edge) =>
          edge.type === 'task-assignment' &&
          (edge.sourceId === task.id || edge.targetId === task.id),
      );
      if (assignments.length === 0) continue;

      const agents: AgentNode[] = [];
      let allMembersVisible = true;
      for (const assignment of assignments) {
        const agentId = assignment.sourceId === task.id ? assignment.targetId : assignment.sourceId;
        const agent = nodeById.get(agentId);
        if (agent?.type !== 'agent') {
          allMembersVisible = false;
          break;
        }
        if (!agents.some((candidate) => candidate.id === agent.id)) agents.push(agent);
      }
      const memberIds = [task.id, ...agents.map((agent) => agent.id)];
      if (allMembersVisible && memberIds.every((id) => positions.has(id))) {
        result.push({ task, agents, memberIds });
      }
    }
    return result;
  });

  function memberGeometry(group: HullGroup): HullMember[] {
    return [group.task, ...group.agents].map((node) => {
      const position = positions.get(node.id) ?? node;
      const dimensions = GRAPH_NODE_DIMENSIONS[node.type];
      return {
        ...position,
        radius: Math.hypot(dimensions.width, dimensions.height) / 2,
      };
    });
  }

  function containsFocus(group: HullGroup): boolean {
    return activeFocusNodeId !== null && group.memberIds.includes(activeFocusNodeId);
  }

  function fillOpacity(group: HullGroup): number {
    const working = group.agents.some((agent) => agent.status === 'responding');
    if (activeFocusNodeId && !containsFocus(group)) return 0.012;
    if (containsFocus(group)) return working ? 0.1 : 0.075;
    return working ? 0.08 : 0.055;
  }
</script>

<svg
  class="hull-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  {#each groups as group (group.task.id)}
    {@const members = memberGeometry(group)}
    {@const path = smoothClosedHullPath(paddedHull(members))}
    {@const softPath = smoothClosedHullPath(paddedHull(members, 25))}
    {#if path}
      {#if softPath}
        <path
          class="task-hull-softener task-hull-fill"
          d={softPath}
          fill="var(--color-foreground)"
          fill-opacity={fillOpacity(group) * 0.34}
        />
      {/if}
      <path
        class="task-hull task-hull-fill"
        d={path}
        fill="var(--color-foreground)"
        fill-opacity={fillOpacity(group)}
        data-task-id={group.task.id}
        data-working={group.agents.some((agent) => agent.status === 'responding')}
        data-highlighted={containsFocus(group)}
        data-dimmed={activeFocusNodeId !== null && !containsFocus(group)}
      />
    {/if}
  {/each}
</svg>
