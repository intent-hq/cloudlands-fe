<script lang="ts">
  /**
   * GraphEdge Component
   *
   * SVG edge/link between nodes with animated pulses for active interactions.
   * Color-coded based on edge type (delegation, read, write).
   * Edges start/end at card edges, not centers.
   */
  import type { GraphEdge as GraphEdgeType } from './types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { CARD_DIMENSIONS, EDGE_STYLES, EDGE_ANIMATION } from './constants';

  interface Props {
    edge: GraphEdgeType;
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
  }

  let { edge, sourceX, sourceY, targetX, targetY }: Props = $props();

  // Determine source and target node types based on edge type
  const sourceType = $derived('agent' as const); // Source is always an agent
  const targetType = $derived.by(() => {
    if (edge.type === 'delegation') return 'agent' as const;
    if (edge.type === 'file-read' || edge.type === 'file-write') return 'file' as const;
    return 'note' as const;
  });

  // Calculate edge start point (at source card edge, pointing toward target)
  const edgeStart = $derived.by(() => {
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: sourceX, y: sourceY };

    const sourceDims = CARD_DIMENSIONS[sourceType];
    // Find intersection with card rectangle
    const angle = Math.atan2(dy, dx);
    const halfW = sourceDims.width / 2;
    const halfH = sourceDims.height / 2;

    // Calculate intersection point with rectangle edge
    const tanAngle = Math.abs(Math.tan(angle));
    let offsetX: number, offsetY: number;
    if (tanAngle < halfH / halfW) {
      // Intersects left or right edge
      offsetX = halfW * Math.sign(dx);
      offsetY = halfW * tanAngle * Math.sign(dy);
    } else {
      // Intersects top or bottom edge
      offsetY = halfH * Math.sign(dy);
      offsetX = (halfH / tanAngle) * Math.sign(dx);
    }

    return { x: sourceX + offsetX, y: sourceY + offsetY };
  });

  // Calculate edge end point (at target card edge, pointing toward source)
  const edgeEnd = $derived.by(() => {
    const dx = sourceX - targetX;
    const dy = sourceY - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: targetX, y: targetY };

    const targetDims = CARD_DIMENSIONS[targetType];
    const angle = Math.atan2(dy, dx);
    const halfW = targetDims.width / 2;
    const halfH = targetDims.height / 2;

    const tanAngle = Math.abs(Math.tan(angle));
    let offsetX: number, offsetY: number;
    if (tanAngle < halfH / halfW) {
      offsetX = halfW * Math.sign(dx);
      offsetY = halfW * tanAngle * Math.sign(dy);
    } else {
      offsetY = halfH * Math.sign(dy);
      offsetX = (halfH / tanAngle) * Math.sign(dx);
    }

    return { x: targetX + offsetX, y: targetY + offsetY };
  });

  // Calculate badge position - just outside the source card edge (15px along the line)
  const badgePos = $derived.by(() => {
    const dx = edgeEnd.x - edgeStart.x;
    const dy = edgeEnd.y - edgeStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: edgeStart.x, y: edgeStart.y };

    // Position badge 25px from the source card edge
    const offset = Math.min(25, dist * 0.3);
    return {
      x: edgeStart.x + (dx / dist) * offset,
      y: edgeStart.y + (dy / dist) * offset,
    };
  });

  // Check if this is a write edge that should show line changes
  const isWriteEdge = $derived(edge.type === 'file-write' || edge.type === 'note-write');
  const hasLineChanges = $derived(
    isWriteEdge &&
      ((edge.additions !== undefined && edge.additions > 0) ||
        (edge.deletions !== undefined && edge.deletions > 0)),
  );

  // Edge styling based on type (using shared constants)
  const edgeStyle = $derived(EDGE_STYLES[edge.type] ?? EDGE_STYLES.default);

  // Unique ID for gradient
  const gradientId = $derived(`edge-gradient-${edge.id}`);

  // Calculate edge path (from card edge to card edge)
  const pathD = $derived(`M ${edgeStart.x} ${edgeStart.y} L ${edgeEnd.x} ${edgeEnd.y}`);

  // Calculate path length for animation
  const pathLength = $derived(
    Math.sqrt(Math.pow(edgeEnd.x - edgeStart.x, 2) + Math.pow(edgeEnd.y - edgeStart.y, 2)),
  );

  // Animation duration based on path length (longer paths = longer animation)
  const animDuration = $derived(
    Math.max(EDGE_ANIMATION.minDuration, pathLength / EDGE_ANIMATION.speedFactor),
  );
