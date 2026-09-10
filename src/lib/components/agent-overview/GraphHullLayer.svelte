<script lang="ts">
  import { onDestroy } from 'svelte';
  import { GRAPH_NODE_DIMENSIONS } from './constants';
  import type { TaskHullMembership } from './graph-helpers';
  import {
    activityHullTransition,
    activityMotion,
    nodeEnterDelay,
    playbackDuration,
  } from './activity-motion';
  import {
    HULL_FILL_OPACITIES,
    HULL_PADDING,
    HULL_SOFT_PADDING,
    interpolateHullMembers,
    paddedHull,
    smoothClosedHullPath,
    type KeyedHullMember,
  } from './hull-geometry';
  import type { GraphNode } from './types';

  interface Position {
    x: number;
    y: number;
  }

  interface NodeEnvelope {
    width: number;
    height: number;
  }

  interface Props {
    memberships: TaskHullMembership[];
    nodes: GraphNode[];
    positions: Map<string, Position>;
    nodeEnvelopes?: ReadonlyMap<string, NodeEnvelope>;
    focusNodeId?: string | null;
    spotlightNodeId?: string | null;
    playbackSpeed?: number;
    zoomScale?: number;
  }

  let {
    memberships,
    nodes,
    positions,
    nodeEnvelopes = new Map(),
    focusNodeId = null,
    spotlightNodeId = null,
    playbackSpeed = 1,
    zoomScale = 1,
  }: Props = $props();

  const nodeById = $derived(new Map(nodes.map((node) => [node.id, node])));
  const activeFocusNodeId = $derived(focusNodeId ?? spotlightNodeId);
  const hullPaths = new Map<string, { main?: SVGPathElement; soft?: SVGPathElement }>();
  const renderedMembers = new Map<string, KeyedHullMember[]>();
  const previousMemberIds = new Map<string, string[]>();
  const morphs = new Map<string, { from: KeyedHullMember[]; startedAt: number }>();
  let currentPositions = new Map<string, Position>();
  let morphFrame: number | null = null;
  let motionEnabled = $state(true);

  function memberGeometry(
    group: TaskHullMembership,
    currentPositions: Map<string, Position>,
  ): KeyedHullMember[] | null {
    const members: KeyedHullMember[] = [];
    for (const id of group.memberIds) {
      const node = nodeById.get(id);
      if (!node) return null;
      const position = currentPositions.get(id) ?? node;
      const envelope = nodeEnvelopes.get(id) ?? GRAPH_NODE_DIMENSIONS[node.type];
      members.push({
        id,
        ...position,
        width: envelope.width,
        height: envelope.height,
        offsetX: 0,
        offsetY: 0,
      });
    }
    return members;
  }

  function pathsFor(group: TaskHullMembership, currentPositions: Map<string, Position>) {
    const members = memberGeometry(group, currentPositions);
    const scale = Math.max(0.01, zoomScale);
    return {
      main: members ? smoothClosedHullPath(paddedHull(members, HULL_PADDING / scale)) : null,
      soft: members ? smoothClosedHullPath(paddedHull(members, HULL_SOFT_PADDING / scale)) : null,
    };
  }

  function sameMembers(left: string[] | undefined, right: string[]): boolean {
    return left?.length === right.length && left.every((id, index) => id === right[index]);
  }

  function reshapeEnabled(): boolean {
    return (
      motionEnabled && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    );
  }

  function drawHull(group: TaskHullMembership, now: number): void {
    const target = memberGeometry(group, currentPositions);
    if (!target) {
      morphs.delete(group.taskId);
      return;
    }
    const morph = morphs.get(group.taskId);
    const scale = Math.max(0.01, zoomScale);
    let members = target;
    if (morph) {
      const anchor = target.find((member) => member.id === group.taskId) ?? target[0];
      const progress = (now - morph.startedAt) / playbackDuration(300, playbackSpeed);
      members = interpolateHullMembers(morph.from, target, anchor, progress);
      if (progress >= 1) morphs.delete(group.taskId);
    }
    renderedMembers.set(group.taskId, members);
    const elements = hullPaths.get(group.taskId);
    elements?.main?.setAttribute(
      'd',
      smoothClosedHullPath(paddedHull(members, HULL_PADDING / scale)) ?? '',
    );
    elements?.soft?.setAttribute(
      'd',
      smoothClosedHullPath(paddedHull(members, HULL_SOFT_PADDING / scale)) ?? '',
    );
  }

  function scheduleMorphFrame(): void {
    if (morphFrame !== null || morphs.size === 0) return;
    morphFrame = requestAnimationFrame((now) => {
      morphFrame = null;
      for (const group of memberships) drawHull(group, now);
      scheduleMorphFrame();
    });
  }

  function hullLayerMotion(element: SVGSVGElement) {
    const motion = activityMotion(element);
    const syncMotion = () => {
      motionEnabled = element.dataset.motionEnabled !== 'false';
    };
    const observer = new MutationObserver(syncMotion);
    observer.observe(element, { attributeFilter: ['data-motion-enabled'] });
    syncMotion();
    return {
      destroy() {
        observer.disconnect();
        motion?.destroy?.();
      },
    };
  }

  $effect(() => {
    currentPositions = positions;
  });

  $effect(() => {
    const activeTaskIds = new Set(memberships.map((group) => group.taskId));
    for (const group of memberships) {
      const target = memberGeometry(group, currentPositions);
      if (!target) continue;
      const previousIds = previousMemberIds.get(group.taskId);
      const changed = previousIds !== undefined && !sameMembers(previousIds, group.memberIds);
      if (changed && reshapeEnabled()) {
        morphs.set(group.taskId, {
          from: renderedMembers.get(group.taskId) ?? target,
          startedAt: performance.now(),
        });
      } else if (!morphs.has(group.taskId) || !reshapeEnabled()) {
        morphs.delete(group.taskId);
        renderedMembers.set(group.taskId, target);
      }
      previousMemberIds.set(group.taskId, [...group.memberIds]);
      drawHull(group, performance.now());
    }
    for (const taskId of previousMemberIds.keys()) {
      if (activeTaskIds.has(taskId)) continue;
      previousMemberIds.delete(taskId);
      renderedMembers.delete(taskId);
      morphs.delete(taskId);
    }
    scheduleMorphFrame();
  });

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

  export function updatePositions(latestPositions: Map<string, Position>): void {
    currentPositions = latestPositions;
    for (const group of memberships) {
      drawHull(group, performance.now());
    }
  }

  onDestroy(() => {
    if (morphFrame !== null) cancelAnimationFrame(morphFrame);
  });

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
  use:hullLayerMotion
  class="hull-layer pointer-events-none absolute inset-0 h-full w-full overflow-visible"
  aria-hidden="true"
