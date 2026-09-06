<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { easeCubicOut, select, zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3';
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { createConstellationLayout, type ConstellationLayout } from './constellation-layout';
  import GraphEdgeLayer, { type GraphPosition } from './GraphEdgeLayer.svelte';
  import GraphHullLayer from './GraphHullLayer.svelte';
  import AgentOrbNode from './nodes/AgentOrbNode.svelte';
  import ResourceNode from './nodes/ResourceNode.svelte';
  import TaskAnchorNode from './nodes/TaskAnchorNode.svelte';
  import {
    GRAPH_FIT_PADDING,
    GRAPH_NODE_DIMENSIONS,
    GRAPH_ZOOM_EXTENT,
    MAX_VISIBLE_RESOURCES_PER_AGENT,
  } from './constants';
  import type { AgentNode, FileNode, GraphNode, GraphState, NoteNode } from './types';
  import { nodeEnterDelay } from './activity-motion';
  import type { PlaybackSpeed } from './playback';

  export interface GraphLayers {
    files: boolean;
    notes: boolean;
    messages: boolean;
  }

  export type GraphOpenEvent = MouseEvent | KeyboardEvent;

  interface Props {
    graph: GraphState;
    onAgentClick: (agentId: string, event: GraphOpenEvent) => void;
    onTaskClick: (taskId: string, event: GraphOpenEvent) => void;
    onNoteClick: (noteId: string, event: GraphOpenEvent) => void;
    onFileClick: (path: string, event: GraphOpenEvent) => void;
    layers: GraphLayers;
    fitRequest?: number;
    showFitControl?: boolean;
    playbackSpeed?: PlaybackSpeed;
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
    playbackSpeed = 1,
  }: Props = $props();
  let container: HTMLDivElement;
  let scene = $state<HTMLDivElement>();
  let layout: ConstellationLayout | null = null;
  let zoomBehavior: ZoomBehavior<HTMLDivElement, unknown> | null = null;
  let zoomScale = $state(1);
  let hoveredNodeId = $state<string | null>(null);
  let dismissedHoverNodeId = $state<string | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let keyboardNodeId = $state<string | null>(null);
  let spaceHeld = $state(false);
  let canvasPanning = $state(false);
  let positions = $state<Map<string, GraphPosition>>(new Map());
  let expandedAgentIds = $state<Set<string>>(new Set());
  let previousNodeIds = '';
  let autoFitPending = false;
  let autoFitTransitionActive = false;
  let autoFitQueued = false;
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
  type FocusState = 'focused' | 'neighbour' | 'dimmed' | 'none';
  type ZoomBand = 'full' | 'mid' | 'far';

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

  const activeHoverNodeId = $derived(hoveredNodeId === dismissedHoverNodeId ? null : hoveredNodeId);
  const focusNodeId = $derived(activeHoverNodeId ?? selectedNodeId ?? keyboardNodeId);
  const focusIds = $derived.by(() => {
    if (!focusNodeId) return null;
    const ids = new Set([focusNodeId]);
    for (const edge of visibleGraph.edges) {
      if (edge.sourceId === focusNodeId) ids.add(edge.targetId);
      if (edge.targetId === focusNodeId) ids.add(edge.sourceId);
    }
    return ids;
  });
  const zoomBand = $derived<ZoomBand>(
    zoomScale >= 0.6 ? 'full' : zoomScale >= 0.35 ? 'mid' : 'far',
  );

  const focusOrder = $derived.by(() => {
    const ordered: GraphNode[] = [];
    const added = new Set<string>();
    const append = (node: GraphNode | undefined) => {
      if (node && !added.has(node.id)) {
        added.add(node.id);
        ordered.push(node);
      }
    };
    const tasks = visibleGraph.nodes.filter((node) => node.type === 'task');
    const agents = visibleGraph.nodes
      .filter((node) => node.type === 'agent')
      .toSorted((a, b) => a.id.localeCompare(b.id));
    const resources = visibleGraph.nodes
      .filter((node) => node.type === 'file' || node.type === 'note')
      .toSorted((a, b) => a.id.localeCompare(b.id));
    for (const task of tasks) {
      append(task);
      const taskAgents = agents.filter((agent) => parentIdFor(agent.id) === task.id);
      for (const agent of taskAgents) {
        append(agent);
        resources.filter((resource) => parentIdFor(resource.id) === agent.id).forEach(append);
      }
    }
    agents.forEach(append);
    resources.forEach(append);
    visibleGraph.nodes.forEach(append);
    return ordered;
  });

  const hasPrimaryNodes = $derived(
    graph.nodes.some((node) => node.type === 'agent' || node.type === 'task'),
  );

  function resourceTimestamp(node: GraphNode | undefined): number {
    if (!node || (node.type !== 'file' && node.type !== 'note')) return 0;
    return Date.parse(node.lastActionTimestamp) || 0;
  }

  function parentIdFor(nodeId: string): string | null {
    const node = visibleGraph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'task') return null;
    if (node.type === 'file' || node.type === 'note') {
      return (
        visibleGraph.edges.find(
          (edge) => edge.targetId === node.id && edge.sourceId.startsWith('agent:'),
        )?.sourceId ?? null
      );
    }
    return (
      visibleGraph.edges.find(
        (edge) => edge.type === 'task-assignment' && edge.sourceId === node.id,
      )?.targetId ??
      visibleGraph.edges.find((edge) => edge.type === 'delegation' && edge.targetId === node.id)
        ?.sourceId ??
      null
    );
  }

  function childrenFor(nodeId: string): GraphNode[] {
    return focusOrder.filter((node) => parentIdFor(node.id) === nodeId);
  }

  function focusStateFor(nodeId: string): FocusState {
    if (!focusNodeId || !focusIds) return 'none';
    if (nodeId === focusNodeId) return 'focused';
    return focusIds.has(nodeId) ? 'neighbour' : 'dimmed';
  }

  function publishPositions(nodes: GraphNode[], alpha = 1): void {
    pendingPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      positions = pendingPositions;
      frame = null;
      if (autoFitPending && alpha < 0.01) {
        autoFitPending = false;
        fitAutomatically();
      }
    });
  }

  function updateLayout(): void {
    if (!layout) return;
    const nodeIds = visibleGraph.nodes
      .map((node) => node.id)
      .toSorted()
      .join('\0');
    const nodeSetChanged = nodeIds !== previousNodeIds;
    previousNodeIds = nodeIds;
    layout.update(visibleGraph.nodes, visibleGraph.edges);
    if (nodeSetChanged) {
      autoFitPending = visibleGraph.nodes.length > 0;
      if (autoFitPending) {
        requestAnimationFrame(() => {
          if (autoFitPending) fitAutomatically();
        });
      }
    }
  }

  function finishAutoFitTransition(): void {
    autoFitTransitionActive = false;
    if (!autoFitQueued) return;
    autoFitQueued = false;
    fitAutomatically();
  }

  function fitAutomatically(): void {
    applyFit(true);
  }

  function fitToView(): void {
    applyFit(false);
  }

  function applyFit(coalesce: boolean): void {
    if (!layout || !zoomBehavior || !container || visibleGraph.nodes.length === 0) return;
    const bounds = layout.fitBounds();
    applyBounds(bounds, coalesce);
  }

  function applyBounds(
    bounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      width: number;
      height: number;
    },
    coalesce: boolean,
  ): void {
    if (!zoomBehavior || !container) return;
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
    const transform = zoomIdentity
      .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
      .scale(scale);
    const selection = select(container);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) {
      autoFitQueued = false;
      selection.interrupt('graph-fit');
      selection.call(zoomBehavior.transform, transform);
      return;
    }
    if (coalesce && autoFitTransitionActive) {
      autoFitQueued = true;
      return;
    }
    autoFitQueued = false;
    selection.interrupt('graph-fit');
    autoFitTransitionActive = true;
    selection
      .transition('graph-fit')
      .duration(250)
      .ease(easeCubicOut)
      .call(zoomBehavior.transform, transform)
      .on('end.graph-fit', finishAutoFitTransition)
      .on('interrupt.graph-fit', () => (autoFitTransitionActive = false));
  }

  function handleCanvasDoubleClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && !target.closest('[data-graph-node], [data-graph-controls]')) {
      fitToView();
    }
  }

  function canvasTarget(target: EventTarget | null): boolean {
    return (
      !(target instanceof Element) || !target.closest('[data-graph-node], [data-graph-controls]')
    );
  }

  function handleCanvasClick(event: MouseEvent): void {
    if (!canvasTarget(event.target)) return;
    selectedNodeId = null;
    keyboardNodeId = null;
    container.focus({ preventScroll: true });
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
    const nodeId = (event.currentTarget as HTMLElement).dataset.nodeId;
    if (nodeId === dismissedHoverNodeId) dismissedHoverNodeId = null;
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
    event.stopPropagation();
    selectedNodeId = node.id;
    keyboardNodeId = node.id;
  }

  function handleNodeDoubleClick(node: GraphNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (node.type === 'task') fitTaskCluster(node.id);
    else openNode(node, event);
  }

  function openNode(node: GraphNode, event: GraphOpenEvent): void {
    if (node.type === 'agent') onAgentClick(node.agentId, event);
    else if (node.type === 'task') onTaskClick(node.taskId, event);
    else if (node.type === 'note') onNoteClick(node.noteId, event);
    else onFileClick(node.path, event);
  }

  function fitTaskCluster(taskId: string): void {
    const included = new Set([taskId]);
    const agentIds = visibleGraph.nodes
      .filter((node) => node.type === 'agent' && parentIdFor(node.id) === taskId)
      .map((node) => node.id);
    agentIds.forEach((id) => included.add(id));
    for (const node of visibleGraph.nodes) {
      if (
        (node.type === 'file' || node.type === 'note') &&
        agentIds.includes(parentIdFor(node.id) ?? '')
      ) {
        included.add(node.id);
      }
    }
    const nodes = visibleGraph.nodes.filter((node) => included.has(node.id));
    const bounds = nodes.reduce(
      (result, node) => {
        const position = positions.get(node.id) ?? node;
        const dimensions = GRAPH_NODE_DIMENSIONS[node.type];
        result.minX = Math.min(result.minX, position.x - dimensions.width / 2);
        result.minY = Math.min(result.minY, position.y - dimensions.height / 2);
        result.maxX = Math.max(result.maxX, position.x + dimensions.width / 2);
        result.maxY = Math.max(result.maxY, position.y + dimensions.height / 2);
        return result;
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    if (!Number.isFinite(bounds.minX)) return;
    applyBounds(
      { ...bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
      false,
    );
  }

  function nodeElement(nodeId: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-graph-node]')).find(
      (element) => element.dataset.nodeId === nodeId,
    );
  }

  function ensureNodeVisible(nodeId: string): void {
    if (!zoomBehavior) return;
    const position = positions.get(nodeId) ?? visibleGraph.nodes.find((node) => node.id === nodeId);
    if (!position) return;
    const transform = zoomTransform(container);
    const inset = 48;
    const screenX = transform.applyX(position.x);
    const screenY = transform.applyY(position.y);
    const targetX = Math.max(inset, Math.min(container.clientWidth - inset, screenX));
    const targetY = Math.max(inset, Math.min(container.clientHeight - inset, screenY));
    if (targetX === screenX && targetY === screenY) return;
    const next = zoomIdentity
      .translate(transform.x + targetX - screenX, transform.y + targetY - screenY)
      .scale(transform.k);
    const selection = select(container).interrupt('graph-focus');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced) selection.call(zoomBehavior.transform, next);
    else
      selection
        .transition('graph-focus')
        .duration(220)
        .ease(easeCubicOut)
        .call(zoomBehavior.transform, next);
  }

  function focusNode(node: GraphNode): void {
    keyboardNodeId = node.id;
    nodeElement(node.id)?.focus({ preventScroll: true });
    ensureNodeVisible(node.id);
  }

  function handleGraphKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    const fromGraphNode = target instanceof Element && Boolean(target.closest('[data-graph-node]'));
    if (event.key === 'Escape') {
      dismissedHoverNodeId = hoveredNodeId;
      selectedNodeId = null;
      keyboardNodeId = null;
      container.focus({ preventScroll: true });
      return;
    }
    if (event.key === ' ' && (target === container || fromGraphNode)) {
      spaceHeld = true;
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && fromGraphNode && keyboardNodeId) {
      const node = visibleGraph.nodes.find((candidate) => candidate.id === keyboardNodeId);
      if (node) openNode(node, event);
      event.preventDefault();
      return;
    }
    if (!['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    if (!(target === container || fromGraphNode) || focusOrder.length === 0) return;
    const currentIndex = focusOrder.findIndex((node) => node.id === keyboardNodeId);
    let next: GraphNode | undefined;
    if (event.key === 'Tab') {
      const offset = event.shiftKey ? -1 : 1;
      const base = currentIndex < 0 ? (event.shiftKey ? 0 : -1) : currentIndex;
      next = focusOrder[(base + offset + focusOrder.length) % focusOrder.length];
    } else if (event.key === 'ArrowUp' && keyboardNodeId) {
      const parentId = parentIdFor(keyboardNodeId);
      next = focusOrder.find((node) => node.id === parentId);
    } else if (event.key === 'ArrowDown' && keyboardNodeId) {
      next = childrenFor(keyboardNodeId)[0];
    } else if (keyboardNodeId) {
      const parentId = parentIdFor(keyboardNodeId);
      const siblings = parentId
        ? childrenFor(parentId)
        : focusOrder.filter((node) => !parentIdFor(node.id));
      const siblingIndex = siblings.findIndex((node) => node.id === keyboardNodeId);
      const offset = event.key === 'ArrowLeft' ? -1 : 1;
      if (siblingIndex >= 0)
        next = siblings[(siblingIndex + offset + siblings.length) % siblings.length];
    }
    if (next) focusNode(next);
    event.preventDefault();
  }

  function handleGraphKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') spaceHeld = false;
  }

  function handleWindowBlur(): void {
    spaceHeld = false;
  }

  function handleWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey || !zoomBehavior) return;
    event.preventDefault();
    const factor =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? container.clientHeight
          : 1;
    const transform = zoomTransform(container);
    const next = transform.translate(
      (-event.deltaX * factor) / transform.k,
      (-event.deltaY * factor) / transform.k,
    );
    select(container)
      .interrupt('graph-fit')
      .interrupt('graph-focus')
      .call(zoomBehavior.transform, next);
  }

  function resourceAccess(node: FileNode | NoteNode): {
    access: 'read' | 'write';
    additions: number;
    deletions: number;
    isActive: boolean;
    lastActivityAt?: string;
    nudgeX: number;
    nudgeY: number;
  } {
    const edges = visibleGraph.edges.filter((edge) => edge.targetId === node.id);
    const writes = edges.filter((edge) => edge.type === 'file-write' || edge.type === 'note-write');
    const latest = edges.toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    const latestWrite = writes.toSorted(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    )[0];
    const source = latestWrite ? positions.get(latestWrite.sourceId) : undefined;
    const target = positions.get(node.id);
    const distance = source && target ? Math.hypot(source.x - target.x, source.y - target.y) : 0;
    return {
      access: writes.length > 0 ? 'write' : 'read',
      additions: writes.reduce((sum, edge) => sum + (edge.additions ?? 0), 0),
      deletions: writes.reduce((sum, edge) => sum + (edge.deletions ?? 0), 0),
      isActive: edges.some((edge) => edge.isActive),
      lastActivityAt: latest?.timestamp,
      nudgeX: source && target && distance > 0 ? ((source.x - target.x) / distance) * 2 : 0,
      nudgeY: source && target && distance > 0 ? ((source.y - target.y) / distance) * 2 : 0,
    };
  }

  function handleMessageArrival(targetId: string): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-graph-node]')).find(
      (element) => element.dataset.nodeId === targetId,
    );
    if (reduced || !target || target.dataset.motionEnabled === 'false') return;
    target.animate(
      [{ borderColor: 'var(--color-foreground)' }, { borderColor: 'var(--color-foreground)' }],
      { duration: 180, easing: 'ease-out' },
    );
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
      onmouseenter: () => (hoveredNodeId = node.id),
      onmouseleave: () => {
        hoveredNodeId = null;
        dismissedHoverNodeId = null;
      },
      onfocus: () => (keyboardNodeId = node.id),
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

  $effect(() => {
    const ids = new Set(visibleGraph.nodes.map((node) => node.id));
    if (selectedNodeId && !ids.has(selectedNodeId)) selectedNodeId = null;
    if (keyboardNodeId && !ids.has(keyboardNodeId)) keyboardNodeId = null;
    if (hoveredNodeId && !ids.has(hoveredNodeId)) hoveredNodeId = null;
    if (dismissedHoverNodeId && !ids.has(dismissedHoverNodeId)) dismissedHoverNodeId = null;
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
        if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
        if (event.type.startsWith('touch')) return canvasTarget(event.target);
        return event.type === 'mousedown' && spaceHeld && canvasTarget(event.target);
      })
      .on('start', (event) => {
        if (event.sourceEvent) {
          canvasPanning = true;
          select(container).interrupt('graph-fit').interrupt('graph-focus');
        }
      })
      .on('zoom', (event) => {
        if (event.sourceEvent) {
          autoFitPending = false;
          autoFitQueued = false;
          select(container).interrupt('graph-fit');
          select(container).interrupt('graph-focus');
        }
        zoomScale = event.transform.k;
        if (scene) {
          scene.style.transform = `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
        }
      })
      .on('end', () => (canvasPanning = false));
    select(container).call(zoomBehavior).on('dblclick.zoom', null);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('click', handleCanvasClick);
    container.addEventListener('dblclick', handleCanvasDoubleClick);
    container.addEventListener('keydown', handleGraphKeyDown);
    window.addEventListener('keyup', handleGraphKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => fitToView());
      resizeObserver.observe(container);
    }
    previousNodeIds = visibleGraph.nodes
      .map((node) => node.id)
      .toSorted()
      .join('\0');
    requestAnimationFrame(fitAutomatically);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    container?.removeEventListener('wheel', handleWheel);
    container?.removeEventListener('click', handleCanvasClick);
    container?.removeEventListener('dblclick', handleCanvasDoubleClick);
    container?.removeEventListener('keydown', handleGraphKeyDown);
    window.removeEventListener('keyup', handleGraphKeyUp);
    window.removeEventListener('blur', handleWindowBlur);
    unsubscribeTick?.();
    layout?.stop();
    select(container).interrupt('graph-fit');
    if (frame !== null) cancelAnimationFrame(frame);
  });
</script>

<div
  bind:this={container}
  class="relative h-full min-h-64 w-full touch-none overflow-hidden bg-background"
  class:cursor-grabbing={spaceHeld && canvasPanning}
  class:cursor-grab={spaceHeld && !canvasPanning}
  tabindex="-1"
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
      data-zoom-band={zoomBand}
    >
      <GraphHullLayer
        edges={visibleGraph.edges}
        nodes={visibleGraph.nodes}
        {positions}
        {focusNodeId}
      />
      <GraphEdgeLayer
        edges={visibleGraph.edges}
        nodes={visibleGraph.nodes}
        {positions}
        {focusNodeId}
        {playbackSpeed}
        onMessageArrival={handleMessageArrival}
      />
      {#each visibleGraph.nodes as node, index (node.id)}
        {@const position = positions.get(node.id) ?? node}
        {@const activity = nodeActivity(node)}
        <div
          class="absolute"
          style:transform={`translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`}
          style:z-index={node.type === 'task' ? 2 : node.type === 'agent' ? 3 : 1}
        >
          {#if node.type === 'task'}
            <TaskAnchorNode
              {node}
              {...activity}
              enterDelay={nodeEnterDelay(index, playbackSpeed)}
              {playbackSpeed}
              focusState={focusStateFor(node.id)}
              {zoomBand}
              tabindex={node.id === (keyboardNodeId ?? focusOrder[0]?.id) ? 0 : -1}
              {...nodeEvents(node)}
            />
          {:else if node.type === 'agent'}
            <AgentOrbNode
              {node}
              {...activity}
              enterDelay={nodeEnterDelay(index, playbackSpeed)}
              {playbackSpeed}
              focusState={focusStateFor(node.id)}
              {zoomBand}
              tabindex={node.id === (keyboardNodeId ?? focusOrder[0]?.id) ? 0 : -1}
              {...nodeEvents(node)}
            />
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
            <ResourceNode
              {node}
              {...access}
              enterDelay={nodeEnterDelay(index, playbackSpeed)}
              {playbackSpeed}
              focusState={focusStateFor(node.id)}
              {zoomBand}
              tabindex={node.id === (keyboardNodeId ?? focusOrder[0]?.id) ? 0 : -1}
              {...nodeEvents(node)}
            />
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