</script>

<g class="graph-edge" class:active={edge.isActive}>
  <!-- Gradient definition for animated pulse -->
  {#if edge.isActive}
    <defs>
      <linearGradient
        id={gradientId}
        gradientUnits="userSpaceOnUse"
        x1={edgeStart.x}
        y1={edgeStart.y}
        x2={edgeEnd.x}
        y2={edgeEnd.y}
      >
        <stop offset="0%" stop-color={edgeStyle.stroke} stop-opacity="0.2">
          <animate
            attributeName="offset"
            values="-0.3;1"
            dur="{animDuration}s"
            repeatCount="indefinite"
          />
        </stop>
        <stop offset="10%" stop-color={edgeStyle.stroke} stop-opacity="1">
          <animate
            attributeName="offset"
            values="-0.2;1.1"
            dur="{animDuration}s"
            repeatCount="indefinite"
          />
        </stop>
        <stop offset="20%" stop-color={edgeStyle.stroke} stop-opacity="0.2">
          <animate
            attributeName="offset"
            values="-0.1;1.2"
            dur="{animDuration}s"
            repeatCount="indefinite"
          />
        </stop>
      </linearGradient>
    </defs>
  {/if}

  <!-- Main edge line -->
  <path
    d={pathD}
    fill="none"
    stroke={edgeStyle.stroke}
    stroke-width={edgeStyle.strokeWidth}
    stroke-dasharray={edgeStyle.strokeDasharray}
    opacity={edge.isActive ? 0.3 : edgeStyle.opacity}
    class="edge-path"
  />

  <!-- Animated gradient pulse overlay for active edges -->
  {#if edge.isActive}
    <path
      d={pathD}
      fill="none"
      stroke="url(#{gradientId})"
      stroke-width={edgeStyle.strokeWidth}
      stroke-linecap="round"
      class="edge-pulse"
    />
  {/if}

  <!-- Arrow marker for delegation edges (two angled lines) -->
  {#if edge.type === 'delegation'}
    {@const angle = Math.atan2(edgeEnd.y - edgeStart.y, edgeEnd.x - edgeStart.x)}
    {@const arrowSize = 8}
    {@const arrowAngle = 0.7}
    {@const tipX = edgeEnd.x}
    {@const tipY = edgeEnd.y}
    <line
      x1={tipX}
      y1={tipY}
      x2={tipX - arrowSize * Math.cos(angle - arrowAngle)}
      y2={tipY - arrowSize * Math.sin(angle - arrowAngle)}
      stroke={edgeStyle.stroke}
      stroke-width={edgeStyle.strokeWidth}
      stroke-linecap="round"
      opacity={edgeStyle.opacity}
    />
    <line
      x1={tipX}
      y1={tipY}
      x2={tipX - arrowSize * Math.cos(angle + arrowAngle)}
      y2={tipY - arrowSize * Math.sin(angle + arrowAngle)}
      stroke={edgeStyle.stroke}
      stroke-width={edgeStyle.strokeWidth}
      stroke-linecap="round"
      opacity={edgeStyle.opacity}
    />
  {/if}

  <!-- Line changes badge for write edges (just outside source card edge) -->
  {#if hasLineChanges}
    <foreignObject
      x={badgePos.x - 35}
      y={badgePos.y - 12}
      width="70"
      height="24"
      class="pointer-events-none overflow-visible"
    >
      <div class="flex items-center justify-center h-full">
        <LineChangesBadge
          additions={edge.additions ?? 0}
          deletions={edge.deletions ?? 0}
          size="xs"
          animated
        />
      </div>
    </foreignObject>
  {/if}
</g>

<style>
  .graph-edge {
    pointer-events: none;
  }

  .edge-path {
    transition:
      stroke 0.2s ease,
      opacity 0.2s ease;
  }
</style>
