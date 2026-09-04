<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { createConstellationLayout, type ConstellationLayout } from './constellation-layout';
  import GraphEdgeLayer, { type GraphPosition } from './GraphEdgeLayer.svelte';
  import AgentOrbNode from './nodes/AgentOrbNode.svelte';
  import ResourceNode from './nodes/ResourceNode.svelte';
  import TaskAnchorNode from './nodes/TaskAnchorNode.svelte';
  import {
    GRAPH_FIT_PADDING,
    GRAPH_ZOOM_EXTENT,
    MAX_VISIBLE_RESOURCES_PER_AGENT,
  } from './constants';
  import type { AgentNode, FileNode, GraphNode, GraphState, NoteNode } from './types';

  export interface GraphLayers {
    files: boolean;
    notes: boolean;
    messages: boolean;
  }

  interface Props {
    graph: GraphState;
    onAgentClick: (agentId: string, event: MouseEvent) => void;
    onTaskClick: (taskId: string, event: MouseEvent) => void;
    onNoteClick: (noteId: string, event: MouseEvent) => void;
    onFileClick: (path: string, event: MouseEvent) => void;
    layers: GraphLayers;
    fitRequest?: number;
    showFitControl?: boolean;
  }

  let {
    graph,
    onAgentClick,
    onTaskClick,
    onNoteClick,
    onFileClick,
    layers,
    fitRequest = 0,
    showFitControl = true,
  }: Props = $props();
  let container: HTMLDivElement;
  let scene = $state<HTMLDivElement>();
  let layout: ConstellationLayout | null = null;
  let zoomBehavior: ZoomBehavior<HTMLDivElement, unknown> | null = null;
  let zoomScale = $state(1);
  let positions = $state<Map<string, GraphPosition>>(new Map());
  let expandedAgentIds = $state<Set<string>>(new Set());
  let spotlightNodeId = $state<string | null>(null);
  let previousNodeCount = 0;
  let autoFitPending = false;
  let pendingPositions = new Map<string, GraphPosition>();
  let frame: number | null = null;
  let unsubscribeTick: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let dragState = $state<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    moved: boolean;
  } | null>(null);
  const suppressedClicks = new Set<string>();

  const visibleGraph = $derived.by(() => {
    const baseNodes = graph.nodes.filter(
      (node) => (node.type !== 'file' || layers.files) && (node.type !== 'note' || layers.notes),
    );
    const nodeById = new Map(baseNodes.map((node) => [node.id, node]));
    const resourceEdges = graph.edges.filter(
      (edge) =>
        nodeById.has(edge.sourceId) &&
        nodeById.has(edge.targetId) &&
        (edge.type.startsWith('file-') || edge.type.startsWith('note-')),
    );
    const allowedResourceEdges = new Set<string>();
    const collapsedByAgent = new Map<string, number>();

    for (const agent of baseNodes.filter((node): node is AgentNode => node.type === 'agent')) {
      const interactions = resourceEdges.filter((edge) => edge.sourceId === agent.id);
      const resourceIds = [...new Set(interactions.map((edge) => edge.targetId))].sort(
        (a, b) => resourceTimestamp(nodeById.get(b)) - resourceTimestamp(nodeById.get(a)),
      );
      const visibleCount = expandedAgentIds.has(agent.id)
        ? resourceIds.length
        : MAX_VISIBLE_RESOURCES_PER_AGENT;
      const visibleResourceIds = new Set(resourceIds.slice(0, visibleCount));
      interactions
        .filter((edge) => visibleResourceIds.has(edge.targetId))
        .forEach((edge) => allowedResourceEdges.add(edge.id));
      if (resourceIds.length > visibleCount) {
        collapsedByAgent.set(agent.id, resourceIds.length - visibleCount);
      }
    }

    const edges = graph.edges.filter((edge) => {
      if (!nodeById.has(edge.sourceId) || !nodeById.has(edge.targetId)) return false;
      if (edge.type === 'message' && !layers.messages) return false;
      if (edge.type.startsWith('file-') || edge.type.startsWith('note-')) {
        return allowedResourceEdges.has(edge.id);
      }
      return true;
    });
    const connectedResources = new Set(
      edges
        .filter((edge) => edge.type.startsWith('file-') || edge.type.startsWith('note-'))
        .map((edge) => edge.targetId),
    );
    const nodes = baseNodes.filter(
      (node) => (node.type !== 'file' && node.type !== 'note') || connectedResources.has(node.id),
    );
    return { nodes, edges, collapsedByAgent };
  });

  const spotlightIds = $derived.by(() => {
    if (!spotlightNodeId) return null;
    const ids = new Set([spotlightNodeId]);
    for (const edge of visibleGraph.edges) {
      if (edge.sourceId === spotlightNodeId) ids.add(edge.targetId);
      if (edge.targetId === spotlightNodeId) ids.add(edge.sourceId);
    }
    return ids;
  });

  const hasPrimaryNodes = $derived(
    graph.nodes.some((node) => node.type === 'agent' || node.type === 'task'),
  );

  function resourceTimestamp(node: GraphNode | undefined): number {
    if (!node || (node.type !== 'file' && node.type !== 'note')) return 0;
    return Date.parse(node.lastActionTimestamp) || 0;
  }

  function publishPositions(nodes: GraphNode[], alpha = 1): void {
    pendingPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      positions = pendingPositions;
      frame = null;
      if (autoFitPending && alpha < 0.01) {
        autoFitPending = false;
        fitToView();
      }
    });
  }

  function updateLayout(): void {
    if (!layout) return;
    layout.update(visibleGraph.nodes, visibleGraph.edges);
    const count = visibleGraph.nodes.length;
    const shouldFit =
      previousNodeCount === 0 || Math.abs(count - previousNodeCount) > previousNodeCount * 0.5;
    previousNodeCount = count;
    if (shouldFit && count > 0) {
      autoFitPending = true;
      requestAnimationFrame(fitToView);
    }
  }

  function fitToView(): void {
    if (!layout || !zoomBehavior || !container || visibleGraph.nodes.length === 0) return;
    const bounds = layout.fitBounds();
    const width = container.clientWidth;
    const height = container.clientHeight;
    const [minimumScale, maximumScale] = GRAPH_ZOOM_EXTENT;
    const scale = Math.max(
      minimumScale,
      Math.min(
        maximumScale,
        Math.min(
          width / Math.max(1, bounds.width + GRAPH_FIT_PADDING * 2),
          height / Math.max(1, bounds.height + GRAPH_FIT_PADDING * 2),
        ),
      ),
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    select(container).call(
      zoomBehavior.transform,
      zoomIdentity
        .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
        .scale(scale),
    );
  }

  function handleCanvasDoubleClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && !target.closest('[data-graph-node], [data-graph-controls]')) {
      fitToView();
    }
  }

  function handlePointerDown(node: GraphNode, event: PointerEvent): void {
    if (event.button !== 0 || !layout) return;
    event.stopPropagation();
    const position = positions.get(node.id) ?? node;
    dragState = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: position.x,
      nodeY: position.y,
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId || !layout) return;
    const dx = (event.clientX - dragState.startX) / zoomScale;
    const dy = (event.clientY - dragState.startY) / zoomScale;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragState.moved = true;
    if (dragState.moved) layout.pin(dragState.id, dragState.nodeX + dx, dragState.nodeY + dy);
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (dragState.moved) suppressedClicks.add(dragState.id);
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId))
      target.releasePointerCapture?.(event.pointerId);
    dragState = null;
  }

  function handleNodeClick(node: GraphNode, event: MouseEvent): void {
    if (suppressedClicks.delete(node.id)) {
      event.preventDefault();
      return;
    }
    if (node.type === 'agent') onAgentClick(node.agentId, event);
    else if (node.type === 'task') onTaskClick(node.taskId, event);
    else if (node.type === 'note') onNoteClick(node.noteId, event);
    else onFileClick(node.path, event);
  }

  function handleNodeDoubleClick(node: GraphNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    layout?.unpin(node.id);
  }

  function resourceAccess(node: FileNode | NoteNode): {
    access: 'read' | 'write';
    additions: number;
    deletions: number;
    isActive: boolean;
    lastActivityAt?: string;
  } {
    const edges = visibleGraph.edges.filter((edge) => edge.targetId === node.id);
    const writes = edges.filter((edge) => edge.type === 'file-write' || edge.type === 'note-write');
    const latest = edges.toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    return {
      access: writes.length > 0 ? 'write' : 'read',
      additions: writes.reduce((sum, edge) => sum + (edge.additions ?? 0), 0),
      deletions: writes.reduce((sum, edge) => sum + (edge.deletions ?? 0), 0),
      isActive: edges.some((edge) => edge.isActive),
      lastActivityAt: latest?.timestamp,
    };
  }

  function nodeActivity(node: GraphNode): { isActive: boolean; lastActivityAt?: string } {
    const incident = visibleGraph.edges.filter(
      (edge) => edge.sourceId === node.id || edge.targetId === node.id,
    );
    const latest = incident.toSorted(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    )[0];
    const assignedAgentIsActive =
      node.type === 'task' &&
      incident
        .filter((edge) => edge.type === 'task-assignment' && edge.targetId === node.id)
        .some((edge) => {
          const agent = visibleGraph.nodes.find((candidate) => candidate.id === edge.sourceId);
          return agent?.type === 'agent' && agent.status === 'responding';
        });
    return {
      isActive:
        node.type === 'agent'
          ? node.status === 'responding'
          : assignedAgentIsActive || incident.some((edge) => edge.isActive),
      lastActivityAt: latest?.timestamp,
    };
  }

  function nodeEvents(node: GraphNode) {
    return {
      onclick: (event: MouseEvent) => handleNodeClick(node, event),
      ondblclick: (event: MouseEvent) => handleNodeDoubleClick(node, event),
      onpointerdown: (event: PointerEvent) => handlePointerDown(node, event),
      onpointermove: handlePointerMove,
      onpointerup: handlePointerEnd,
      onpointercancel: handlePointerEnd,
      onmouseenter: () => (spotlightNodeId = node.id),
      onmouseleave: () => (spotlightNodeId = null),
      onfocus: () => (spotlightNodeId = node.id),
      onblur: () => (spotlightNodeId = null),
    };
  }

  function expandResources(agentId: string, event: MouseEvent): void {
    event.stopPropagation();
    expandedAgentIds = new Set(expandedAgentIds).add(agentId);
  }

  $effect(() => {
    void visibleGraph;
    updateLayout();
  });

  $effect(() => {
    if (fitRequest > 0 && layout) requestAnimationFrame(fitToView);
  });

  onMount(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    layout = createConstellationLayout({ width, height });
    layout.update(visibleGraph.nodes, visibleGraph.edges);
    autoFitPending = true;
    unsubscribeTick = layout.tick(publishPositions);
    zoomBehavior = zoom<HTMLDivElement, unknown>()
      .scaleExtent(GRAPH_ZOOM_EXTENT)
      .filter((event) => {
        if (event.type === 'wheel') return true;
        const target = event.target;
        return (
          !(target instanceof Element) ||
          !target.closest('[data-graph-node], [data-graph-controls]')
        );
      })
      .on('zoom', (event) => {
        zoomScale = event.transform.k;
        if (scene) {
          scene.style.transform = `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
        }
      });
    select(container).call(zoomBehavior).on('dblclick.zoom', null);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => fitToView());
      resizeObserver.observe(container);
    }
    previousNodeCount = visibleGraph.nodes.length;
    requestAnimationFrame(fitToView);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    unsubscribeTick?.();
    layout?.stop();
    if (frame !== null) cancelAnimationFrame(frame);
  });
</script>

<div
  bind:this={container}
  class="relative h-full min-h-64 w-full touch-none overflow-hidden bg-background"
  class:cursor-grabbing={dragState !== null}
  class:cursor-grab={dragState === null}
  ondblclick={handleCanvasDoubleClick}
  role="application"
  aria-label={m.ui_zoomPanViewport_viewport_ariaLabel()}
  data-agent-activity-graph
>
  {#if !hasPrimaryNodes}
    <div class="absolute inset-0 flex items-center justify-center text-center text-subtle">
      <div>
        <p class="text-lg font-medium">{m.agentOverview_hierarchyGraph_noAgents_title()}</p>
        <p class="mt-1 text-sm">{m.agentOverview_hierarchyGraph_noAgents_description()}</p>
      </div>
    </div>
  {:else}
    <div
      bind:this={scene}
      class="graph-scene absolute inset-0 origin-top-left will-change-transform"
    >
      <GraphEdgeLayer
        edges={visibleGraph.edges}
        nodes={visibleGraph.nodes}
        {positions}
        {spotlightNodeId}
      />
      {#each visibleGraph.nodes as node (node.id)}
        {@const position = positions.get(node.id) ?? node}
        {@const activity = nodeActivity(node)}
        <div
          class="absolute transition-opacity"
          class:opacity-15={spotlightIds !== null && !spotlightIds.has(node.id)}
          style:transform={`translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`}
          style:z-index={node.type === 'task' ? 2 : node.type === 'agent' ? 3 : 1}
        >
          {#if node.type === 'task'}
            <TaskAnchorNode {node} {...activity} {...nodeEvents(node)} />
          {:else if node.type === 'agent'}
            <AgentOrbNode {node} {...activity} {...nodeEvents(node)} />
            {#if visibleGraph.collapsedByAgent.has(node.id)}
              <Button
                type="button"
                variant="default"
                size="xs"
                class="absolute left-1/2 top-full mt-1 h-6 -translate-x-1/2 rounded-full font-mono text-[10px] text-muted-foreground"
                aria-label={m.ui_groupedCombobox_expandGroup_label()}
                onclick={(event) => expandResources(node.id, event)}
                data-graph-controls
              >
                +{visibleGraph.collapsedByAgent.get(node.id)}
              </Button>
            {/if}
          {:else}
            {@const access = resourceAccess(node)}
            <ResourceNode {node} {...access} {...nodeEvents(node)} />
          {/if}
        </div>
      {/each}
    </div>

    {#if showFitControl}
      <Button
        variant="default"
        size="icon-lg"
        iconOnly
        class="absolute bottom-4 right-4 text-muted-foreground"
        tooltip={m.agentOverview_hierarchyGraph_fitToView_tooltip()}
        aria-label={m.agentOverview_hierarchyGraph_fitToView_tooltip()}
        onclick={fitToView}
        data-graph-controls
      >
        <Fa icon={faExpand} size="sm" />
      </Button>
    {/if}
  {/if}
</div>
