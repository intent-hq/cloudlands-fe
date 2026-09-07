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
  const hullPaths = new Map<string, { main?: SVGPathElement; soft?: SVGPathElement }>();

  function memberGeometry(
    group: TaskHullMembership,
    currentPositions: Map<string, Position>,
  ): HullMember[] | null {
    const members: HullMember[] = [];
    for (const id of group.memberIds) {
      const node = nodeById.get(id);
      if (!node) return null;
      const position = currentPositions.get(id) ?? node;
      const dimensions = GRAPH_NODE_DIMENSIONS[node.type];
      members.push({
        ...position,
        radius: Math.hypot(dimensions.width, dimensions.height) / 2,
      });
    }
    return members;
  }

  function pathsFor(group: TaskHullMembership, currentPositions: Map<string, Position>) {
    const members = memberGeometry(group, currentPositions);
    return {
      main: members ? smoothClosedHullPath(paddedHull(members)) : null,
      soft: members ? smoothClosedHullPath(paddedHull(members, 25)) : null,
    };
  }

  function registerHullPath(
    element: SVGPathElement,
    initial: { taskId: string; kind: 'main' | 'soft' },
  ) {
    let value = initial;
    const register = () => {
      const entry = hullPaths.get(value.taskId) ?? {};
      entry[value.kind] = element;
      hullPaths.set(value.taskId, entry);
    };
    const unregister = () => {
      const entry = hullPaths.get(value.taskId);
      if (!entry) return;
      delete entry[value.kind];
      if (!entry.main && !entry.soft) hullPaths.delete(value.taskId);
    };
    register();
    return {
      update(next: typeof initial) {
        unregister();
        value = next;
        register();
      },
      destroy: unregister,
    };
  }

  export function updatePositions(currentPositions: Map<string, Position>): void {
    for (const group of memberships) {
      const paths = pathsFor(group, currentPositions);
      const elements = hullPaths.get(group.taskId);
      elements?.main?.setAttribute('d', paths.main ?? '');
      elements?.soft?.setAttribute('d', paths.soft ?? '');
    }
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
    {@const paths = pathsFor(group, positions)}
    <path
      use:registerHullPath={{ taskId: group.taskId, kind: 'soft' }}
      class="task-hull-softener task-hull-fill"
      d={paths.soft ?? ''}
      fill="var(--color-foreground)"
      fill-opacity={fillOpacity(group) * HULL_FILL_OPACITIES.softenerRatio}
    />
    <path
      use:registerHullPath={{ taskId: group.taskId, kind: 'main' }}
      class="task-hull task-hull-fill"
      d={paths.main ?? ''}
      fill="var(--color-foreground)"
      fill-opacity={fillOpacity(group)}
      data-task-id={group.taskId}
      data-working={isWorking(group)}
      data-highlighted={containsFocus(group)}
      data-dimmed={activeFocusNodeId !== null && !containsFocus(group)}
    />
  {/each}
</svg>
