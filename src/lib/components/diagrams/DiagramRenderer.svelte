<script lang="ts">
  /* eslint-disable max-lines -- coordinated geometry, motion, and accessibility renderer */
  /**
   * Diagram Renderer
   *
   * Renders interactive diagrams with support for states, animations, and bindings
   */
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import { compactEdgeLabelMaxWidth, computeLayout, measureEdgeLabel } from './layout-engine';
  import type { ComputedLayout, NodeStyleConfig } from './types';
  import { DEFAULT_NODE_STYLE } from './types';
  import DiagramNodeHTML from './DiagramNodeHTML.svelte';
  import DiagramEdge from './DiagramEdge.svelte';
  import DiagramGroup from './DiagramGroup.svelte';
  import DiagramControls from './DiagramControls.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faCompress, faExpand } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onDestroy, onMount, tick } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    diagram: DiagramPrimitive;
    onUpdate?: (updates: Partial<DiagramPrimitive>) => void;
    editable?: boolean;
    /** Optional node style configuration for customizing font sizes, padding, etc. */
    styleConfig?: NodeStyleConfig;
    /** Callback for when a node binding is clicked */
    onBindingClick?: (e: MouseEvent, binding: { type: string; target: string }) => void;
    /** Resets transient fit and scroll state when an embedding view changes identity. */
    viewResetKey?: string;
  }

  interface EdgeLabelPosition {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  let {
    diagram,
    onUpdate,
    editable = false,
    styleConfig = DEFAULT_NODE_STYLE,
    onBindingClick,
    viewResetKey,
  }: Props = $props();

  const PADDING = 32;
  const PRIMARY_TEXT_FLOOR = 12;
  const SECONDARY_TEXT_FLOOR = 10;
  function motionDuration(duration: number): number {
    if (typeof document === 'undefined') return duration;
    return document.documentElement.classList.contains('catalog-reduced-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : duration;
  }

  // Computed layout
  let layout = $state<ComputedLayout | null>(null);
  let canvasBounds = $state<ComputedLayout['bounds'] | null>(null);
  let layoutError = $state(false);
  let fitToWidth = $state(false);
  let fitScale = $state(1);
  let layoutWidthLimit = $state(900);
  let canvasPadding = $derived(layoutWidthLimit < 500 ? 4 : PADDING);
  let renderStyleConfig = $derived(
    layoutWidthLimit < 500
      ? {
          ...styleConfig,
          maxWidth: Math.min(styleConfig.maxWidth, 150),
          maxLines: Math.max(styleConfig.maxLines, 5),
          paddingX: Math.min(styleConfig.paddingX, 10),
        }
      : styleConfig,
  );
  let fontMeasurementRevision = $state(0);

  onMount(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) fontMeasurementRevision += 1;
    });
    return () => {
      cancelled = true;
    };
  });

  // Current state - default to first state if not set
  // svelte-ignore state_referenced_locally - intentional: prop seeds the initial step; changeState() owns it afterwards and persists via onUpdate
  let currentStateId = $state(
    diagram.currentStateId ??
      (diagram.states && diagram.states.length > 0 ? diagram.states[0].id : undefined),
  );
  let currentState = $derived(diagram.states?.find((s) => s.id === currentStateId) ?? null);

  // Track state changes for animations
  let stateJustChanged = $state(false);
  let previousVisibleEdgeIds = $state<string[]>([]);
  const movingEdgeIds = new Set<string>();
  let rendererEl = $state<HTMLDivElement>();
  let diagramSettled = $state(true);
  let settlementRevision = 0;
  let settlementFrame: number | undefined;

  function activeFiniteAnimations() {
    if (!rendererEl?.getAnimations) return [];
    return rendererEl.getAnimations({ subtree: true }).filter((animation) => {
      const endTime = Number(animation.effect?.getComputedTiming().endTime);
      return (
        Number.isFinite(endTime) &&
        animation.playState !== 'finished' &&
        animation.playState !== 'idle'
      );
    });
  }

  function motionSnapshot() {
    if (!rendererEl) return '';
    const selector = [
      '.diagram-content',
      '.diagram-svg-layer',
      '.diagram-geometry-motion',
      '[data-group-id]',
      '.group-bg',
      '.group-label',
      '.diagram-edge',
      '.edge-path',
      '.edge-label-container',
      '[data-node-id]',
      '.diagram-node-html',
    ].join(',');
    return [...rendererEl.querySelectorAll<SVGElement | HTMLElement>(selector)]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [
          element.tagName,
          element.getAttribute('data-node-id'),
          element.getAttribute('data-edge-id'),
          element.getAttribute('data-group-id'),
          element.getAttribute('class'),
          element.getAttribute('d'),
          bounds.x.toFixed(3),
          bounds.y.toFixed(3),
          bounds.width.toFixed(3),
          bounds.height.toFixed(3),
          style.opacity,
          style.transform,
        ].join('|');
      })
      .join('\n');
  }

  function monitorDiagramSettlement(revision: number, previousSnapshot?: string) {
    settlementFrame = requestAnimationFrame(() => {
      if (revision !== settlementRevision) return;
      const snapshot = motionSnapshot();
      const active = movingEdgeIds.size > 0 || activeFiniteAnimations().length > 0;
      if (!active && previousSnapshot !== undefined && snapshot === previousSnapshot) {
        if (stateJustChanged) {
          stateJustChanged = false;
          settlementFrame = undefined;
          void tick().then(() => {
            if (revision === settlementRevision) monitorDiagramSettlement(revision);
          });
          return;
        }
        diagramSettled = true;
        settlementFrame = undefined;
        return;
      }
      monitorDiagramSettlement(revision, active ? undefined : snapshot);
    });
  }

  function beginDiagramSettlement() {
    settlementRevision += 1;
    const revision = settlementRevision;
    if (settlementFrame !== undefined) cancelAnimationFrame(settlementFrame);
    settlementFrame = undefined;
    if (motionDuration(1) === 0) {
      stateJustChanged = false;
      diagramSettled = true;
      return;
    }
    diagramSettled = false;
    queueMicrotask(() => {
      if (revision === settlementRevision) monitorDiagramSettlement(revision);
    });
  }

  onDestroy(() => {
    settlementRevision += 1;
    if (settlementFrame !== undefined) cancelAnimationFrame(settlementFrame);
  });

  // Hover state for highlighting connected nodes/edges
  let hoveredNodeId = $state<string | null>(null);
  let hoveredGroupId = $state<string | null>(null);

  // Calculate connected elements when hovering a node
  let connectedNodeIds = $derived.by(() => {
    if (!hoveredNodeId) return new Set<string>();

    const connected = new Set<string>();
    connected.add(hoveredNodeId);

    // Find all edges connected to the hovered node
    diagram.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId) {
        connected.add(edge.to);
      }
      if (edge.to === hoveredNodeId) {
        connected.add(edge.from);
      }
    });

    return connected;
  });

  let connectedEdgeIds = $derived.by(() => {
    if (!hoveredNodeId) return new Set<string>();

    const connected = new Set<string>();

    // Find all edges connected to the hovered node
    diagram.model.edges.forEach((edge) => {
      if (edge.from === hoveredNodeId || edge.to === hoveredNodeId) {
        connected.add(edge.id);
      }
    });

    return connected;
  });

  // Calculate which nodes belong to the hovered group
  let groupNodeIds = $derived.by(() => {
    if (!hoveredGroupId) return new Set<string>();

    const ids = new Set<string>();

    // Check group.nodeIds from the groups array
    if (diagram.model.groups) {
      const group = diagram.model.groups.find((g) => g.id === hoveredGroupId);
      if (group?.nodeIds) {
        group.nodeIds.forEach((id) => ids.add(id));
      }
    }

    // Also check nodes that declare membership via node.group property
    diagram.model.nodes.forEach((node) => {
      if (node.group === hoveredGroupId) {
        ids.add(node.id);
      }
    });

    return ids;
  });

  // Calculate which edges connect nodes within the hovered group
  let groupEdgeIds = $derived.by(() => {
    if (!hoveredGroupId) return new Set<string>();

    const nodeIds = groupNodeIds;
    const connected = new Set<string>();

    diagram.model.edges.forEach((edge) => {
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) {
        connected.add(edge.id);
      }
    });

    return connected;
  });

  // Highlighted elements (from current state)
  let highlightedNodeSet = $derived(
    currentState?.highlightedNodes && currentState.highlightedNodes.length > 0
      ? new Set(currentState.highlightedNodes)
      : null,
  );
  let highlightedEdgeSet = $derived(
    currentState?.highlightedEdges && currentState.highlightedEdges.length > 0
      ? new Set(currentState.highlightedEdges)
      : null,
  );
  let hasStateHighlighting = $derived(highlightedNodeSet !== null || highlightedEdgeSet !== null);

  // Visible elements (based on current state)
  let visibleNodeIds = $derived(currentState?.visibleNodes ?? diagram.model.nodes.map((n) => n.id));
  let visibleNodeIdSet = $derived(new Set(visibleNodeIds));
  let rawVisibleEdgeIds = $derived(
    currentState?.visibleEdges ?? diagram.model.edges.map((e) => e.id),
  );
  let visibleEdgeIds = $derived(
    rawVisibleEdgeIds.filter((edgeId) => {
      const edge = diagram.model.edges.find((e) => e.id === edgeId);
      return edge && visibleNodeIdSet.has(edge.from) && visibleNodeIdSet.has(edge.to);
    }),
  );

  // Track which edges are newly visible (for animation)
  let newEdgeIds = $derived.by(() => {
    if (!stateJustChanged) return new Set<string>();
    return new Set(visibleEdgeIds.filter((id) => !previousVisibleEdgeIds.includes(id)));
  });

  let visibleNodes = $derived(layout?.nodes.filter((n) => visibleNodeIds.includes(n.id)) ?? []);
  let visibleEdges = $derived(layout?.edges.filter((e) => visibleEdgeIds.includes(e.id)) ?? []);

  let edgeLabelPositions = $derived.by(() => {
    const positions = new Map<string, EdgeLabelPosition>();
    const placedLabels: Array<{ x: number; y: number; width: number; height: number }> = [];

    const overlapsNode = (x: number, y: number, w: number, h: number, padding = 0) => {
      return visibleNodes.some((node) => {
        return !(
          x + w + padding < node.x ||
          x - padding > node.x + node.width ||
          y + h + padding < node.y ||
          y - padding > node.y + node.height
        );
      });
    };

    // Helper to check if a rectangle overlaps with already placed labels
    const overlapsLabel = (x: number, y: number, w: number, h: number, padding = 6) => {
      return placedLabels.some((label) => {
        return !(
          x + w + padding < label.x ||
          x - padding > label.x + label.width ||
          y + h + padding < label.y ||
          y - padding > label.y + label.height
        );
      });
    };

    const overlapsGroupHeader = (x: number, y: number, w: number, h: number) => {
      return (layout?.groups ?? []).some(
        (group) =>
          x < group.x + group.width && x + w > group.x && y < group.y + 34 && y + h > group.y,
      );
    };

    const overlapsRoute = (
      x: number,
      y: number,
      w: number,
      h: number,
      ownEdgeId: string,
      padding = 2,
    ) =>
      visibleEdges.some(
        (edge) =>
          edge.id !== ownEdgeId &&
          (edge.points ?? []).slice(0, -1).some((point, index) => {
            const next = edge.points![index + 1];
            const steps = Math.max(
              1,
              Math.ceil(Math.hypot(next.x - point.x, next.y - point.y) / 4),
            );
            for (let step = 0; step <= steps; step += 1) {
              const routeX = point.x + ((next.x - point.x) * step) / steps;
              const routeY = point.y + ((next.y - point.y) * step) / steps;
              if (
                routeX > x - padding &&
                routeX < x + w + padding &&
                routeY > y - padding &&
                routeY < y + h + padding
              ) {
                return true;
              }
            }
            return false;
          }),
      );

    for (const edge of visibleEdges) {
      if (!edge.label || !edge.points || edge.points.length < 2) continue;

      const { width: labelWidth, height: labelHeight } = measureEdgeLabel(
        edge.label,
        layoutWidthLimit < 500 ? compactEdgeLabelMaxWidth(edge.label ?? '') : undefined,
      );

      const points = edge.points;
      const modelEdge = diagram.model.edges.find(({ id }) => id === edge.id);
      const reverseEdge =
        modelEdge &&
        diagram.model.edges.find(
          (candidate) => candidate.from === modelEdge.to && candidate.to === modelEdge.from,
        );
      if (reverseEdge && points.length === 2) {
        const fraction = 0.35;
        const x = points[0].x + (points[1].x - points[0].x) * fraction - labelWidth / 2;
        const y = points[0].y + (points[1].y - points[0].y) * fraction - labelHeight / 2;
        positions.set(edge.id, { x, y, width: labelWidth, height: labelHeight });
        placedLabels.push({ x, y, width: labelWidth, height: labelHeight });
        continue;
      }

      const candidates: Array<{ x: number; y: number; score: number }> = [];
      const closeCandidates: Array<{ x: number; y: number; score: number }> = [];

      const addCandidate = (x: number, y: number, score: number) => {
        const labelX = x - labelWidth / 2;
        const labelY = y - labelHeight / 2;
        if (overlapsNode(labelX, labelY, labelWidth, labelHeight, 8)) return;
        if (overlapsGroupHeader(labelX, labelY, labelWidth, labelHeight)) return;
        if (overlapsRoute(labelX, labelY, labelWidth, labelHeight, edge.id)) return;
        const candidate = { x: labelX, y: labelY, score };
        if (overlapsLabel(labelX, labelY, labelWidth, labelHeight)) {
          if (!overlapsLabel(labelX, labelY, labelWidth, labelHeight, 1)) {
            closeCandidates.push(candidate);
          }
          return;
        }
        candidates.push(candidate);
      };

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);

        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength < 8) continue;
        const isHorizontal = dx >= dy;
        const requiredCapacity = (isHorizontal ? labelWidth : labelHeight) + 8;
        if (segmentLength < requiredCapacity) continue;

        const labelFractions = [
          0.5, 0.25, 0.75, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.125, 0.875, 0.05, 0.1, 0.15, 0.85, 0.9,
          0.95,
        ];
        for (const fraction of labelFractions) {
          const anchorX = p1.x + (p2.x - p1.x) * fraction;
          const anchorY = p1.y + (p2.y - p1.y) * fraction;
          const horizontalBonus = isHorizontal ? 1000 : 0;
          addCandidate(
            anchorX,
            anchorY,
            segmentLength + horizontalBonus - Math.abs(fraction - 0.5) * 16,
          );
        }
      }

      // Pick best candidate
      if (candidates.length > 0 || closeCandidates.length > 0) {
        const eligibleCandidates = candidates.length > 0 ? candidates : closeCandidates;
        eligibleCandidates.sort((a, b) => b.score - a.score);
        const best = eligibleCandidates[0];
        positions.set(edge.id, {
          x: best.x,
          y: best.y,
          width: labelWidth,
          height: labelHeight,
        });
        placedLabels.push({ x: best.x, y: best.y, width: labelWidth, height: labelHeight });
      } else if (points.length >= 2) {
        const [p1, p2] = points
          .slice(0, -1)
          .map((point, index) => [point, points[index + 1]] as const)
          .toSorted(
            ([startA, endA], [startB, endB]) =>
              Math.hypot(endB.x - startB.x, endB.y - startB.y) -
              Math.hypot(endA.x - startA.x, endA.y - startA.y),
          )[0];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const labelX = midX - labelWidth / 2;
        const labelY = midY - labelHeight / 2;
        positions.set(edge.id, { x: labelX, y: labelY, width: labelWidth, height: labelHeight });
        placedLabels.push({ x: labelX, y: labelY, width: labelWidth, height: labelHeight });
      }
    }

    return positions;
  });

  // Visible groups logic:
  // 1. If state explicitly defines visibleGroups, use that
  // 2. If state has highlightedNodes, only show groups containing highlighted nodes
  //    (this handles before/after diagrams where groups share nodes)
  // 3. Otherwise, show groups that have at least one visible node
  let visibleGroups = $derived.by(() => {
    if (!layout?.groups) return [];

    // If state explicitly defines which groups to show, use that
    if (currentState?.visibleGroups) {
      return layout.groups.filter((g) => currentState.visibleGroups!.includes(g.id));
    }

    // If state has highlighted nodes, only show groups that contain at least one highlighted node
    // This prevents overlapping groups in before/after diagrams where groups share nodes
    if (currentState?.highlightedNodes && currentState.highlightedNodes.length > 0) {
      const highlightedSet = new Set(currentState.highlightedNodes);
      return layout.groups.filter(
        (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => highlightedSet.has(id)),
      );
    }

    // Default: show groups that have at least one visible node
    return layout.groups.filter(
      (g) => Array.isArray(g.nodeIds) && g.nodeIds.some((id) => visibleNodeIds.includes(id)),
    );
  });

  // Compute layout on mount and when diagram or style config changes
  $effect(() => {
    fontMeasurementRevision;
    try {
      const fullLayout = computeLayout(
        diagram.model,
        diagram.baseView,
        diagram.grammar,
        renderStyleConfig,
        layoutWidthLimit,
      );
      let { minX, minY, maxX, maxY } = fullLayout.bounds;
      const labelSizes = diagram.model.edges
        .filter((edge) => edge.label)
        .map((edge) => measureEdgeLabel(edge.label!, layoutWidthLimit < 500 ? 100 : undefined));
      const labelOverflowX = Math.max(0, ...labelSizes.map((size) => size.width / 2 + 8));
      const labelOverflowY = Math.max(0, ...labelSizes.map((size) => size.height / 2 + 8));
      minX -= labelOverflowX;
      maxX += labelOverflowX;
      minY -= labelOverflowY;
      maxY += labelOverflowY;
      canvasBounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
      const nodeIds = new Set(visibleNodeIds);
      const edgeIds = new Set(visibleEdgeIds);
      const model = currentState
        ? {
            ...diagram.model,
            nodes: diagram.model.nodes.filter((node) => nodeIds.has(node.id)),
            edges: diagram.model.edges.filter((edge) => edgeIds.has(edge.id)),
            groups: diagram.model.groups?.filter((group) =>
              group.nodeIds?.some((nodeId) => nodeIds.has(nodeId)),
            ),
          }
        : diagram.model;
      layout = currentState
        ? computeLayout(
            model,
            diagram.baseView,
            diagram.grammar,
            renderStyleConfig,
            layoutWidthLimit,
          )
        : fullLayout;
      layoutError = false;
      beginDiagramSettlement();
    } catch {
      layout = null;
      canvasBounds = null;
      layoutError = true;
    }
  });

  // Camera state from current diagram state
  let cameraZoom = $derived(currentState?.camera?.zoom ?? 1);
  let cameraPan = $derived(currentState?.camera?.pan ?? null);
  let cameraFocusNodeId = $derived(currentState?.camera?.focus ?? null);

  // Scroll container ref for focus scrolling
  let scrollContainerEl = $state<HTMLDivElement | null>(null);
  let scrollContainerWidth = $state<number | null>(null);
  let initialFitResolved = $state(false);

  // Track scroll container width for sticky footer sizing
  $effect(() => {
    if (!scrollContainerEl) return;
    scrollContainerWidth = scrollContainerEl.clientWidth;
    updateFitScale();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        scrollContainerWidth = entry.contentRect.width;
        updateFitScale();
      }
    });
    observer.observe(scrollContainerEl);
    return () => observer.disconnect();
  });

  // Apply camera transform (zoom + pan) to the diagram content
  let cameraTransformStyle = $derived.by(() => {
    const transforms: string[] = [];
    if (cameraPan) {
      transforms.push(`translate(${cameraPan.x}px, ${cameraPan.y}px)`);
    }
    if (cameraZoom !== 1) {
      transforms.push(`scale(${cameraZoom})`);
    }
    return transforms.length > 0 ? transforms.join(' ') : undefined;
  });

  // Focus on a specific node when camera.focus changes
  $effect(() => {
    if (!cameraFocusNodeId || !layout || !scrollContainerEl) return;

    const focusNode = layout.nodes.find((n) => n.id === cameraFocusNodeId);
    if (!focusNode) return;

    // Calculate the node's center position relative to the SVG using visibleBounds
    // (which accounts for state-filtered visibility) instead of layout.bounds
    const bounds = visibleBounds ?? layout.bounds;
    const nodeCenterX = focusNode.x + focusNode.width / 2 - (bounds.minX - canvasPadding);
    const nodeCenterY = focusNode.y + focusNode.height / 2 - (bounds.minY - canvasPadding);

    // Apply zoom scaling
    const scaledX = nodeCenterX * cameraZoom;
    const scaledY = nodeCenterY * cameraZoom;

    // Scroll to center the node in the container
    const containerWidth = scrollContainerEl.clientWidth;
    const containerHeight = scrollContainerEl.clientHeight;

    // Account for cameraPan offset when scrolling
    const panX = cameraPan?.x ?? 0;
    const panY = cameraPan?.y ?? 0;

    scrollContainerEl.scrollTo({
      left: Math.max(0, scaledX + panX * cameraZoom - containerWidth / 2),
      top: Math.max(0, scaledY + panY * cameraZoom - containerHeight / 2),
      behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
    });
  });

  // Compute visible bounds when state filtering is active
  let visibleBounds = $derived.by(() => {
    if (!layout) return null;
    if (!currentState) {
      let { minX, minY, maxX, maxY } = layout.bounds;
      for (const label of edgeLabelPositions.values()) {
        minX = Math.min(minX, label.x);
        minY = Math.min(minY, label.y);
        maxX = Math.max(maxX, label.x + label.width);
        maxY = Math.max(maxY, label.y + label.height);
      }
      return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    if (canvasBounds) {
      return canvasBounds;
    }

    // Compute bounds from only visible elements
    const nodes = visibleNodes;
    const edges = visibleEdges;
    const groups = visibleGroups;

    if (nodes.length === 0) return layout.bounds;

    let minX = Math.min(...nodes.map((n) => n.x));
    let minY = Math.min(...nodes.map((n) => n.y));
    let maxX = Math.max(...nodes.map((n) => n.x + n.width));
    let maxY = Math.max(...nodes.map((n) => n.y + n.height));

    // Include visible groups
    for (const g of groups) {
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }

    // Include visible edge points — but only those within a reasonable
    // bounding box of the visible nodes. Edge routes from the full layout
    // may extend far beyond visible nodes (e.g., orthogonal routing waypoints
    // computed for all nodes), which would inflate bounds and cause scrollbars.
    const nodesBounds = { minX, minY, maxX, maxY };
    const edgeMargin = canvasPadding * 2;

    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          if (
            point.x >= nodesBounds.minX - edgeMargin &&
            point.x <= nodesBounds.maxX + edgeMargin &&
            point.y >= nodesBounds.minY - edgeMargin &&
            point.y <= nodesBounds.maxY + edgeMargin
          ) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
          }
        }
      }
    }

    // Keep edge labels inside the SVG, including multiline labels offset from their path.
    for (const label of edgeLabelPositions.values()) {
      minX = Math.min(minX, label.x);
      minY = Math.min(minY, label.y);
      maxX = Math.max(maxX, label.x + label.width);
      maxY = Math.max(maxY, label.y + label.height);
    }

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  });

  let svgWidth = $derived.by(() => {
    if (!visibleBounds) return 800;
    return visibleBounds.width + canvasPadding * 2;
  });

  let svgHeight = $derived.by(() => {
    if (!visibleBounds) return 600;
    return visibleBounds.height + canvasPadding * 2;
  });

  let svgTransform = $derived.by(() => {
    if (!visibleBounds) return 'translate(0, 0)';
    return `translate(${-visibleBounds.minX + canvasPadding}px, ${-visibleBounds.minY + canvasPadding}px)`;
  });

  let svgTransformAttribute = $derived.by(() => {
    if (!visibleBounds) return 'translate(0, 0)';
    return `translate(${-visibleBounds.minX + canvasPadding}, ${-visibleBounds.minY + canvasPadding})`;
  });

  function updateFitScale() {
    if (!fitToWidth || !scrollContainerEl) {
      fitScale = 1;
      return;
    }
    const availableWidth = Math.max(1, scrollContainerEl.clientWidth - 16);
    const renderedWidth = Math.max(1, svgWidth * cameraZoom);
    const readableScale = Math.max(
      PRIMARY_TEXT_FLOOR / renderStyleConfig.labelFontSize,
      SECONDARY_TEXT_FLOOR /
        (styleConfig === DEFAULT_NODE_STYLE ? 11 : renderStyleConfig.kindFontSize),
    );
    layoutWidthLimit = Math.max(160, availableWidth / readableScale - canvasPadding * 2);
    fitScale = Math.min(1, Math.max(readableScale, availableWidth / renderedWidth));
  }

  function toggleFitToWidth() {
    fitToWidth = !fitToWidth;
    updateFitScale();
    requestAnimationFrame(() => {
      updateFitScale();
      scrollContainerEl?.scrollTo({
        left: 0,
        top: 0,
        behavior: motionDuration(1) === 0 ? 'auto' : 'smooth',
      });
    });
  }

  $effect(() => {
    svgWidth;
    cameraZoom;
    if (fitToWidth) updateFitScale();
  });

  $effect(() => {
    if (initialFitResolved || !layout || !scrollContainerEl) return;
    const availableWidth = scrollContainerEl.clientWidth - 16;
    if (availableWidth <= 0) return;
    if (svgWidth * cameraZoom > availableWidth) {
      fitToWidth = true;
      updateFitScale();
    }
    initialFitResolved = true;
  });

  let previousViewResetKey = $state<string | undefined>();
  let viewResetInitialized = $state(false);
  $effect(() => {
    const nextViewResetKey = viewResetKey;
    if (!viewResetInitialized) {
      previousViewResetKey = nextViewResetKey;
      viewResetInitialized = true;
      return;
    }
    if (nextViewResetKey === previousViewResetKey) return;
    previousViewResetKey = nextViewResetKey;
    fitToWidth = false;
    fitScale = 1;
    scrollContainerEl?.scrollTo({ left: 0, top: 0, behavior: 'auto' });
  });

  // Handle state change
  function changeState(stateId: string) {
    if (stateId === currentStateId) return;
    previousVisibleEdgeIds = visibleEdgeIds;
    stateJustChanged = motionDuration(1) > 0;
    beginDiagramSettlement();
    currentStateId = stateId;

    // Notify parent so consumers (e.g. TipTap DiagramBlock) can persist the selected step
    onUpdate?.({ currentStateId: stateId });
  }

  function handleEdgeMotion(edgeId: string, moving: boolean) {
    const changed = moving ? !movingEdgeIds.has(edgeId) : movingEdgeIds.has(edgeId);
    if (!changed) return;
    if (moving) movingEdgeIds.add(edgeId);
    else movingEdgeIds.delete(edgeId);
    if (moving) beginDiagramSettlement();
  }

  // Handle node position update (for editing)
  function handleNodeMove(nodeId: string, x: number, y: number) {
    if (!editable || !onUpdate) return;

    const updatedNodes = diagram.model.nodes.map((n) =>
      n.id === nodeId ? { ...n, position: { x, y } } : n,
    );

    onUpdate({
      model: {
        ...diagram.model,
        nodes: updatedNodes,
      },
    });
  }
