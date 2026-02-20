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
  let previousStateId = $state<string | undefined>(undefined);
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
    if (!hoveredGroupId || !diagram.model.groups) return new Set<string>();

    const group = diagram.model.groups.find((g) => g.id === hoveredGroupId);
    return new Set(group?.nodeIds || []);
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

  // Visible elements (based on current state)
  let visibleNodeIds = $derived(currentState?.visibleNodes ?? diagram.model.nodes.map((n) => n.id));
  let visibleEdgeIds = $derived(currentState?.visibleEdges ?? diagram.model.edges.map((e) => e.id));

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

      // ONLY consider horizontal segments for label placement
      const candidates: Array<{ x: number; y: number; score: number }> = [];

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);

        // Only horizontal segments (dy very small, dx significant)
        const isHorizontal = dy < 5 && dx > 50;
        if (!isHorizontal) continue;

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        // Center label on the horizontal segment
        const labelX = midX - labelWidth / 2;
        const labelY = midY - labelHeight / 2;

        // Skip if overlaps any node
        if (overlapsNode(labelX, labelY, labelWidth, labelHeight)) continue;

        // Skip if overlaps already placed label
        if (overlapsLabel(labelX, labelY, labelWidth, labelHeight)) continue;

        // Score: prefer longer horizontal segments
        candidates.push({ x: labelX, y: labelY, score: dx });
      }

      // Pick best candidate
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        positions.set(edge.id, { x: best.x, y: best.y, width: labelWidth, height: labelHeight });
        placedLabels.push({ x: best.x, y: best.y, width: labelWidth, height: labelHeight });
      }
      // If no valid horizontal segment, don't show label
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

  // SVG dimensions (actual pixel size, no scaling)
  const PADDING = 2;

  let svgWidth = $derived.by(() => {
    if (!layout) return 800;
    return layout.bounds.width + PADDING * 2;
  });

  let svgHeight = $derived.by(() => {
    if (!layout) return 600;
    return layout.bounds.height + PADDING * 2;
  });

  let svgTransform = $derived.by(() => {
    if (!layout) return 'translate(0, 0)';
    const { bounds } = layout;
    return `translate(${-bounds.minX + PADDING}, ${-bounds.minY + PADDING})`;
  });

  // Handle state change
  function changeState(stateId: string) {
    previousStateId = currentStateId;
    previousVisibleEdgeIds = visibleEdgeIds;
    stateJustChanged = true;
    currentStateId = stateId;
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
  <div class="diagram-scroll-container">
    <div class="diagram-content rounded-lg">
      <!-- SVG Layer (edges, groups, and HTML overlay) -->
      <svg class="diagram-svg-layer" width={svgWidth} height={svgHeight + 6}>
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
              (hoveredGroupId !== null && !groupEdgeIds.has(edge.id))}
            {@const isNewEdge = newEdgeIds.has(edge.id)}
            <g class:edge-draw-in={isNewEdge}>
              <DiagramEdge {edge} dimmed={isEdgeDimmed} />
            </g>
          {/each}

          <!-- Edge labels (HTML via foreignObject) -->
          {#each visibleEdges as edge (edge.id)}
            {#if edge.label && edgeLabelPositions.has(edge.id)}
              {@const labelPos = edgeLabelPositions.get(edge.id)!}
              {@const isDimmed =
                (hoveredNodeId !== null && !connectedEdgeIds.has(edge.id)) ||
                (hoveredGroupId !== null && !groupEdgeIds.has(edge.id))}
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
              (hoveredGroupId !== null && !groupNodeIds.has(node.id))}
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
                onMove={(x: number, y: number) => handleNodeMove(node.id, x, y)}
                onHover={(nodeId: string | null) => (hoveredNodeId = nodeId)}
                {onBindingClick}
              />
            </foreignObject>
          {/each}
        </g>
      </svg>
    </div>
  </div>

  <!-- Footer with controls and narrative (only show if states exist) - sticky at bottom -->
  {#if diagram.states && diagram.states.length > 0}
    <div class="diagram-footer">
      <DiagramControls states={diagram.states} {currentStateId} onStateChange={changeState} />
    </div>
  {/if}
</div>

<style>
  .diagram-renderer {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: fit-content;
    position: relative;
  }

  .diagram-scroll-container {
    overflow-x: auto;
    overflow-y: visible;
    width: 100%;
  }

  .diagram-content {
    position: relative;
    width: fit-content;
    height: fit-content;
    min-width: 100%;
    overflow: visible;
  }

  .diagram-svg-layer {
    display: block;
  }

  .diagram-footer {
    position: sticky;
    left: 0;
    width: 100%;
    flex-shrink: 0;
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
