<script lang="ts">
  import { GRAPH_NODE_DIMENSIONS } from './constants';
  import type { TaskHullMembership } from './graph-helpers';
  import {
    HULL_FILL_OPACITIES,
    paddedHull,
    smoothClosedHullPath,
    type HullMember,
  } from './hull-geometry';
  import type { GraphNode } from './types';

  interface Position {
    x: number;
    y: number;
  }

  interface Props {
    memberships: TaskHullMembership[];
    nodes: GraphNode[];
    positions: Map<string, Position>;
    focusNodeId?: string | null;
    spotlightNodeId?: string | null;
  }

  let {
    memberships,
    nodes,
    positions,
    focusNodeId = null,
    spotlightNodeId = null,
  }: Props = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));
  const activeFocusNodeId = $derived(focusNodeId ?? spotlightNodeId);

  function memberGeometry(group: TaskHullMembership): HullMember[] | null {
    if (!group.memberIds.every((id) => positions.has(id) && nodeById.has(id))) return null;
    return group.memberIds.map((id) => {
      const node = nodeById.get(id)!;
      const position = positions.get(id)!;
      const dimensions = GRAPH_NODE_DIMENSIONS[node.type];
      return {
        ...position,
        radius: Math.hypot(dimensions.width, dimensions.height) / 2,
      };
    });
  }

  function containsFocus(group: TaskHullMembership): boolean {
    return activeFocusNodeId !== null && group.memberIds.includes(activeFocusNodeId);
  }

  function isWorking(group: TaskHullMembership): boolean {
    return group.agentIds.some((id) => {
      const node = nodeById.get(id);
      return node?.type === 'agent' && node.status === 'responding';
    });
  }

  function fillOpacity(group: TaskHullMembership): number {
    const working = isWorking(group);
    if (activeFocusNodeId && !containsFocus(group)) return HULL_FILL_OPACITIES.dimmed;
    if (containsFocus(group)) {
      return working ? HULL_FILL_OPACITIES.focusedWorking : HULL_FILL_OPACITIES.focusedIdle;
    }
    return working ? HULL_FILL_OPACITIES.working : HULL_FILL_OPACITIES.idle;
  }
</script>

<svg
  class="hull-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  {#each memberships as group (group.taskId)}
    {@const members = memberGeometry(group)}
    {#if members}
      {@const path = smoothClosedHullPath(paddedHull(members))}
      {@const softPath = smoothClosedHullPath(paddedHull(members, 25))}
      {#if path}
        {#if softPath}
          <path
            class="task-hull-softener task-hull-fill"
            d={softPath}
            fill="var(--color-foreground)"
            fill-opacity={fillOpacity(group) * HULL_FILL_OPACITIES.softenerRatio}
          />
        {/if}
        <path
          class="task-hull task-hull-fill"
          d={path}
          fill="var(--color-foreground)"
          fill-opacity={fillOpacity(group)}
          data-task-id={group.taskId}
          data-working={isWorking(group)}
          data-highlighted={containsFocus(group)}
          data-dimmed={activeFocusNodeId !== null && !containsFocus(group)}
        />
      {/if}
    {/if}
  {/each}
</svg>