</script>

<div
  bind:this={rendererEl}
  class="diagram-renderer"
  class:has-content={Boolean(layout && diagram.model.nodes.length > 0)}
  class:compact-diagram={layoutWidthLimit < 500}
  class:fitted-diagram={fitToWidth}
  data-diagram-settled={diagramSettled}
  data-diagram-state={currentStateId}
>
  {#if layout && diagram.model.nodes.length > 0}
    <div class="diagram-actions" role="toolbar" aria-label={m.diagram_renderer_actions_ariaLabel()}>
      <Button
        variant="ghost"
        size="icon-xs"
        iconOnly
        class="diagram-fit-button"
        onclick={toggleFitToWidth}
        aria-pressed={fitToWidth}
        aria-label={fitToWidth
          ? m.diagram_renderer_actualSize_ariaLabel()
          : m.diagram_renderer_fitToWidth_ariaLabel()}
        tooltip={fitToWidth
          ? m.diagram_renderer_actualSize_ariaLabel()
          : m.diagram_renderer_fitToWidth_ariaLabel()}
      >
        <Fa icon={fitToWidth ? faExpand : faCompress} size="sm" />
      </Button>
    </div>
  {/if}
  <!-- Scrollable diagram content -->
  <div class="diagram-scroll-container" bind:this={scrollContainerEl}>
    {#if layoutError}
      <div class="diagram-feedback" role="alert">
        <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
        <span>{m.diagram_renderer_error_description()}</span>
      </div>
    {:else if diagram.model.nodes.length === 0}
      <div class="diagram-feedback" role="status">
        <strong>{m.diagram_validator_noNodes_warning()}</strong>
        <span>{m.diagram_renderer_empty_description()}</span>
      </div>
    {:else}
      <div
        class="diagram-content"
        style:transform={cameraTransformStyle}
        style:transform-origin="top left"
        style:zoom={fitToWidth ? fitScale : 1}
      >
        <!-- SVG Layer (edges, groups, and HTML overlay) -->
        <svg class="diagram-svg-layer" width={svgWidth} height={svgHeight + 6}>
          <!-- Shared marker definitions scoped by diagram ID to avoid cross-diagram conflicts -->
          <defs>
            <!-- Default arrowhead matching default edge stroke color -->
            <marker
              id="arrowhead-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--muted-foreground) / 0.62)"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <!-- Semantic-colored arrowhead markers -->
            <marker
              id="arrowhead-danger-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--error-foreground))"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-success-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--success) / 0.72)"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-warning-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--warning) / 0.78)"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-muted-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--muted-foreground) / 0.45)"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-inactive-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--muted-foreground) / 0.35)"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-highlighted-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 1 1 L 7 4 L 1 7 z"
                fill="context-stroke"
                stroke="hsl(var(--accent))"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
            <marker
              id="arrowhead-active-{diagram.id}"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M 2 1 L 7 4 L 2 7"
                fill="none"
                stroke="hsl(var(--accent))"
                stroke-width="1"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
            </marker>
          </defs>
          <g
            class="diagram-geometry-motion"
            transform={svgTransformAttribute}
            style:transform={svgTransform}
          >
            <!-- Groups (background) -->
            {#if visibleGroups}
              {#each visibleGroups as group (group.id)}
                <g transition:fade={{ duration: motionDuration(150) }}>
                  <DiagramGroup
                    {group}
                    dimmed={hoveredGroupId !== null && hoveredGroupId !== group.id}
                    onHover={(groupId: string | null) => (hoveredGroupId = groupId)}
                  />
                </g>
              {/each}
            {/if}

            <!-- Edges -->
            {#each visibleEdges as edge (edge.id)}
              {@const isEdgeDimmed =
                (hoveredNodeId !== null && !connectedEdgeIds.has(edge.id)) ||
                (hoveredGroupId !== null && !groupEdgeIds.has(edge.id)) ||
                (hasStateHighlighting &&
                  highlightedEdgeSet !== null &&
                  !highlightedEdgeSet.has(edge.id))}
              {@const isEdgeHighlighted =
                highlightedEdgeSet !== null && highlightedEdgeSet.has(edge.id)}
              {@const isNewEdge = newEdgeIds.has(edge.id)}
              <g class:edge-draw-in={isNewEdge} transition:fade={{ duration: motionDuration(150) }}>
                <DiagramEdge
                  {edge}
                  dimmed={isEdgeDimmed}
                  highlighted={isEdgeHighlighted}
                  markerScope={diagram.id}
                  onmotionchange={handleEdgeMotion}
                />
              </g>
            {/each}

            <!-- Edge labels (HTML via foreignObject) -->
            {#each visibleEdges as edge (edge.id)}
              {#if edge.label && edgeLabelPositions.has(edge.id)}
                {@const labelPos = edgeLabelPositions.get(edge.id)!}
                {@const isDimmed =
                  (hoveredNodeId !== null && !connectedEdgeIds.has(edge.id)) ||
                  (hoveredGroupId !== null && !groupEdgeIds.has(edge.id)) ||
                  (hasStateHighlighting &&
                    highlightedEdgeSet !== null &&
                    !highlightedEdgeSet.has(edge.id))}
                <foreignObject
                  x={labelPos.x}
                  y={labelPos.y}
                  width={labelPos.width}
                  height={labelPos.height}
                  class="edge-label-container diagram-geometry-motion {isDimmed
                    ? 'edge-label-dimmed'
                    : ''}"
                  data-edge-id={edge.id}
                  data-semantic-style={edge.semanticStyle ?? 'default'}
                  transition:fade={{ duration: motionDuration(150) }}
                >
                  <div class="edge-label-html">
                    {edge.label}
                  </div>
                </foreignObject>
              {/if}
            {/each}

            <!-- HTML nodes via foreignObject -->
            {#each visibleNodes as node (node.id)}
              {@const isNodeDimmed =
                (hoveredNodeId !== null && !connectedNodeIds.has(node.id)) ||
                (hoveredGroupId !== null && !groupNodeIds.has(node.id)) ||
                (hasStateHighlighting &&
                  highlightedNodeSet !== null &&
                  !highlightedNodeSet.has(node.id))}
              {@const isNodeHighlighted =
                highlightedNodeSet !== null && highlightedNodeSet.has(node.id)}
              <foreignObject
                data-node-id={node.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                class="diagram-geometry-motion"
                transition:fade={{
                  duration: stateJustChanged ? motionDuration(180) : 0,
                  easing: cubicOut,
                }}
              >
                <DiagramNodeHTML
                  {node}
                  {editable}
                  styleConfig={renderStyleConfig}
                  dimmed={isNodeDimmed}
                  highlighted={isNodeHighlighted}
                  onMove={(x: number, y: number) => handleNodeMove(node.id, x, y)}
                  onHover={(nodeId: string | null) => (hoveredNodeId = nodeId)}
                  {onBindingClick}
                />
              </foreignObject>
            {/each}
          </g>
        </svg>
      </div>
    {/if}

    <!-- Footer with controls and narrative (only show if states exist) - sticky at bottom -->
    {#if !layoutError && diagram.model.nodes.length > 0 && diagram.states && diagram.states.length > 0}
      <div
        class="diagram-footer"
        style:width={scrollContainerWidth != null ? `${scrollContainerWidth}px` : '100%'}
      >
        <DiagramControls states={diagram.states} {currentStateId} onStateChange={changeState} />
      </div>
    {/if}
  </div>
</div>

<style>
  .diagram-renderer {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 900px;
    position: relative;
    color: hsl(var(--foreground));
    font-family: var(--font-ui);
  }

  .diagram-renderer:is(.compact-diagram, .fitted-diagram) {
    max-height: none;
  }

  .diagram-renderer.has-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    width: 100%;
    max-width: 100%;
    margin-inline: auto;
  }

  .diagram-actions {
    grid-column: 1;
    grid-row: 1;
    justify-self: end;
    display: flex;
    margin: var(--space-2) var(--space-2) var(--space-1);
    padding: 2px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--background));
    box-shadow: var(--elevation-raised);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-standard) var(--ease-standard);
  }

  .diagram-renderer:hover .diagram-actions,
  .diagram-renderer:focus-within .diagram-actions {
    opacity: 1;
    pointer-events: auto;
  }

  :global(.diagram-fit-button) {
    color: hsl(var(--muted-foreground));
  }

  :global(.diagram-fit-button:hover),
  :global(.diagram-fit-button:focus-visible) {
    color: hsl(var(--foreground));
  }

  .diagram-scroll-container {
    grid-column: 1;
    grid-row: 2;
    overflow: auto;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  .diagram-content {
    position: relative;
    width: fit-content;
    height: fit-content;
    margin: 0 auto;
    overflow: visible;
    border-radius: var(--radius-medium);
  }

  .diagram-feedback {
    display: grid;
    min-height: 10rem;
    place-content: center;
    gap: var(--space-1);
    padding: var(--space-4);
    text-align: center;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }

  .diagram-feedback strong {
    color: hsl(var(--foreground));
    font-weight: var(--text-caption-weight);
  }

  .diagram-svg-layer {
    display: block;
    background: transparent;
  }

  .diagram-footer {
    position: sticky;
    bottom: 0;
    left: 0;
    flex-shrink: 0;
    z-index: 1;
    box-sizing: border-box;
    overflow: hidden;
  }

  /* Allow pointer events on nodes */
  :global(.diagram-node-html) {
    pointer-events: auto;
  }

  foreignObject[data-node-id] {
    overflow: visible;
  }

  /* Edge labels */
  :global(.edge-label-container) {
    pointer-events: none;
    overflow: visible;
    transition: opacity var(--motion-standard) var(--ease-standard);
    display: block;
  }

  :global(.diagram-geometry-motion) {
    transition:
      x 220ms cubic-bezier(0.16, 1, 0.3, 1),
      y 220ms cubic-bezier(0.16, 1, 0.3, 1),
      width 220ms cubic-bezier(0.16, 1, 0.3, 1),
      height 220ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 180ms ease-out;
  }

  :global(.edge-label-dimmed) {
    opacity: 0.64;
  }

  /* Edge path drawing animation */
  :global(.edge-draw-in path) {
    animation: drawPath 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes drawPath {
    from {
      stroke-dasharray: 1000;
      stroke-dashoffset: 1000;
    }
    to {
      stroke-dasharray: 1000;
      stroke-dashoffset: 0;
    }
  }

  :global(.edge-label-html) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 2px;
    font-family: var(--font-ui);
    font-size: var(--text-caption-size);
    font-weight: var(--text-body-weight);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
    color: hsl(var(--muted-foreground));
    background: hsl(var(--background));
    padding: 1px 4px;
    white-space: pre-line;
    overflow: hidden;
    overflow-wrap: normal;
    word-break: normal;
    text-align: center;
    box-sizing: border-box;
  }

  :global(.edge-label-container[data-semantic-style='danger'] .edge-label-html) {
    color: hsl(var(--error-foreground));
  }

  :global(.catalog-reduced-motion .edge-label-container),
  :global(.catalog-reduced-motion .diagram-geometry-motion),
  :global(.catalog-reduced-motion .edge-draw-in path),
  :global(.catalog-reduced-motion) .diagram-actions {
    transition: none;
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.edge-label-container),
    :global(.diagram-geometry-motion),
    :global(.edge-draw-in path),
    .diagram-actions {
      transition: none;
      animation: none;
    }
  }
</style>
