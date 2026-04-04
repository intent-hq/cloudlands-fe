<script lang="ts">
  /**
   * Diagram Renderer
   *
   * Renders interactive diagrams with support for states, animations, and bindings
   */
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import { computeLayout } from './layout-engine';
  import type { ComputedLayout, NodeStyleConfig } from './types';
  import { DEFAULT_NODE_STYLE } from './types';
  import DiagramNodeHTML from './DiagramNodeHTML.svelte';
  import DiagramEdge from './DiagramEdge.svelte';
  import DiagramGroup from './DiagramGroup.svelte';
  import DiagramControls from './DiagramControls.svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    diagram: DiagramPrimitive;
    onUpdate?: (updates: Partial<DiagramPrimitive>) => void;
    editable?: boolean;
    /** Optional node style configuration for customizing font sizes, padding, etc. */
    styleConfig?: NodeStyleConfig;
    /** Callback for when a node binding is clicked */
    onBindingClick?: (e: MouseEvent, binding: { type: string; target: string }) => void;
  }

  let {
    diagram,
    onUpdate,
    editable = false,
    styleConfig = DEFAULT_NODE_STYLE,
    onBindingClick,
  }: Props = $props();

  // Computed layout
  let layout = $state<ComputedLayout | null>(null);

  // Current state - default to first state if not set
  let currentStateId = $state(
    diagram.currentStateId ??
      (diagram.states && diagram.states.length > 0 ? diagram.states[0].id : undefined),
  );
  let currentState = $derived(diagram.states?.find((s) => s.id === currentStateId) ?? null);

  // Track state changes for animations
  let stateJustChanged = $state(false);
  let previousVisibleEdgeIds = $state<string[]>([]);

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

  // Filtered layout
  let visibleNodes = $derived(layout?.nodes.filter((n) => visibleNodeIds.includes(n.id)) ?? []);
  let visibleEdges = $derived(layout?.edges.filter((e) => visibleEdgeIds.includes(e.id)) ?? []);

  // Compute non-overlapping label positions for edges
  let edgeLabelPositions = $derived.by(() => {
    const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
    const placedLabels: Array<{ x: number; y: number; width: number; height: number }> = [];

    // Helper to check if a rectangle overlaps with any node
    const overlapsNode = (x: number, y: number, w: number, h: number, padding = 10) => {
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

    for (const edge of visibleEdges) {
      if (!edge.label || !edge.points || edge.points.length < 2) continue;

      const maxLabelWidth = 160;
      const labelWidth = Math.min(edge.label.length * 7 + 16, maxLabelWidth);
      const labelHeight = 20;

      const points = edge.points;

      // Consider both horizontal and vertical segments for label placement
      const candidates: Array<{ x: number; y: number; score: number }> = [];

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);

        // Horizontal segments (dy very small, dx significant)
        const isHorizontal = dy < 5 && dx > 50;
        // Vertical segments (dx very small, dy significant)
        const isVertical = dx < 5 && dy > 50;

        if (!isHorizontal && !isVertical) continue;

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // Center label on the segment
        const labelX = midX - labelWidth / 2;
        const labelY = midY - labelHeight / 2;

        // Skip if overlaps any node
        if (overlapsNode(labelX, labelY, labelWidth, labelHeight)) continue;

        // Skip if overlaps already placed label
        if (overlapsLabel(labelX, labelY, labelWidth, labelHeight)) continue;

        // Score: prefer longer segments (use the dominant dimension)
        const segmentLength = isHorizontal ? dx : dy;
        candidates.push({ x: labelX, y: labelY, score: segmentLength });
      }

      // Pick best candidate
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        positions.set(edge.id, { x: best.x, y: best.y, width: labelWidth, height: labelHeight });
        placedLabels.push({ x: best.x, y: best.y, width: labelWidth, height: labelHeight });
      } else if (points.length >= 2) {
        // Fallback: place label at the midpoint of the entire edge path
        const midIdx = Math.floor(points.length / 2);
        const p1 = points[midIdx - 1] || points[0];
        const p2 = points[midIdx];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const labelX = midX - labelWidth / 2;
        const labelY = midY - labelHeight / 2;

        if (
          !overlapsNode(labelX, labelY, labelWidth, labelHeight) &&
          !overlapsLabel(labelX, labelY, labelWidth, labelHeight)
        ) {
          positions.set(edge.id, { x: labelX, y: labelY, width: labelWidth, height: labelHeight });
          placedLabels.push({ x: labelX, y: labelY, width: labelWidth, height: labelHeight });
        }
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
    layout = computeLayout(diagram.model, diagram.baseView, diagram.grammar, styleConfig);
  });

  // Camera state from current diagram state
  let cameraZoom = $derived(currentState?.camera?.zoom ?? 1);
  let cameraPan = $derived(currentState?.camera?.pan ?? null);
  let cameraFocusNodeId = $derived(currentState?.camera?.focus ?? null);

  // Scroll container ref for focus scrolling
  let scrollContainerEl = $state<HTMLDivElement | null>(null);
  let scrollContainerWidth = $state<number | null>(null);

  // Track scroll container width for sticky footer sizing
  $effect(() => {
    if (!scrollContainerEl) return;
    scrollContainerWidth = scrollContainerEl.clientWidth;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        scrollContainerWidth = entry.contentRect.width;
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
    const nodeCenterX = focusNode.x + focusNode.width / 2 - (bounds.minX - PADDING);
    const nodeCenterY = focusNode.y + focusNode.height / 2 - (bounds.minY - PADDING);

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
      behavior: 'smooth',
    });
  });

  // SVG dimensions (actual pixel size, no scaling)
  const PADDING = 40;

  // Compute visible bounds when state filtering is active
  let visibleBounds = $derived.by(() => {
    if (!layout) return null;
    if (!currentState) return layout.bounds;

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
    const edgeMargin = PADDING * 2;

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

    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  });

  let svgWidth = $derived.by(() => {
    if (!visibleBounds) return 800;
    return visibleBounds.width + PADDING * 2;
  });

  let svgHeight = $derived.by(() => {
    if (!visibleBounds) return 600;
    return visibleBounds.height + PADDING * 2;
  });

  let svgTransform = $derived.by(() => {
    if (!visibleBounds) return 'translate(0, 0)';
    return `translate(${-visibleBounds.minX + PADDING}, ${-visibleBounds.minY + PADDING})`;
  });

  // Handle state change
  function changeState(stateId: string) {
    previousVisibleEdgeIds = visibleEdgeIds;
    stateJustChanged = true;
    currentStateId = stateId;

    // Notify parent so consumers (e.g. TipTap DiagramBlock) can persist the selected step
    onUpdate?.({ currentStateId: stateId });

    // Reset animation flag after animations complete
    setTimeout(() => {
      stateJustChanged = false;
    }, 500);
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

<div class="diagram-renderer">
  <!-- Scrollable diagram content -->
  <div class="diagram-scroll-container" bind:this={scrollContainerEl}>
    <div
      class="diagram-content rounded-lg"
      style:transform={cameraTransformStyle}
      style:transform-origin="top left"
    >
      <!-- SVG Layer (edges, groups, and HTML overlay) -->
      <svg class="diagram-svg-layer" width={svgWidth} height={svgHeight + 6}>
        <!-- Shared marker definitions scoped by diagram ID to avoid cross-diagram conflicts -->
        <defs>
          <!-- Default arrowhead matching default edge stroke color -->
          <marker
            id="arrowhead-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--border))"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <!-- Semantic-colored arrowhead markers -->
          <marker
            id="arrowhead-danger-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--destructive) / 0.8)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-success-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(142 76% 36% / 0.6)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-warning-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(38 92% 50% / 0.6)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-muted-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--muted-foreground) / 0.3)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-inactive-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--muted-foreground) / 0.2)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-highlighted-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--accent))"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
          <marker
            id="arrowhead-active-{diagram.id}"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
          >
            <path
              d="M 3 1 L 8 5 L 3 9"
              fill="none"
              stroke="hsl(var(--accent))"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </marker>
        </defs>
        <g transform={svgTransform}>
          <!-- Groups (background) -->
          {#if visibleGroups}
            {#each visibleGroups as group (group.id)}
              <g transition:fade={{ duration: 200 }}>
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
            <g class:edge-draw-in={isNewEdge}>
              <DiagramEdge
                {edge}
                dimmed={isEdgeDimmed}
                highlighted={isEdgeHighlighted}
                markerScope={diagram.id}
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
                class="edge-label-container {isDimmed ? 'edge-label-dimmed' : ''}"
                transition:fade={{ duration: 300 }}
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
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              in:fly={{
                y: stateJustChanged ? -20 : 0,
                duration: stateJustChanged ? 400 : 0,
                easing: cubicOut,
                opacity: 0,
              }}
              out:fade={{ duration: 200 }}
            >
              <DiagramNodeHTML
                {node}
                {editable}
                {styleConfig}
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

    <!-- Footer with controls and narrative (only show if states exist) - sticky at bottom -->
    {#if diagram.states && diagram.states.length > 0}
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
  }

  .diagram-scroll-container {
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
  }

  .diagram-svg-layer {
    display: block;
  }

  .diagram-footer {
    position: sticky;
    bottom: 0;
    left: 0;
    flex-shrink: 0;
    background: hsl(var(--card));
    border-top: 1px solid hsl(var(--border));
    z-index: 1;
    box-sizing: border-box;
    overflow: hidden;
  }

  /* Allow pointer events on nodes */
  :global(.diagram-node-html) {
    pointer-events: auto;
  }

  /* Edge labels */
  :global(.edge-label-container) {
    pointer-events: none;
    overflow: visible;
    transition: opacity 0.2s ease;
    /* Ensure foreignObject is visible */
    display: block;
  }

  :global(.edge-label-dimmed) {
    opacity: 0.2;
  }

  /* Edge path drawing animation */
  :global(.edge-draw-in path) {
    animation: drawPath 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
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
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.01em;
    color: hsl(var(--muted-foreground));
    background: hsl(var(--background));
    padding: 2px 8px;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
    box-sizing: border-box;
  }
</style>