>
  {#each memberships as group (group.taskId)}
    {@const paths = pathsFor(group, positions)}
    {@const taskIndex = nodes.findIndex((node) => node.id === group.taskId)}
    <g
      class="task-hull-shape"
      in:activityHullTransition={{
        delay: nodeEnterDelay(Math.max(0, taskIndex) + 1, playbackSpeed),
        playbackSpeed,
      }}
      out:activityHullTransition={{ exit: true, playbackSpeed }}
    >
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
        stroke={isWorking(group) ? 'var(--color-foreground)' : 'none'}
        stroke-opacity={isWorking(group) ? 0.18 : undefined}
        stroke-width={isWorking(group) ? 0.75 : undefined}
        vector-effect="non-scaling-stroke"
        data-task-id={group.taskId}
        data-working={isWorking(group)}
        data-highlighted={containsFocus(group)}
        data-dimmed={activeFocusNodeId !== null && !containsFocus(group)}
      />
    </g>
  {/each}
</svg>

<style>
  .task-hull-shape {
    transform-box: fill-box;
    transform-origin: center;
  }
  .task-hull-fill {
    transition: fill-opacity 200ms ease;
  }
  :global(.hull-layer[data-motion-enabled='false']) .task-hull-fill {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .task-hull-fill {
      transition: none;
    }
  }
</style>
