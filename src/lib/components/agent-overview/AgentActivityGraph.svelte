<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { easeCubicOut, select, zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3';
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    createConstellationLayout,
    SMALL_GRAPH_FIT_SCALE,
    type ConstellationLayout,
  } from './constellation-layout';
  import GraphEdgeLayer, { type GraphPosition } from './GraphEdgeLayer.svelte';
  import GraphHullLayer from './GraphHullLayer.svelte';
  import GraphNodeDetailCard, { type GraphNodeRecentEvent } from './GraphNodeDetailCard.svelte';
  import AgentOrbNode from './nodes/AgentOrbNode.svelte';
  import ResourceNode from './nodes/ResourceNode.svelte';
  import TaskAnchorNode from './nodes/TaskAnchorNode.svelte';
  import {
    GRAPH_FIT_PADDING,
    GRAPH_ZOOM_EXTENT,
    MAX_VISIBLE_RESOURCES_PER_AGENT,
  } from './constants';
  import type { AgentNode, FileNode, GraphNode, GraphState, NoteNode } from './types';
  import { nodeEnterDelay } from './activity-motion';
  import type { PlaybackSpeed } from './playback';
  import { createTaskHullMembershipMemo } from './graph-helpers';
  import { createGraphRenderIndexMemo } from './graph-render-index';
  import { anchorFitBounds, containedAnchorFitScale } from './graph-fit';

  export interface GraphLayers {
    agents?: boolean;
    tasks?: boolean;
    files: boolean;
    notes: boolean;
    messages: boolean;
  }

  export type GraphZoomAction = 'in' | 'out' | 'reset';

  export type GraphOpenEvent = MouseEvent | KeyboardEvent;

  interface Props {
    graph: GraphState;
    onAgentClick: (agentId: string, event: GraphOpenEvent) => void;
    onTaskClick: (taskId: string, event: GraphOpenEvent) => void;
    onNoteClick: (noteId: string, event: GraphOpenEvent) => void;
    onFileClick: (path: string, event: GraphOpenEvent) => void;
    layers: GraphLayers;
    fitRequest?: number;
    zoomRequest?: { id: number; action: GraphZoomAction };
    onZoomChange?: (scale: number) => void;
    showFitControl?: boolean;
    showEmptyState?: boolean;
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
    zoomRequest,
    onZoomChange,
    showFitControl = true,
    showEmptyState = true,
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
  const latestPositions = { current: new Map<string, GraphPosition>() };
  let edgeLayer = $state<
    { updatePositions: (positions: Map<string, GraphPosition>) => void } | undefined
  >();
  let hullLayer = $state<
    { updatePositions: (positions: Map<string, GraphPosition>) => void } | undefined
  >();
  let expandedAgentIds = $state<Set<string>>(new Set());
  let previousNodeIds = '';
  let autoFitPending = false;
  let autoFitTransitionActive = false;
  let autoFitQueued = false;
  let pendingPositions = new Map<string, GraphPosition>();
  const positionedNodes = new Map<string, HTMLElement>();
  let frame: number | null = null;
  let fitFrame: number | null = null;
  let deferredFit: (() => void) | null = null;
  let unsubscribeTick: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeFitTimeout: ReturnType<typeof setTimeout> | null = null;
  let hasManualTransform = false;
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
  type FitInsets = { top: number; right: number; bottom: number; left: number };

  const FIT_FALLBACK_INSETS: FitInsets = { top: 56, right: 24, bottom: 72, left: 24 };
  const FIT_CHROME_GAP = 8;
  const TASK_LABEL_VISIBLE_SCALE = 0.3;
  const MINIMUM_VIEWPORT_FILL = 0.4;
  const RESIZE_FIT_DEBOUNCE_MS = 120;

  const visibleGraph = $derived.by(() => {
    const baseNodes = graph.nodes.filter(
      (node) =>
        (node.type !== 'agent' || layers.agents !== false) &&
        (node.type !== 'task' || layers.tasks !== false) &&
        (node.type !== 'file' || layers.files) &&
        (node.type !== 'note' || layers.notes),
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
  const memoizedHullMemberships = createTaskHullMembershipMemo();
  const hullMemberships = $derived(memoizedHullMemberships(visibleGraph.nodes, visibleGraph.edges));
  const memoizedRenderIndex = createGraphRenderIndexMemo();
  const renderIndex = $derived(memoizedRenderIndex(visibleGraph.nodes, visibleGraph.edges));
  const visibleNodeById = $derived(new Map(visibleGraph.nodes.map((node) => [node.id, node])));
  const selectedNode = $derived(selectedNodeId ? visibleNodeById.get(selectedNodeId) : undefined);
  const selectedNodeEvents = $derived.by<GraphNodeRecentEvent[]>(() => {
    if (!selectedNodeId) return [];
    return visibleGraph.edges
      .filter((edge) => edge.sourceId === selectedNodeId || edge.targetId === selectedNodeId)
      .toSorted((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 6)
      .map((edge) => {
        const counterpartId = edge.sourceId === selectedNodeId ? edge.targetId : edge.sourceId;
        const counterpart = visibleNodeById.get(counterpartId);
        return {
          id: `${edge.id}:${edge.timestamp}`,
          label: counterpart
            ? `${edge.type.replaceAll('-', ' ')} · ${nodeDisplayName(counterpart)}`
            : edge.type.replaceAll('-', ' '),
          timestamp: edge.timestamp,
        };
      });
  });

  const activeHoverNodeId = $derived(hoveredNodeId === dismissedHoverNodeId ? null : hoveredNodeId);
  const focusNodeId = $derived(selectedNodeId ?? activeHoverNodeId ?? keyboardNodeId);
  const focusIds = $derived.by(() => {
    if (!focusNodeId) return null;
    const ids = new Set([focusNodeId]);
    for (const edge of visibleGraph.edges) {
      if (edge.sourceId === focusNodeId) ids.add(edge.targetId);
      if (edge.targetId === focusNodeId) ids.add(edge.sourceId);
    }
    return ids;
  });
  const renderedAgentLabelPx = $derived(zoomScale * Math.max(13, Math.min(13 / zoomScale, 31.5)));
  const renderedTaskLabelPx = $derived(zoomScale * Math.max(17, Math.min(17 / zoomScale, 40)));
  const zoomBand = $derived<ZoomBand>(
    renderedAgentLabelPx >= 11 ? 'full' : renderedTaskLabelPx >= 12 ? 'mid' : 'far',
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

  function nodeDisplayName(node: GraphNode): string {
    if (node.type === 'agent') return node.name;
    if (node.type === 'file') return node.fileName;
    return node.title;
  }

  function assignedAgentCount(taskId: string): number {
    return new Set(
      visibleGraph.edges
        .filter((edge) => edge.type === 'task-assignment' && edge.targetId === taskId)
        .map((edge) => edge.sourceId),
    ).size;
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
      for (const [id, position] of pendingPositions) {
        const element = positionedNodes.get(id);
        if (element) {
          element.style.transform = `translate(${position.x}px, ${position.y}px) translate(-50%, -50%)`;
        }
      }
      latestPositions.current = pendingPositions;
      edgeLayer?.updatePositions(pendingPositions);
      hullLayer?.updatePositions(pendingPositions);
      frame = null;
      if (autoFitPending && alpha < 0.01) {
        autoFitPending = false;
        fitAutomatically();
      }
    });
  }

  function positionGraphNode(element: HTMLElement, initialId: string) {
    let id = initialId;
    positionedNodes.set(id, element);
    return {
      update(nextId: string) {
        if (nextId === id) return;
        positionedNodes.delete(id);
        id = nextId;
        positionedNodes.set(id, element);
      },
      destroy() {
        positionedNodes.delete(id);
      },
    };
  }

  function scheduleFit(fit: () => void): void {
    deferredFit = fit;
    if (fitFrame !== null) return;
    fitFrame = requestAnimationFrame(() => {
      fitFrame = null;
      const pendingFit = deferredFit;
      deferredFit = null;
      pendingFit?.();
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
        scheduleFit(() => {
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
    hasManualTransform = false;
    applyFit(false);
  }

  function applyZoomRequest(action: GraphZoomAction): void {
    if (!zoomBehavior || !container) return;
    hasManualTransform = true;
    const selection = select(container).interrupt('graph-fit').interrupt('graph-focus');
    if (action === 'reset') selection.call(zoomBehavior.scaleTo, 1);
    else selection.call(zoomBehavior.scaleBy, action === 'in' ? 1.25 : 0.8);
  }

  function applyFit(coalesce: boolean): void {
    if (!layout || !zoomBehavior || !container || visibleGraph.nodes.length === 0) return;
    applyBounds(coalesce);
  }

  function measuredFitInsets(): FitInsets {
    const viewport = container.getBoundingClientRect();
    const measured: Partial<FitInsets> = {};
    const chrome = (container.parentElement ?? container).querySelectorAll<HTMLElement>(
      '[data-graph-controls], [data-time-scrubber]',
    );
    for (const element of chrome) {
      if (element.closest('.graph-scene')) continue;
      const bounds = element.getBoundingClientRect();
      if (
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        bounds.right <= viewport.left ||
        bounds.left >= viewport.right ||
        bounds.bottom <= viewport.top ||
        bounds.top >= viewport.bottom
      ) {
        continue;
      }
      if (element.matches('[data-time-scrubber]')) {
        measured.bottom = Math.max(
          measured.bottom ?? 0,
          viewport.bottom - bounds.top + FIT_CHROME_GAP,
        );
        continue;
      }
      const distances = [
        ['top', Math.abs(bounds.top - viewport.top)],
        ['right', Math.abs(viewport.right - bounds.right)],
        ['bottom', Math.abs(viewport.bottom - bounds.bottom)],
        ['left', Math.abs(bounds.left - viewport.left)],
      ] as const;
      const side = distances.reduce((closest, candidate) =>
        candidate[1] < closest[1] ? candidate : closest,
      )[0];
      const inset =
        side === 'top'
          ? bounds.bottom - viewport.top
          : side === 'right'
            ? viewport.right - bounds.left
            : side === 'bottom'
              ? viewport.bottom - bounds.top
              : bounds.right - viewport.left;
      measured[side] = Math.max(measured[side] ?? 0, inset + FIT_CHROME_GAP);
    }
    return {
      top: measured.top ?? FIT_FALLBACK_INSETS.top,
      right: measured.right ?? FIT_FALLBACK_INSETS.right,
      bottom: measured.bottom ?? FIT_FALLBACK_INSETS.bottom,
      left: measured.left ?? FIT_FALLBACK_INSETS.left,
    };
  }

  function applyBounds(coalesce: boolean, nodes = visibleGraph.nodes): void {
    if (!zoomBehavior || !container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const insets = measuredFitInsets();
    const availableWidth = Math.max(1, width - insets.left - insets.right);
    const availableHeight = Math.max(1, height - insets.top - insets.bottom);
    const maximumScale = GRAPH_ZOOM_EXTENT[1];
    const naturalScale = containedAnchorFitScale(
      nodes,
      latestPositions.current,
      availableWidth,
      availableHeight,
      maximumScale,
    );
    const minimumScale = Math.min(
      maximumScale,
      Math.max(GRAPH_ZOOM_EXTENT[0], naturalScale * MINIMUM_VIEWPORT_FILL),
    );
    zoomBehavior.scaleExtent([minimumScale, maximumScale]);
    const scale = Math.min(
      maximumScale,
      nodes.length > 40
        ? Math.max(TASK_LABEL_VISIBLE_SCALE, naturalScale)
        : Math.max(SMALL_GRAPH_FIT_SCALE, naturalScale),
    );
    const bounds = anchorFitBounds(nodes, latestPositions.current, scale);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const viewportCenterX = insets.left + availableWidth / 2;
    const viewportCenterY = insets.top + availableHeight / 2;
    const transform = zoomIdentity
      .translate(viewportCenterX - centerX * scale, viewportCenterY - centerY * scale)
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
    const position = latestPositions.current.get(node.id) ?? node;
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
    if (node.type === 'task') fitNodeCluster(node.id);
    else openNode(node, event);
  }

  function openNode(node: GraphNode, event: GraphOpenEvent): void {
    if (node.type === 'agent') onAgentClick(node.agentId, event);
    else if (node.type === 'task') onTaskClick(node.taskId, event);
    else if (node.type === 'note') onNoteClick(node.noteId, event);
    else onFileClick(node.path, event);
  }

  function fitNodeCluster(nodeId: string): void {
    const included = new Set([nodeId]);
    for (const edge of visibleGraph.edges) {
      if (edge.sourceId === nodeId) included.add(edge.targetId);
      if (edge.targetId === nodeId) included.add(edge.sourceId);
    }
    const selected = visibleNodeById.get(nodeId);
    if (selected?.type === 'task') {
      const agentIds = visibleGraph.nodes
        .filter((node) => node.type === 'agent' && parentIdFor(node.id) === nodeId)
        .map((node) => node.id);
      for (const node of visibleGraph.nodes) {
        if (
          (node.type === 'file' || node.type === 'note') &&
          agentIds.includes(parentIdFor(node.id) ?? '')
        ) {
          included.add(node.id);
        }
      }
    }
    const nodes = visibleGraph.nodes.filter((node) => included.has(node.id));
    if (nodes.length === 0) return;
    applyBounds(false, nodes);
  }

  function nodeElement(nodeId: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-graph-node]')).find(
      (element) => element.dataset.nodeId === nodeId,
    );
  }

  function ensureNodeVisible(nodeId: string): void {
    if (!zoomBehavior) return;
    const position =
      latestPositions.current.get(nodeId) ?? visibleGraph.nodes.find((node) => node.id === nodeId);
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
    hasManualTransform = true;
    autoFitPending = false;
    autoFitQueued = false;
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
    const aggregate = renderIndex.resourceAccessById.get(node.id);
    const source = aggregate?.lastWriteSourceId
      ? visibleNodeById.get(aggregate.lastWriteSourceId)
      : undefined;
    const target = visibleNodeById.get(node.id);
    const distance = source && target ? Math.hypot(source.x - target.x, source.y - target.y) : 0;
    return {
      access: aggregate?.access ?? 'read',
      additions: aggregate?.additions ?? 0,
      deletions: aggregate?.deletions ?? 0,
      isActive: aggregate?.isActive ?? false,
      lastActivityAt: aggregate?.lastActivityAt,
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
      [
        { boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-foreground) 28%, transparent)' },
        { boxShadow: '0 0 0 0 transparent' },
      ],
      { duration: 180, easing: 'ease-out' },
    );
  }

  function nodeActivity(node: GraphNode): { isActive: boolean; lastActivityAt?: string } {
    return renderIndex.nodeActivityById.get(node.id) ?? { isActive: false };
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
    if (fitRequest > 0 && layout) scheduleFit(fitToView);
  });

  $effect(() => {
    if (zoomRequest?.id && layout) applyZoomRequest(zoomRequest.action);
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
    const insets = measuredFitInsets();
    layout = createConstellationLayout({
      width,
      height,
      fitTarget: {
        width:
          Math.max(1, width - insets.left - insets.right - GRAPH_FIT_PADDING * 2) /
          SMALL_GRAPH_FIT_SCALE,
        height:
          Math.max(1, height - insets.top - insets.bottom - GRAPH_FIT_PADDING * 2) /
          SMALL_GRAPH_FIT_SCALE,
      },
    });
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
          hasManualTransform = true;
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
        onZoomChange?.(zoomScale);
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
      resizeObserver = new ResizeObserver(() => {
        if (resizeFitTimeout !== null) clearTimeout(resizeFitTimeout);
        resizeFitTimeout = setTimeout(() => {
          resizeFitTimeout = null;
          if (!hasManualTransform && layout) {
            const nextWidth = Math.max(1, container.clientWidth);
            const nextHeight = Math.max(1, container.clientHeight);
            const nextInsets = measuredFitInsets();
            layout.resize({
              width: nextWidth,
              height: nextHeight,
              fitTarget: {
                width:
                  Math.max(
                    1,
                    nextWidth - nextInsets.left - nextInsets.right - GRAPH_FIT_PADDING * 2,
                  ) / SMALL_GRAPH_FIT_SCALE,
                height:
                  Math.max(
                    1,
                    nextHeight - nextInsets.top - nextInsets.bottom - GRAPH_FIT_PADDING * 2,
                  ) / SMALL_GRAPH_FIT_SCALE,
              },
            });
            autoFitPending = true;
            applyFit(false);
          }
        }, RESIZE_FIT_DEBOUNCE_MS);
      });
      resizeObserver.observe(container);
    }
    previousNodeIds = visibleGraph.nodes
      .map((node) => node.id)
      .toSorted()
      .join('\0');
    scheduleFit(fitAutomatically);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (resizeFitTimeout !== null) clearTimeout(resizeFitTimeout);
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
    deferredFit = null;
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
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
    {#if showEmptyState}
      <div class="absolute inset-0 flex items-center justify-center text-center text-subtle">
        <div>
          <p class="text-lg font-medium">{m.agentOverview_hierarchyGraph_noAgents_title()}</p>
          <p class="mt-1 text-sm">{m.agentOverview_hierarchyGraph_noAgents_description()}</p>
        </div>
      </div>
    {/if}
  {:else}
    <div
      bind:this={scene}
      class="graph-scene absolute inset-0 origin-top-left will-change-transform"
      data-zoom-band={zoomBand}
      style:--zoom={zoomScale}
    >
      <GraphHullLayer
        bind:this={hullLayer}
        memberships={hullMemberships}
        nodes={visibleGraph.nodes}
        positions={latestPositions.current}
        {focusNodeId}
        {playbackSpeed}
      />
      <GraphEdgeLayer
        bind:this={edgeLayer}
        edges={visibleGraph.edges}
        nodes={visibleGraph.nodes}
        positions={latestPositions.current}
        {focusNodeId}
        {playbackSpeed}
        onMessageArrival={handleMessageArrival}
      />
      {#each visibleGraph.nodes as node, index (node.id)}
        {@const activity = nodeActivity(node)}
        <div
          use:positionGraphNode={node.id}
          class="absolute"
          style:transform={`translate(${node.x}px, ${node.y}px) translate(-50%, -50%)`}
          style:z-index={node.type === 'task' ? 2 : node.type === 'agent' ? 3 : 1}
        >
          {#if node.type === 'task'}
            <TaskAnchorNode
              {node}
              {...activity}
              agentCount={assignedAgentCount(node.id)}
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
            {#if visibleGraph.collapsedByAgent.has(node.id) && zoomBand !== 'far'}
              <Button
                type="button"
                variant="ghost-light"
                size="xs"
                class="absolute left-1/2 top-full mt-1 h-5 min-w-5 -translate-x-1/2 rounded-full px-1.5 type-caption text-muted-foreground"
                aria-label={m.agentOverview_resourceExpander_showMore_ariaLabel({
                  count: visibleGraph.collapsedByAgent.get(node.id) ?? 0,
                  agent: node.name,
                })}
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

    {#if selectedNode}
      <GraphNodeDetailCard
        node={selectedNode}
        events={selectedNodeEvents}
        onOpen={(event) => openNode(selectedNode, event)}
        onFitCluster={() => fitNodeCluster(selectedNode.id)}
      />
    {/if}

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
