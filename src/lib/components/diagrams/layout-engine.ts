/**
 * Diagram Layout Engine
 *
 * Computes node positions and edge paths based on layout configuration
 */

import type {
  DiagramModel,
  DiagramBaseView,
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
} from '$shared/types/notes-primitives';
import type {
  ComputedLayout,
  ComputedNode,
  ComputedEdge,
  ComputedGroup,
  NodeStyleConfig,
} from './types';
import { GRAMMAR_CONFIGS, DEFAULT_NODE_STYLE } from './types';

/**
 * Compute layout for a diagram
 */
// Maximum aspect ratio for diagrams (width/height) - approximately 16:9 video ratio
const MAX_ASPECT_RATIO = 1.78;
// Maximum width before wrapping (in pixels) - reasonable for most screens
const MAX_DIAGRAM_WIDTH = 900;
// Spacing limits to prevent unusable layouts
const MIN_SPACING = 30;
const MAX_SPACING = 300;

/** Clamp spacing to usable range */
function clampSpacing(spacing: number | undefined, defaultValue: number = 80): number {
  const value = spacing ?? defaultValue;
  return Math.max(MIN_SPACING, Math.min(MAX_SPACING, value));
}

export function computeLayout(
  model: DiagramModel,
  baseView: DiagramBaseView,
  grammar: string,
  styleConfig: NodeStyleConfig = DEFAULT_NODE_STYLE,
): ComputedLayout {
  const config = GRAMMAR_CONFIGS[grammar as keyof typeof GRAMMAR_CONFIGS];
  const nodeDefaults = config?.nodeDefaults || { width: 100, height: 60 };

  // First, compute node sizes based on text content
  const nodesWithSizes = model.nodes.map((node) => ({
    ...node,
    size: node.size || computeNodeSize(node, nodeDefaults, styleConfig),
  }));

  // Merge grammar's default layout with baseView layout
  // This ensures grammar-specific defaults (like edgeRouting) are applied
  const layout = {
    ...config?.defaultLayout,
    ...baseView.layout,
    // Also check baseView.edgeRouting for backwards compatibility
    edgeRouting:
      baseView.layout.edgeRouting || baseView.edgeRouting || config?.defaultLayout?.edgeRouting,
  };

  let result = computeLayoutWithDirection(nodesWithSizes, model, layout, nodeDefaults);

  // Check if diagram is too wide and needs adjustment
  const isHorizontalLayout = layout.direction === 'LR' || layout.direction === 'RL';

  if (
    result.bounds.width > MAX_DIAGRAM_WIDTH ||
    (result.bounds.height > 0 && result.bounds.width / result.bounds.height > MAX_ASPECT_RATIO)
  ) {
    if (isHorizontalLayout) {
      // Try vertical layout first for horizontal diagrams that are too wide
      const verticalLayout = { ...layout, direction: 'TB' as const };
      const verticalResult = computeLayoutWithDirection(
        nodesWithSizes,
        model,
        verticalLayout,
        nodeDefaults,
      );

      // Use vertical if it's better (not too wide)
      if (verticalResult.bounds.width <= MAX_DIAGRAM_WIDTH) {
        result = verticalResult;
      } else {
        // Still too wide - apply wrapping to vertical layout
        result = applyWrapping(verticalResult, MAX_DIAGRAM_WIDTH, clampSpacing(layout.spacing, 80));
      }
    } else {
      // TB/BT layout that's too wide - apply wrapping
      result = applyWrapping(result, MAX_DIAGRAM_WIDTH, clampSpacing(layout.spacing, 80));
    }
  }

  return result;
}

/**
 * Apply wrapping to a layout that exceeds max width
 * Shifts nodes that exceed the width down to create wrapped rows
 */
function applyWrapping(layout: ComputedLayout, maxWidth: number, spacing: number): ComputedLayout {
  if (layout.bounds.width <= maxWidth) {
    return layout;
  }

  const nodes = [...layout.nodes];
  const rowHeight = Math.max(...nodes.map((n) => n.height)) + spacing;

  // Sort nodes by their x position to process left-to-right
  const sortedNodes = [...nodes].sort((a, b) => a.x - b.x);
  const nodeAdjustments = new Map<string, { dx: number; dy: number }>();

  // Track the current row's y offset and x offset for wrapping
  let rowYOffset = 0;
  let rowXOffset = 0;

  sortedNodes.forEach((node) => {
    const relativeX = node.x - layout.bounds.minX - rowXOffset;

    // Check if this node exceeds max width and needs to wrap
    if (relativeX + node.width > maxWidth && relativeX > 0) {
      // Record the x offset to subtract for this new row
      rowXOffset = node.x - layout.bounds.minX;
      // Start a new row
      rowYOffset += rowHeight + spacing;
    }

    nodeAdjustments.set(node.id, { dx: -rowXOffset, dy: rowYOffset });
  });

  // Apply adjustments
  const wrappedNodes = nodes.map((node) => {
    const adj = nodeAdjustments.get(node.id) || { dx: 0, dy: 0 };
    return {
      ...node,
      x: node.x + adj.dx,
      y: node.y + adj.dy,
    };
  });

  // Recompute groups if present
  const wrappedGroups = layout.groups
    ? computeGroupBoundsFromNodes(layout.groups, wrappedNodes)
    : undefined;

  // Recompute edge paths with updated node positions (using proper edge connections)
  const nodeMap = new Map(wrappedNodes.map((n) => [n.id, n]));
  const wrappedEdges = layout.edges.map((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) {
      return edge;
    }

    // Calculate center points
    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    // Determine which edge to connect from based on relative position
    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    let fromPoint: { x: number; y: number };
    let toPoint: { x: number; y: number };

    if (absDy > absDx) {
      // Primarily vertical
      if (dy > 0) {
        fromPoint = { x: fromCenterX, y: fromNode.y + fromNode.height };
        toPoint = { x: toCenterX, y: toNode.y };
      } else {
        fromPoint = { x: fromCenterX, y: fromNode.y };
        toPoint = { x: toCenterX, y: toNode.y + toNode.height };
      }
    } else {
      // Primarily horizontal
      if (dx > 0) {
        fromPoint = { x: fromNode.x + fromNode.width, y: fromCenterY };
        toPoint = { x: toNode.x, y: toCenterY };
      } else {
        fromPoint = { x: fromNode.x, y: fromCenterY };
        toPoint = { x: toNode.x + toNode.width, y: toCenterY };
      }
    }

    // Add small gap from node boundaries
    const gap = 4;
    const edgeDx = toPoint.x - fromPoint.x;
    const edgeDy = toPoint.y - fromPoint.y;
    const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

    if (length > gap * 2) {
      const dirX = edgeDx / length;
      const dirY = edgeDy / length;
      fromPoint.x += dirX * gap;
      fromPoint.y += dirY * gap;
      toPoint.x -= dirX * gap;
      toPoint.y -= dirY * gap;
    }

    const path = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
    const points = [
      fromPoint,
      { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 },
      toPoint,
    ];

    return {
      ...edge,
      path,
      points,
    };
  });

  // Recompute bounds (including edge points for routing tracks)
  const bounds = computeBoundsFromNodes(wrappedNodes, wrappedGroups, wrappedEdges);

  return {
    nodes: wrappedNodes,
    edges: wrappedEdges,
    groups: wrappedGroups,
    bounds,
  };
}

/**
 * Helper to recompute group bounds from adjusted nodes
 */
function computeGroupBoundsFromNodes(
  groups: ComputedGroup[],
  nodes: ComputedNode[],
): ComputedGroup[] {
  return groups.map((group) => {
    // Find nodes that were in this group's bounds
    const groupNodes = nodes.filter(
      (n) =>
        n.x >= group.x - 30 &&
        n.x <= group.x + group.width + 30 &&
        n.y >= group.y - 30 &&
        n.y <= group.y + group.height + 30,
    );

    if (groupNodes.length === 0) {
      return group;
    }

    const padding = 30;
    const headerPadding = 40; // Account for group label/header
    const minX = Math.min(...groupNodes.map((n) => n.x)) - padding;
    const minY = Math.min(...groupNodes.map((n) => n.y)) - padding - headerPadding;
    const maxX = Math.max(...groupNodes.map((n) => n.x + n.width)) + padding;
    const maxY = Math.max(...groupNodes.map((n) => n.y + n.height)) + padding;

    return {
      ...group,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  });
}

/**
 * Helper to compute bounds from nodes (also includes edges for routing tracks)
 */
function computeBoundsFromNodes(nodes: ComputedNode[], groups?: ComputedGroup[], edges?: ComputedEdge[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Math.min(...nodes.map((n) => n.x));
  let minY = Math.min(...nodes.map((n) => n.y));
  let maxX = Math.max(...nodes.map((n) => n.x + n.width));
  let maxY = Math.max(...nodes.map((n) => n.y + n.height));

  if (groups && groups.length > 0) {
    minX = Math.min(minX, ...groups.map((g) => g.x));
    minY = Math.min(minY, ...groups.map((g) => g.y));
    maxX = Math.max(maxX, ...groups.map((g) => g.x + g.width));
    maxY = Math.max(maxY, ...groups.map((g) => g.y + g.height));
  }

  // Include edge points in bounds calculation (for routing tracks)
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Internal function to compute layout with a specific direction
 */
function computeLayoutWithDirection(
  nodesWithSizes: (DiagramNode & { size: { width: number; height: number } })[],
  model: DiagramModel,
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedLayout {
  // Compute node positions
  const computedNodes = computeNodePositions(
    nodesWithSizes,
    model.edges,
    layout,
    nodeDefaults,
    model.groups,
  );

  // Compute edge paths
  const computedEdges = computeEdgePaths(model.edges, computedNodes, layout);

  // Deduplicate edge IDs to prevent Svelte {#each} key collisions
  const edgeIdCounts = new Map<string, number>();
  for (const edge of computedEdges) {
    const originalId = edge.id;
    const count = edgeIdCounts.get(originalId) ?? 0;
    if (count > 0) {
      edge.id = `${originalId}-${count}`;
    }
    edgeIdCounts.set(originalId, count + 1);
  }

  // Compute group bounds
  const computedGroups = model.groups ? computeGroupBounds(model.groups, computedNodes) : undefined;

  // Compute overall bounds (including groups and edge routing tracks)
  const bounds = computeBounds(computedNodes, computedGroups, computedEdges);

  return {
    nodes: computedNodes,
    edges: computedEdges,
    groups: computedGroups,
    bounds,
  };
}

/**
 * Compute node size based on text content
 * Uses the style config for font metrics to ensure consistency with CSS
 */
function computeNodeSize(
  node: DiagramNode,
  defaults: { width: number; height: number },
  style: NodeStyleConfig,
): { width: number; height: number } {
  // Use style config for all measurements
  const LABEL_CHAR_WIDTH = style.labelFontSize * style.labelCharWidthRatio;
  const KIND_CHAR_WIDTH = style.kindFontSize * style.kindCharWidthRatio;

  // Measure label - account for word wrapping
  // For short labels (1-2 words), don't wrap
  const words = node.label.split(/\s+/);
  const isShortLabel = words.length <= 2 && node.label.length <= 20;

  let labelWidth: number;
  let labelLines = 1;

  if (isShortLabel) {
    // Single line for short labels
    labelWidth = node.label.length * LABEL_CHAR_WIDTH;
  } else {
    // For longer labels, estimate wrapping at a reasonable width
    // Allow wider nodes for long labels, but cap at maxWidth
    const estimatedWidth = node.label.length * LABEL_CHAR_WIDTH;
    const maxLineWidth = Math.min(estimatedWidth, style.maxWidth - style.paddingX * 2);
    labelWidth = maxLineWidth;
    labelLines = Math.min(
      Math.ceil((node.label.length * LABEL_CHAR_WIDTH) / maxLineWidth),
      style.maxLines,
    );
  }

  const labelHeight = style.labelFontSize * style.labelLineHeight * labelLines;

  // Measure kind (if present)
  let kindWidth = 0;
  let kindHeight = 0;
  if (node.kind) {
    kindWidth = node.kind.length * KIND_CHAR_WIDTH;
    kindHeight = style.kindFontSize * style.kindLineHeight;
  }

  // Calculate total size
  const contentWidth = Math.max(labelWidth, kindWidth);
  const contentHeight = labelHeight + (node.kind ? style.gap + kindHeight : 0);

  // Ensure minimum size but allow nodes to be smaller for short labels
  const minWidth = isShortLabel ? 80 : defaults.width * 0.6;
  const width = Math.min(Math.max(contentWidth + style.paddingX * 2, minWidth), style.maxWidth);
  const height = Math.max(contentHeight + style.paddingY * 2, defaults.height * 0.6);

  return { width, height };
}

/**
 * Compute node positions based on layout type
 */
function computeNodePositions(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  // If nodes have manual positions, use them
  const hasManualPositions = nodes.some((n) => n.position);

  if (hasManualPositions || layout.type === 'manual') {
    // Collect manually positioned nodes first
    const manualNodes: Array<{ x: number; y: number; width: number; height: number }> = [];
    const result: ComputedNode[] = [];

    // First pass: place manually positioned nodes and collect their bounds
    for (const node of nodes) {
      const width = node.size?.width ?? nodeDefaults.width;
      const height = node.size?.height ?? nodeDefaults.height;
      if (node.position) {
        const placed = { ...node, x: node.position.x, y: node.position.y, width, height };
        result.push(placed);
        manualNodes.push(placed);
      } else {
        // Placeholder - will be repositioned below
        result.push({ ...node, x: 0, y: 0, width, height });
      }
    }

    // Second pass: position unpositioned nodes avoiding manual ones
    const spacing = clampSpacing(layout.spacing, 80);
    for (let i = 0; i < result.length; i++) {
      const node = nodes[i];
      if (node.position) continue; // Already placed

      const width = result[i].width;
      const height = result[i].height;

      // Find a position that doesn't overlap with any existing node
      let bestX = 0;
      let bestY = 0;
      let placed = false;

      // Try positions in a grid pattern, checking for overlaps
      for (let row = 0; row < 20 && !placed; row++) {
        for (let col = 0; col < 20 && !placed; col++) {
          const candidateX = col * (width + spacing);
          const candidateY = row * (height + spacing);

          const overlaps = manualNodes.some((mn) => {
            return !(candidateX + width + spacing * 0.3 < mn.x ||
                     candidateX > mn.x + mn.width + spacing * 0.3 ||
                     candidateY + height + spacing * 0.3 < mn.y ||
                     candidateY > mn.y + mn.height + spacing * 0.3);
          });

          if (!overlaps) {
            bestX = candidateX;
            bestY = candidateY;
            placed = true;
          }
        }
      }

      result[i] = { ...result[i], x: bestX, y: bestY };
      manualNodes.push({ x: bestX, y: bestY, width, height });
    }

    return result;
  }

  // Otherwise, compute positions based on layout type
  switch (layout.type) {
    case 'layered':
      return computeLayeredLayout(nodes, edges, layout, nodeDefaults, groups);
    case 'force':
      return computeForceLayout(nodes, edges, layout, nodeDefaults, groups);
    case 'circular':
      return computeCircularLayout(nodes, layout, nodeDefaults);
    case 'tree':
      return computeTreeLayout(nodes, edges, layout, nodeDefaults);
    default:
      return computeLayeredLayout(nodes, edges, layout, nodeDefaults, groups);
  }
}

/**
 * Compute layered layout (Sugiyama-style)
 * Implements a proper hierarchical layout with:
 * - Topological layer assignment based on edge dependencies
 * - Group-aware positioning with clear separation
 * - Barycenter-based crossing minimization
 */
function computeLayeredLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 80);
  const direction = layout.direction ?? 'LR';
  const isHorizontal = direction === 'LR' || direction === 'RL';

  // Build group membership map
  const nodeToGroup = new Map<string, string>();
  if (groups) {
    groups.forEach((group) => {
      if (Array.isArray(group.nodeIds)) {
        group.nodeIds.forEach((nodeId) => nodeToGroup.set(nodeId, group.id));
      }
    });
    nodes.forEach((node) => {
      if (node.group) nodeToGroup.set(node.id, node.group);
    });
  }

  // Build adjacency lists
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  // Compute node sizes
  const nodeSizes = new Map<string, { width: number; height: number }>();
  nodes.forEach((node) => {
    nodeSizes.set(node.id, {
      width: node.size?.width ?? nodeDefaults.width,
      height: node.size?.height ?? nodeDefaults.height,
    });
  });

  // If we have groups, use hierarchical group-based layout
  if (groups && groups.length > 0) {
    return computeHierarchicalGroupLayout(
      nodes, edges, groups, nodeSizes, nodeToGroup, outgoing, incoming, spacing, isHorizontal,
    );
  }

  // No groups - use standard hierarchical layout
  return computeStandardHierarchicalLayout(
    nodes, edges, nodeSizes, outgoing, incoming, spacing, isHorizontal,
  );
}

/**
 * Compute hierarchical layout for diagrams with groups
 * Places groups in a grid based on dependency flow, then positions nodes within groups
 */
function computeHierarchicalGroupLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  groups: DiagramGroup[],
  nodeSizes: Map<string, { width: number; height: number }>,
  nodeToGroup: Map<string, string>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  spacing: number,
  isHorizontal: boolean,
): ComputedNode[] {
  const UNGROUPED = '__ungrouped__';
  const GROUP_PADDING = 40; // Padding around group contents
  const GROUP_SPACING = spacing * 1.2; // Space between groups
  const NODE_SPACING = spacing * 0.4; // Space between nodes in same group

  // Step 1: Assign nodes to groups
  const groupNodes = new Map<string, string[]>();
  groups.forEach((g) => groupNodes.set(g.id, []));
  groupNodes.set(UNGROUPED, []);

  nodes.forEach((node) => {
    const gid = nodeToGroup.get(node.id) || UNGROUPED;
    if (!groupNodes.has(gid)) groupNodes.set(gid, []);
    groupNodes.get(gid)!.push(node.id);
  });

  // Step 2: Build group dependency graph
  const groupOutgoing = new Map<string, Set<string>>();
  const groupIncoming = new Map<string, Set<string>>();
  const allGroupIds = [...groups.map(g => g.id), UNGROUPED];
  allGroupIds.forEach((gid) => {
    groupOutgoing.set(gid, new Set());
    groupIncoming.set(gid, new Set());
  });

  edges.forEach((edge) => {
    const fromGroup = nodeToGroup.get(edge.from) || UNGROUPED;
    const toGroup = nodeToGroup.get(edge.to) || UNGROUPED;
    if (fromGroup !== toGroup) {
      groupOutgoing.get(fromGroup)?.add(toGroup);
      groupIncoming.get(toGroup)?.add(fromGroup);
    }
  });

  // Step 3: Assign groups to layers using longest path algorithm
  const groupLayer = new Map<string, number>();
  const visited = new Set<string>();

  function assignGroupLayer(gid: string): number {
    if (groupLayer.has(gid)) return groupLayer.get(gid)!;
    if (visited.has(gid)) return 0; // Cycle detected
    visited.add(gid);

    const deps = groupIncoming.get(gid) || new Set();
    let maxDepLayer = -1;
    deps.forEach((depGid) => {
      maxDepLayer = Math.max(maxDepLayer, assignGroupLayer(depGid));
    });

    const layer = maxDepLayer + 1;
    groupLayer.set(gid, layer);
    return layer;
  }

  allGroupIds.forEach((gid) => {
    if ((groupNodes.get(gid)?.length ?? 0) > 0) {
      assignGroupLayer(gid);
    }
  });

  // Step 4: Organize groups into layers
  const maxGroupLayer = Math.max(...Array.from(groupLayer.values()), 0);
  const groupLayers: string[][] = Array.from({ length: maxGroupLayer + 1 }, () => []);

  groupLayer.forEach((layer, gid) => {
    if ((groupNodes.get(gid)?.length ?? 0) > 0) {
      groupLayers[layer].push(gid);
    }
  });

  // Step 5: Compute intra-group layered layout for each group
  // For each group, build a sub-graph and run mini Sugiyama-style layout
  const groupInternalLayouts = new Map<string, { layers: string[][]; nodeLayer: Map<string, number> }>();
  const groupDimensions = new Map<string, { width: number; height: number }>();

  // Build intra-group edge maps
  const intraGroupOutgoing = new Map<string, string[]>();
  const intraGroupIncoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    intraGroupOutgoing.set(node.id, []);
    intraGroupIncoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    const fromGroup = nodeToGroup.get(edge.from) || UNGROUPED;
    const toGroup = nodeToGroup.get(edge.to) || UNGROUPED;
    if (fromGroup === toGroup) {
      intraGroupOutgoing.get(edge.from)?.push(edge.to);
      intraGroupIncoming.get(edge.to)?.push(edge.from);
    }
  });

  allGroupIds.forEach((gid) => {
    const nodeIds = groupNodes.get(gid) || [];
    if (nodeIds.length === 0) {
      groupDimensions.set(gid, { width: 0, height: 0 });
      groupInternalLayouts.set(gid, { layers: [], nodeLayer: new Map() });
      return;
    }

    const nodeIdSet = new Set(nodeIds);

    // Assign layers within the group using longest path
    const nodeLayer = new Map<string, number>();
    const layerVisited = new Set<string>();

    function assignIntraLayer(nodeId: string): number {
      if (nodeLayer.has(nodeId)) return nodeLayer.get(nodeId)!;
      if (layerVisited.has(nodeId)) return 0;
      layerVisited.add(nodeId);

      const deps = (intraGroupIncoming.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
      let maxDepLayer = -1;
      deps.forEach((depId) => {
        maxDepLayer = Math.max(maxDepLayer, assignIntraLayer(depId));
      });

      const layer = maxDepLayer + 1;
      nodeLayer.set(nodeId, layer);
      return layer;
    }

    nodeIds.forEach((nid) => assignIntraLayer(nid));

    // Organize into layers
    const maxLayer = Math.max(...Array.from(nodeLayer.values()), 0);
    const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    nodeLayer.forEach((layer, nodeId) => {
      if (nodeIdSet.has(nodeId)) layers[layer].push(nodeId);
    });

    // Barycenter crossing minimization within the group (4 passes)
    for (let pass = 0; pass < 4; pass++) {
      // Down sweep
      for (let i = 1; i < layers.length; i++) {
        const layer = layers[i];
        const prevLayer = layers[i - 1];
        const barycenters = new Map<string, number>();
        layer.forEach((nodeId) => {
          const inNodes = (intraGroupIncoming.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
          const positions = inNodes.map((id) => prevLayer.indexOf(id)).filter((pos) => pos !== -1);
          if (positions.length > 0) {
            barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
          } else {
            barycenters.set(nodeId, layer.indexOf(nodeId));
          }
        });
        layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      }
      // Up sweep
      for (let i = layers.length - 2; i >= 0; i--) {
        const layer = layers[i];
        const nextLayer = layers[i + 1];
        const barycenters = new Map<string, number>();
        layer.forEach((nodeId) => {
          const outNodes = (intraGroupOutgoing.get(nodeId) || []).filter((id) => nodeIdSet.has(id));
          const positions = outNodes.map((id) => nextLayer.indexOf(id)).filter((pos) => pos !== -1);
          if (positions.length > 0) {
            barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
          } else {
            barycenters.set(nodeId, layer.indexOf(nodeId));
          }
        });
        layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
      }
    }

    groupInternalLayouts.set(gid, { layers, nodeLayer });

    // Calculate group dimensions based on multi-layer layout
    const INTRA_LAYER_SPACING = spacing * 0.7; // spacing between layers within group
    let totalPrimary = 0;
    let maxSecondary = 0;

    layers.forEach((layer, layerIdx) => {
      let layerPrimary = 0;
      let layerSecondary = 0;

      layer.forEach((nodeId) => {
        const size = nodeSizes.get(nodeId)!;
        if (isHorizontal) {
          layerSecondary += size.height + NODE_SPACING;
          layerPrimary = Math.max(layerPrimary, size.width);
        } else {
          layerSecondary += size.width + NODE_SPACING;
          layerPrimary = Math.max(layerPrimary, size.height);
        }
      });

      layerSecondary -= NODE_SPACING; // Remove last spacing
      maxSecondary = Math.max(maxSecondary, layerSecondary);
      totalPrimary += layerPrimary;
      if (layerIdx > 0) totalPrimary += INTRA_LAYER_SPACING;
    });

    const width = isHorizontal ? totalPrimary + GROUP_PADDING * 2 : maxSecondary + GROUP_PADDING * 2;
    const height = isHorizontal ? maxSecondary + GROUP_PADDING * 2 : totalPrimary + GROUP_PADDING * 2;

    groupDimensions.set(gid, { width, height });
  });

  // Step 6: Inter-group barycenter ordering within each layer
  // Order groups in the same layer to minimize cross-group edge crossings
  for (let pass = 0; pass < 4; pass++) {
    // Down sweep
    for (let i = 1; i < groupLayers.length; i++) {
      const layer = groupLayers[i];
      const prevLayer = groupLayers[i - 1];
      const barycenters = new Map<string, number>();
      layer.forEach((gid) => {
        const inGroups = Array.from(groupIncoming.get(gid) || []);
        const positions = inGroups.map((id) => prevLayer.indexOf(id)).filter((pos) => pos !== -1);
        if (positions.length > 0) {
          barycenters.set(gid, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(gid, layer.indexOf(gid));
        }
      });
      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
    // Up sweep
    for (let i = groupLayers.length - 2; i >= 0; i--) {
      const layer = groupLayers[i];
      const nextLayer = groupLayers[i + 1];
      const barycenters = new Map<string, number>();
      layer.forEach((gid) => {
        const outGroups = Array.from(groupOutgoing.get(gid) || []);
        const positions = outGroups.map((id) => nextLayer.indexOf(id)).filter((pos) => pos !== -1);
        if (positions.length > 0) {
          barycenters.set(gid, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(gid, layer.indexOf(gid));
        }
      });
      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
  }

  // Step 7: Position groups
  const groupPositions = new Map<string, { x: number; y: number }>();
  let primaryOffset = 0;

  groupLayers.forEach((layerGroups) => {
    let secondaryOffset = 0;
    let maxPrimarySize = 0;

    layerGroups.forEach((gid) => {
      const dim = groupDimensions.get(gid)!;

      if (isHorizontal) {
        groupPositions.set(gid, { x: primaryOffset, y: secondaryOffset });
        secondaryOffset += dim.height + GROUP_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, dim.width);
      } else {
        groupPositions.set(gid, { x: secondaryOffset, y: primaryOffset });
        secondaryOffset += dim.width + GROUP_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, dim.height);
      }
    });

    primaryOffset += maxPrimarySize + GROUP_SPACING;
  });

  // Step 8: Position nodes within groups using intra-group layers
  const positioned: ComputedNode[] = [];
  const INTRA_LAYER_SPACING = spacing * 0.7;

  allGroupIds.forEach((gid) => {
    const nodeIds = groupNodes.get(gid) || [];
    const groupPos = groupPositions.get(gid);
    const internalLayout = groupInternalLayouts.get(gid);
    if (!groupPos || nodeIds.length === 0 || !internalLayout) return;

    const { layers } = internalLayout;
    let layerPrimaryOffset = GROUP_PADDING;

    layers.forEach((layer) => {
      // Calculate total secondary size for centering within the group
      let totalSecondary = 0;
      layer.forEach((nodeId) => {
        const size = nodeSizes.get(nodeId)!;
        totalSecondary += (isHorizontal ? size.height : size.width) + NODE_SPACING;
      });
      totalSecondary -= NODE_SPACING;

      // Center nodes in the secondary direction within the group
      const groupDim = groupDimensions.get(gid)!;
      const groupSecondarySize = isHorizontal ? groupDim.height : groupDim.width;
      let nodeSecondaryOffset = GROUP_PADDING + (groupSecondarySize - GROUP_PADDING * 2 - totalSecondary) / 2;

      let maxLayerPrimary = 0;

      layer.forEach((nodeId) => {
        const node = nodes.find((n) => n.id === nodeId)!;
        const size = nodeSizes.get(nodeId)!;

        let x, y;
        if (isHorizontal) {
          x = groupPos.x + layerPrimaryOffset;
          y = groupPos.y + nodeSecondaryOffset;
          nodeSecondaryOffset += size.height + NODE_SPACING;
          maxLayerPrimary = Math.max(maxLayerPrimary, size.width);
        } else {
          x = groupPos.x + nodeSecondaryOffset;
          y = groupPos.y + layerPrimaryOffset;
          nodeSecondaryOffset += size.width + NODE_SPACING;
          maxLayerPrimary = Math.max(maxLayerPrimary, size.height);
        }

        positioned.push({ ...node, x, y, width: size.width, height: size.height });
      });

      layerPrimaryOffset += maxLayerPrimary + INTRA_LAYER_SPACING;
    });
  });

  return positioned;
}

/**
 * Compute standard hierarchical layout without groups
 */
function computeStandardHierarchicalLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  nodeSizes: Map<string, { width: number; height: number }>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  spacing: number,
  isHorizontal: boolean,
): ComputedNode[] {
  // Assign nodes to layers using longest path algorithm
  const nodeLayer = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(nodeId: string): number {
    if (nodeLayer.has(nodeId)) return nodeLayer.get(nodeId)!;
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    const deps = incoming.get(nodeId) || [];
    let maxDepLayer = -1;
    deps.forEach((depId) => {
      maxDepLayer = Math.max(maxDepLayer, assignLayer(depId));
    });

    const layer = maxDepLayer + 1;
    nodeLayer.set(nodeId, layer);
    return layer;
  }

  nodes.forEach((node) => assignLayer(node.id));

  // Organize nodes into layers
  const maxLayer = Math.max(...Array.from(nodeLayer.values()), 0);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);

  nodeLayer.forEach((layer, nodeId) => {
    layers[layer].push(nodeId);
  });

  // Minimize crossings using barycenter heuristic
  for (let pass = 0; pass < 4; pass++) {
    // Down sweep
    for (let i = 1; i < layers.length; i++) {
      const layer = layers[i];
      const prevLayer = layers[i - 1];

      const barycenters = new Map<string, number>();
      layer.forEach((nodeId) => {
        const inNodes = incoming.get(nodeId) || [];
        const positions = inNodes
          .map((id) => prevLayer.indexOf(id))
          .filter((pos) => pos !== -1);

        if (positions.length > 0) {
          barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(nodeId, layer.indexOf(nodeId));
        }
      });

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }

    // Up sweep
    for (let i = layers.length - 2; i >= 0; i--) {
      const layer = layers[i];
      const nextLayer = layers[i + 1];

      const barycenters = new Map<string, number>();
      layer.forEach((nodeId) => {
        const outNodes = outgoing.get(nodeId) || [];
        const positions = outNodes
          .map((id) => nextLayer.indexOf(id))
          .filter((pos) => pos !== -1);

        if (positions.length > 0) {
          barycenters.set(nodeId, positions.reduce((a, b) => a + b, 0) / positions.length);
        } else {
          barycenters.set(nodeId, layer.indexOf(nodeId));
        }
      });

      layer.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }
  }

  // Position nodes
  const positioned: ComputedNode[] = [];
  const LAYER_SPACING = spacing * 0.8;
  const NODE_SPACING = spacing * 0.4;

  let primaryOffset = 0;

  layers.forEach((layer) => {
    let maxPrimarySize = 0;
    let secondaryOffset = 0;

    // Center the layer
    const totalSecondary = layer.reduce((sum, nodeId) => {
      const size = nodeSizes.get(nodeId)!;
      return sum + (isHorizontal ? size.height : size.width) + NODE_SPACING;
    }, -NODE_SPACING);

    secondaryOffset = -totalSecondary / 2;

    layer.forEach((nodeId) => {
      const node = nodes.find((n) => n.id === nodeId)!;
      const size = nodeSizes.get(nodeId)!;

      let x, y;
      if (isHorizontal) {
        x = primaryOffset;
        y = secondaryOffset;
        secondaryOffset += size.height + NODE_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, size.width);
      } else {
        x = secondaryOffset;
        y = primaryOffset;
        secondaryOffset += size.width + NODE_SPACING;
        maxPrimarySize = Math.max(maxPrimarySize, size.height);
      }

      positioned.push({ ...node, x, y, width: size.width, height: size.height });
    });

    primaryOffset += maxPrimarySize + LAYER_SPACING;
  });

  return positioned;
}

/**
 * Compute force-directed layout
 * Spring-based layout with repulsion, attraction, and edge-crossing avoidance
 */
function computeForceLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
  groups?: DiagramGroup[],
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 100);
  const direction = layout.direction ?? 'LR';
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const iterations = 150; // More iterations for better convergence
  const repulsionStrength = spacing * spacing * 8; // Moderate repulsion to prevent overlap
  const attractionStrength = 0.04; // Stronger attraction for direct edges
  const edgeCrossingPenalty = 1.5; // Lower penalty for edge crossings
  const damping = 0.7; // Lower damping for more movement

  // Build group membership map
  // Handle both cases: groups with nodeIds arrays AND nodes with group property
  const nodeToGroup = new Map<string, string>();
  if (groups) {
    // First, check groups for nodeIds
    groups.forEach((group) => {
      if (Array.isArray(group.nodeIds)) {
        group.nodeIds.forEach((nodeId) => {
          nodeToGroup.set(nodeId, group.id);
        });
      }
    });
    // Then, check nodes for group property (takes precedence if both exist)
    nodes.forEach((node) => {
      if (node.group) {
        nodeToGroup.set(node.id, node.group);
      }
    });
  }

  // Build adjacency for better initial positioning
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });
  edges.forEach((edge) => {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  });

  // Initialize positions using a simple hierarchical layout for better starting point
  const nodeDepth = new Map<string, number>();
  const visited = new Set<string>();

  // Find root nodes (no incoming edges)
  const roots = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0);
  const startNodes = roots.length > 0 ? roots : [nodes[0]];

  // BFS to assign depths
  const queue: Array<{ id: string; depth: number }> = startNodes.map((n) => ({
    id: n.id,
    depth: 0,
  }));
  let maxDepth = 0;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    nodeDepth.set(id, depth);
    maxDepth = Math.max(maxDepth, depth);

    const children = outgoing.get(id) ?? [];
    children.forEach((childId) => {
      if (!visited.has(childId)) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    });
  }

  // Assign depths to unvisited nodes
  nodes.forEach((node) => {
    if (!nodeDepth.has(node.id)) {
      nodeDepth.set(node.id, 0);
    }
  });

  // Count nodes at each depth for positioning
  const nodesAtDepth = new Map<number, number>();
  nodeDepth.forEach((depth) => {
    nodesAtDepth.set(depth, (nodesAtDepth.get(depth) ?? 0) + 1);
  });

  const depthCounters = new Map<number, number>();

  // Pre-position groups if they exist (compact hierarchical layout)
  const groupCenters = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  if (groups && groups.length > 0) {
    // Arrange groups in a grid layout with minimal spacing
    const numGroups = groups.length;

    // For horizontal layouts, prefer more columns (horizontal arrangement)
    // For vertical layouts, prefer more rows (vertical arrangement)
    let cols: number, rows: number;
    if (isHorizontal) {
      cols = numGroups; // All groups in a row for horizontal layout
      rows = 1;
    } else {
      cols = 1; // All groups in a column for vertical layout
      rows = numGroups;
    }

    const groupSpacing = spacing * 0.8; // Very compact spacing between group centers

    groups.forEach((group, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const centerX = (col - (cols - 1) / 2) * groupSpacing;
      const centerY = (row - (rows - 1) / 2) * groupSpacing;

      groupCenters.set(group.id, {
        x: isHorizontal ? centerX : centerY,
        y: isHorizontal ? centerY : centerX,
        vx: 0,
        vy: 0,
      });
    });
  }

  // Initialize positions based on depth and group membership
  const positions = nodes.map((node) => {
    const depth = nodeDepth.get(node.id) ?? 0;
    const countAtDepth = nodesAtDepth.get(depth) ?? 1;
    const indexAtDepth = depthCounters.get(depth) ?? 0;
    depthCounters.set(depth, indexAtDepth + 1);

    // Position based on depth and index within depth
    // Use compact spacing
    const primaryMultiplier = isHorizontal ? 2 : 1.5;
    const secondaryMultiplier = isHorizontal ? 1 : 1.2;

    const primaryPos = (depth / Math.max(maxDepth, 1)) * spacing * primaryMultiplier;
    let secondaryPos =
      ((indexAtDepth - countAtDepth / 2) / Math.max(countAtDepth, 1)) *
      spacing *
      secondaryMultiplier;

    // If node belongs to a group, position it near the group center
    const groupId = nodeToGroup.get(node.id);
    if (groupId && groupCenters.has(groupId)) {
      const groupCenter = groupCenters.get(groupId)!;
      // For horizontal layouts: keep depth-based X, use group center for Y
      // For vertical layouts: keep depth-based Y, use group center for X
      if (isHorizontal) {
        // primaryPos is X (depth-based, keep it)
        // secondaryPos is Y (use group center instead)
        secondaryPos = groupCenter.y + secondaryPos * 0.2;
      } else {
        // primaryPos is Y (depth-based, keep it)
        // secondaryPos is X (use group center instead)
        secondaryPos = groupCenter.x + secondaryPos * 0.2;
      }
    }

    // Add small random jitter to help force simulation spread nodes out
    // Use node ID as seed for deterministic randomness
    const seed = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const jitterX = ((seed % 100) / 100 - 0.5) * spacing * 0.1;
    const jitterY = (((seed * 7) % 100) / 100 - 0.5) * spacing * 0.1;

    return {
      node,
      x: (isHorizontal ? primaryPos : secondaryPos) + jitterX,
      y: (isHorizontal ? secondaryPos : primaryPos) + jitterY,
      vx: 0,
      vy: 0,
      width: node.size?.width ?? nodeDefaults.width,
      height: node.size?.height ?? nodeDefaults.height,
    };
  });

  // Build position lookup
  const getPos = (nodeId: string) => positions.find((p) => p.node.id === nodeId);

  // Simulation
  for (let iter = 0; iter < iterations; iter++) {
    // Reset forces
    positions.forEach((p) => {
      p.vx = 0;
      p.vy = 0;
    });

    // Repulsion between all nodes (stronger for non-connected nodes)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);

        // Stronger repulsion for overlapping or very close nodes
        const minDistX = (positions[i].width + positions[j].width) / 2 + spacing * 0.25;
        const minDistY = (positions[i].height + positions[j].height) / 2 + spacing * 0.25;
        const minDist = Math.sqrt(minDistX * minDistX + minDistY * minDistY);
        const force =
          dist < minDist
            ? (repulsionStrength * 3) / distSq // Stronger repulsion when too close
            : (repulsionStrength * 1.0) / distSq; // Base repulsion

        // Bias repulsion based on direction
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;

        if (isHorizontal) {
          fx *= 1.5; // Stronger horizontal repulsion
          fy *= 0.6; // Weaker vertical repulsion
        } else {
          fx *= 0.6; // Weaker horizontal repulsion
          fy *= 1.5; // Stronger vertical repulsion
        }

        positions[i].vx -= fx;
        positions[i].vy -= fy;
        positions[j].vx += fx;
        positions[j].vy += fy;
      }
    }

    // Attraction along edges
    edges.forEach((edge) => {
      const fromPos = getPos(edge.from);
      const toPos = getPos(edge.to);
      if (!fromPos || !toPos) return;

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + 0.01);
      const force = attractionStrength * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      fromPos.vx += fx;
      fromPos.vy += fy;
      toPos.vx -= fx;
      toPos.vy -= fy;
    });

    // Edge crossing avoidance: push nodes away from non-incident edges
    positions.forEach((nodePos) => {
      edges.forEach((edge) => {
        // Skip edges connected to this node
        if (edge.from === nodePos.node.id || edge.to === nodePos.node.id) return;

        const fromPos = getPos(edge.from);
        const toPos = getPos(edge.to);
        if (!fromPos || !toPos) return;

        // Calculate distance from node to edge line segment
        const edgeDx = toPos.x - fromPos.x;
        const edgeDy = toPos.y - fromPos.y;
        const edgeLengthSq = edgeDx * edgeDx + edgeDy * edgeDy;

        if (edgeLengthSq < 0.01) return;

        // Project node onto edge line
        const t = Math.max(
          0,
          Math.min(
            1,
            ((nodePos.x - fromPos.x) * edgeDx + (nodePos.y - fromPos.y) * edgeDy) / edgeLengthSq,
          ),
        );

        // Only apply force if projection is within the edge segment (not at endpoints)
        // This prevents pushing nodes away from edges they're not actually blocking
        if (t < 0.1 || t > 0.9) return;

        const closestX = fromPos.x + t * edgeDx;
        const closestY = fromPos.y + t * edgeDy;

        const dx = nodePos.x - closestX;
        const dy = nodePos.y - closestY;
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);

        // Apply strong repulsion if node is too close to edge
        // Use node dimensions to calculate proper clearance
        const nodeRadius = Math.max(nodePos.width, nodePos.height) / 2;
        const threshold = nodeRadius + spacing * 0.1;

        if (dist < threshold) {
          // Exponential force - gets much stronger as distance decreases
          const normalizedDist = dist / threshold;
          const force = edgeCrossingPenalty * (1 - normalizedDist) * (1 - normalizedDist) * spacing;
          nodePos.vx += (dx / dist) * force;
          nodePos.vy += (dy / dist) * force;
        }
      });
    });

    // Edge-edge crossing minimization: detect crossing edges and push their endpoints apart
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const edge1 = edges[i];
        const edge2 = edges[j];

        // Skip if edges share a node
        if (
          edge1.from === edge2.from ||
          edge1.from === edge2.to ||
          edge1.to === edge2.from ||
          edge1.to === edge2.to
        )
          continue;

        const from1 = getPos(edge1.from);
        const to1 = getPos(edge1.to);
        const from2 = getPos(edge2.from);
        const to2 = getPos(edge2.to);

        if (!from1 || !to1 || !from2 || !to2) continue;

        // Check if edges cross using line segment intersection
        const det = (to1.x - from1.x) * (to2.y - from2.y) - (to1.y - from1.y) * (to2.x - from2.x);
        if (Math.abs(det) < 0.01) continue; // Parallel or nearly parallel

        const t1 =
          ((from2.x - from1.x) * (to2.y - from2.y) - (from2.y - from1.y) * (to2.x - from2.x)) / det;
        const t2 =
          ((from2.x - from1.x) * (to1.y - from1.y) - (from2.y - from1.y) * (to1.x - from1.x)) / det;

        // If edges cross (or nearly cross), apply repulsion to separate them
        if (t1 > 0.1 && t1 < 0.9 && t2 > 0.1 && t2 < 0.9) {
          const crossingForce = edgeCrossingPenalty * spacing * 0.15;

          // Push edge1 endpoints perpendicular to edge2
          const edge2Dx = to2.x - from2.x;
          const edge2Dy = to2.y - from2.y;
          const edge2Len = Math.sqrt(edge2Dx * edge2Dx + edge2Dy * edge2Dy);
          const perpX = -edge2Dy / edge2Len;
          const perpY = edge2Dx / edge2Len;

          // Determine which side of edge2 the edge1 endpoints are on
          const side1 =
            (to2.x - from2.x) * (from1.y - from2.y) - (to2.y - from2.y) * (from1.x - from2.x);
          const direction = side1 > 0 ? 1 : -1;

          from1.vx += perpX * crossingForce * direction;
          from1.vy += perpY * crossingForce * direction;
          to1.vx += perpX * crossingForce * direction;
          to1.vy += perpY * crossingForce * direction;

          // Push edge2 endpoints in opposite direction
          from2.vx -= perpX * crossingForce * direction;
          from2.vy -= perpY * crossingForce * direction;
          to2.vx -= perpX * crossingForce * direction;
          to2.vy -= perpY * crossingForce * direction;
        }
      }
    }

    // Compact hierarchical group forces
    if (groups && groups.length > 0 && groupCenters.size > 0) {
      // Reset group center velocities
      groupCenters.forEach((center) => {
        center.vx = 0;
        center.vy = 0;
      });

      // 1. Group-level repulsion: Keep group centers separated (weaker for compactness)
      const groupRepulsionStrength = spacing * spacing * 5.0; // Moderate repulsion
      const groupCenterArray = Array.from(groupCenters.entries());

      for (let i = 0; i < groupCenterArray.length; i++) {
        for (let j = i + 1; j < groupCenterArray.length; j++) {
          const [, centerI] = groupCenterArray[i];
          const [, centerJ] = groupCenterArray[j];

          const dx = centerJ.x - centerI.x;
          const dy = centerJ.y - centerI.y;
          const distSq = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(distSq);

          const force = groupRepulsionStrength / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          centerI.vx -= fx;
          centerI.vy -= fy;
          centerJ.vx += fx;
          centerJ.vy += fy;
        }
      }

      // 2. Node-to-group-center attraction: Pull nodes toward their group center
      const groupAttractionStrength = 0.05; // Weaker attraction to allow more spreading

      positions.forEach((pos) => {
        const groupId = nodeToGroup.get(pos.node.id);
        if (groupId && groupCenters.has(groupId)) {
          const groupCenter = groupCenters.get(groupId)!;
          const dx = groupCenter.x - pos.x;
          const dy = groupCenter.y - pos.y;

          pos.vx += dx * groupAttractionStrength;
          pos.vy += dy * groupAttractionStrength;

          // Apply opposite force to group center (Newton's third law)
          groupCenter.vx -= dx * groupAttractionStrength * 0.1;
          groupCenter.vy -= dy * groupAttractionStrength * 0.1;
        }
      });

      // 3. Node-level separation between different groups (moderate)
      const groupSeparationStrength = spacing * 2.0;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const groupI = nodeToGroup.get(positions[i].node.id);
          const groupJ = nodeToGroup.get(positions[j].node.id);

          // Apply separation if nodes are in different groups OR if one is ungrouped
          const inDifferentGroups = groupI && groupJ && groupI !== groupJ;
          const oneUngrouped = (groupI && !groupJ) || (!groupI && groupJ);

          if (inDifferentGroups || oneUngrouped) {
            const dx = positions[j].x - positions[i].x;
            const dy = positions[j].y - positions[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy + 0.01);

            const force = groupSeparationStrength / (dist * 1.0 + spacing * 0.5);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            positions[i].vx -= fx;
            positions[i].vy -= fy;
            positions[j].vx += fx;
            positions[j].vy += fy;
          }
        }
      }

      // 4. Update group center positions
      groupCenters.forEach((center) => {
        center.x += center.vx * damping;
        center.y += center.vy * damping;
      });
    }

    // Update positions with damping
    positions.forEach((p) => {
      p.x += p.vx * damping;
      p.y += p.vy * damping;
    });
  }

  // Post-simulation: resolve any remaining rectangular overlaps
  for (let pass = 0; pass < 10; pass++) {
    let hasOverlap = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const overlapX =
          (positions[i].width + positions[j].width) / 2 +
          spacing * 0.15 -
          Math.abs(positions[j].x - positions[i].x);
        const overlapY =
          (positions[i].height + positions[j].height) / 2 +
          spacing * 0.15 -
          Math.abs(positions[j].y - positions[i].y);
        if (overlapX > 0 && overlapY > 0) {
          hasOverlap = true;
          // Push apart along the axis with less overlap
          if (overlapX < overlapY) {
            const push = overlapX / 2 + 1;
            if (positions[j].x >= positions[i].x) {
              positions[i].x -= push;
              positions[j].x += push;
            } else {
              positions[i].x += push;
              positions[j].x -= push;
            }
          } else {
            const push = overlapY / 2 + 1;
            if (positions[j].y >= positions[i].y) {
              positions[i].y -= push;
              positions[j].y += push;
            } else {
              positions[i].y += push;
              positions[j].y -= push;
            }
          }
        }
      }
    }
    if (!hasOverlap) break;
  }

  // Pack disconnected components closer together
  // Detect connected components and re-arrange their bounding boxes in a grid
  const COMPONENT_GAP = 60;
  const adjacency = new Map<string, Set<string>>();
  positions.forEach((p) => adjacency.set(p.node.id, new Set()));
  edges.forEach((edge) => {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  });

  const componentOf = new Map<string, number>();
  let componentCount = 0;
  positions.forEach((p) => {
    if (componentOf.has(p.node.id)) return;
    const compId = componentCount++;
    const stack = [p.node.id];
    while (stack.length > 0) {
      const nid = stack.pop()!;
      if (componentOf.has(nid)) continue;
      componentOf.set(nid, compId);
      adjacency.get(nid)?.forEach((neighbor) => {
        if (!componentOf.has(neighbor)) stack.push(neighbor);
      });
    }
  });

  if (componentCount > 1) {
    // Compute bounding box for each component
    const compBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
    positions.forEach((p) => {
      const cid = componentOf.get(p.node.id)!;
      const existing = compBounds.get(cid);
      if (!existing) {
        compBounds.set(cid, { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height });
      } else {
        existing.minX = Math.min(existing.minX, p.x);
        existing.minY = Math.min(existing.minY, p.y);
        existing.maxX = Math.max(existing.maxX, p.x + p.width);
        existing.maxY = Math.max(existing.maxY, p.y + p.height);
      }
    });

    // Sort components by size (largest first) for better packing
    const compIds = Array.from(compBounds.keys()).sort((a, b) => {
      const ba = compBounds.get(a)!;
      const bb = compBounds.get(b)!;
      return (bb.maxX - bb.minX) * (bb.maxY - bb.minY) - (ba.maxX - ba.minX) * (ba.maxY - ba.minY);
    });

    // Arrange components in a grid layout
    const cols = Math.ceil(Math.sqrt(compIds.length));
    let gridX = 0;
    let gridY = 0;
    let rowMaxHeight = 0;
    let colIndex = 0;

    for (const cid of compIds) {
      const bounds = compBounds.get(cid)!;
      const compW = bounds.maxX - bounds.minX;
      const compH = bounds.maxY - bounds.minY;

      // Shift all nodes in this component so the component's top-left is at (gridX, gridY)
      const dx = gridX - bounds.minX;
      const dy = gridY - bounds.minY;
      positions.forEach((p) => {
        if (componentOf.get(p.node.id) === cid) {
          p.x += dx;
          p.y += dy;
        }
      });

      gridX += compW + COMPONENT_GAP;
      rowMaxHeight = Math.max(rowMaxHeight, compH);
      colIndex++;

      if (colIndex >= cols) {
        colIndex = 0;
        gridX = 0;
        gridY += rowMaxHeight + COMPONENT_GAP;
        rowMaxHeight = 0;
      }
    }
  }

  return positions.map((p) => ({
    ...p.node,
    x: p.x,
    y: p.y,
    width: p.width,
    height: p.height,
  }));
}

/**
 * Compute circular layout
 */
function computeCircularLayout(
  nodes: DiagramNode[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedNode[] {
  const radius = 200;
  const angleStep = (2 * Math.PI) / nodes.length;

  return nodes.map((node, i) => {
    const angle = i * angleStep;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    const width = node.size?.width ?? nodeDefaults.width;
    const height = node.size?.height ?? nodeDefaults.height;

    return { ...node, x, y, width, height };
  });
}

/**
 * Compute tree layout
 * Hierarchical layout with parent-child relationships
 */
function computeTreeLayout(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  layout: DiagramBaseView['layout'],
  nodeDefaults: { width: number; height: number },
): ComputedNode[] {
  const spacing = clampSpacing(layout.spacing, 60);
  const direction = layout.direction ?? 'TB';
  const isVertical = direction === 'TB' || direction === 'BT';

  // Build parent-child relationships
  const children = new Map<string, string[]>();
  const parents = new Map<string, string>();

  edges.forEach((edge) => {
    if (!children.has(edge.from)) children.set(edge.from, []);
    children.get(edge.from)!.push(edge.to);
    parents.set(edge.to, edge.from);
  });

  // Find root nodes (nodes with no parents)
  const roots = nodes.filter((node) => !parents.has(node.id));
  if (roots.length === 0 && nodes.length > 0) {
    // If no roots found, use first node
    roots.push(nodes[0]);
  }

  // Compute tree layout recursively
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let currentX = 0;

  function layoutNode(nodeId: string, depth: number): { width: number; height: number } {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { width: 0, height: 0 };

    const width = node.size?.width ?? nodeDefaults.width;
    const height = node.size?.height ?? nodeDefaults.height;
    const nodeChildren = children.get(nodeId) || [];

    if (nodeChildren.length === 0) {
      // Leaf node
      const x = isVertical ? currentX : depth * (width + spacing);
      const y = isVertical ? depth * (height + spacing) : currentX;
      positions.set(nodeId, { x, y, width, height });
      currentX += (isVertical ? width : height) + spacing;
      return { width, height };
    }

    // Layout children first
    const childrenWidths: number[] = [];
    nodeChildren.forEach((childId) => {
      const childSize = layoutNode(childId, depth + 1);
      childrenWidths.push(isVertical ? childSize.width : childSize.height);
    });

    // Position this node centered above children
    const childrenStart =
      currentX - childrenWidths.reduce((a, b) => a + b, 0) - spacing * (childrenWidths.length - 1);
    const childrenEnd = currentX;
    const centerX = (childrenStart + childrenEnd) / 2;

    const x = isVertical ? centerX : depth * (width + spacing);
    const y = isVertical ? depth * (height + spacing) : centerX;
    positions.set(nodeId, { x, y, width, height });

    return { width, height };
  }

  // Layout from each root
  roots.forEach((root) => {
    layoutNode(root.id, 0);
  });

  // Convert to ComputedNode array
  return nodes.map((node) => {
    const pos = positions.get(node.id) || {
      x: 0,
      y: 0,
      width: nodeDefaults.width,
      height: nodeDefaults.height,
    };
    return {
      ...node,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });
}

/**
 * Calculate intersection point between a line and a rectangle
 * Line goes from (centerX, centerY) towards (targetX, targetY)
 */
function getRectangleIntersection(
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
  targetX: number,
  targetY: number,
  centerX: number,
  centerY: number,
): { x: number; y: number } {
  const dx = targetX - centerX;
  const dy = targetY - centerY;

  // If no direction, return center
  if (dx === 0 && dy === 0) {
    return { x: centerX, y: centerY };
  }

  // Rectangle bounds
  const left = rectX;
  const right = rectX + rectWidth;
  const top = rectY;
  const bottom = rectY + rectHeight;

  // Find all potential intersections
  const intersections: Array<{ x: number; y: number; dist: number }> = [];

  // Left edge (x = left)
  if (dx !== 0) {
    const t = (left - centerX) / dx;
    if (t > 0) {
      const y = centerY + t * dy;
      if (y >= top && y <= bottom) {
        const dist = Math.sqrt((left - centerX) ** 2 + (y - centerY) ** 2);
        intersections.push({ x: left, y, dist });
      }
    }
  }

  // Right edge (x = right)
  if (dx !== 0) {
    const t = (right - centerX) / dx;
    if (t > 0) {
      const y = centerY + t * dy;
      if (y >= top && y <= bottom) {
        const dist = Math.sqrt((right - centerX) ** 2 + (y - centerY) ** 2);
        intersections.push({ x: right, y, dist });
      }
    }
  }

  // Top edge (y = top)
  if (dy !== 0) {
    const t = (top - centerY) / dy;
    if (t > 0) {
      const x = centerX + t * dx;
      if (x >= left && x <= right) {
        const dist = Math.sqrt((x - centerX) ** 2 + (top - centerY) ** 2);
        intersections.push({ x, y: top, dist });
      }
    }
  }

  // Bottom edge (y = bottom)
  if (dy !== 0) {
    const t = (bottom - centerY) / dy;
    if (t > 0) {
      const x = centerX + t * dx;
      if (x >= left && x <= right) {
        const dist = Math.sqrt((x - centerX) ** 2 + (bottom - centerY) ** 2);
        intersections.push({ x, y: bottom, dist });
      }
    }
  }

  // Return the closest intersection
  if (intersections.length > 0) {
    intersections.sort((a, b) => a.dist - b.dist);
    return { x: intersections[0].x, y: intersections[0].y };
  }

  // Fallback to center
  return { x: centerX, y: centerY };
}

/**
 * Compute edge paths based on edge routing type
 */
function computeEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
  layout: DiagramBaseView['layout'],
): ComputedEdge[] {
  const edgeRouting = layout.edgeRouting || 'polyline';

  // Circular layouts should always use straight lines — orthogonal routing
  // creates ugly right-angle paths between circularly-placed nodes
  if (layout.type === 'circular') {
    return computeStraightEdgePaths(edges, nodes);
  }

  // Dense graphs (high edge-to-node ratio) look terrible with orthogonal routing
  // because every right-angle path consumes channel space. Auto-downgrade to curved.
  const edgeDensity = nodes.length > 0 ? edges.length / nodes.length : 0;
  const effectiveRouting = (edgeRouting === 'orthogonal' && edgeDensity > 3) ? 'curved' : edgeRouting;

  if (effectiveRouting === 'orthogonal') {
    return computeOrthogonalEdgePaths(edges, nodes, layout);
  } else if (effectiveRouting === 'curved') {
    return computeCurvedEdgePaths(edges, nodes);
  }

  // Default: simple straight lines
  return computeStraightEdgePaths(edges, nodes);
}

/**
 * Build a map of edge ID → perpendicular offset for bidirectional edge pairs.
 * When two edges connect the same pair of nodes in opposite directions,
 * they get offset ±BIDIRECTIONAL_OFFSET perpendicular to the line between nodes.
 */
const BIDIRECTIONAL_OFFSET = 12;

function buildBidirectionalOffsetMap(edges: DiagramEdge[]): Map<string, number> {
  const offsets = new Map<string, number>();

  // Build a map of directed pairs: "from::to" -> edge ids
  const directedMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}::${edge.to}`;
    if (!directedMap.has(key)) directedMap.set(key, []);
    directedMap.get(key)!.push(edge.id);
  }

  // Only offset edges that are truly bidirectional (A→B AND B→A both exist)
  const processed = new Set<string>();
  for (const [key] of directedMap) {
    const [from, to] = key.split('::');
    const reverseKey = `${to}::${from}`;
    const sortedPairKey = [from, to].sort().join('::');

    if (processed.has(sortedPairKey)) continue;
    if (!directedMap.has(reverseKey)) continue;

    // Both directions exist - apply offsets
    processed.add(sortedPairKey);
    const [nodeA] = sortedPairKey.split('::');

    const forwardEdges = directedMap.get(key)!;
    const reverseEdges = directedMap.get(reverseKey)!;

    for (const edgeId of forwardEdges) {
      offsets.set(edgeId, from === nodeA ? BIDIRECTIONAL_OFFSET : -BIDIRECTIONAL_OFFSET);
    }
    for (const edgeId of reverseEdges) {
      offsets.set(edgeId, to === nodeA ? BIDIRECTIONAL_OFFSET : -BIDIRECTIONAL_OFFSET);
    }
  }

  return offsets;
}

/**
 * Apply perpendicular offset to a point along the line from->to.
 */
function applyPerpendicularOffset(
  point: { x: number; y: number },
  fromCenter: { x: number; y: number },
  toCenter: { x: number; y: number },
  offset: number,
): { x: number; y: number } {
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return point;
  // Perpendicular direction (rotate 90 degrees)
  const perpX = -dy / len;
  const perpY = dx / len;
  return { x: point.x + perpX * offset, y: point.y + perpY * offset };
}


/**
 * Compute edge paths with curved bezier lines
 */
function computeCurvedEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const biOffsets = buildBidirectionalOffsetMap(edges);
  const selfLoopCounts = new Map<string, number>();

  return edges.map((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) {
      return { ...edge, path: '', points: [] };
    }

    // Self-loop: edge from a node to itself
    if (edge.from === edge.to) {
      const loopIdx = selfLoopCounts.get(edge.from) ?? 0;
      selfLoopCounts.set(edge.from, loopIdx + 1);
      const { path, points } = computeSelfLoopPath(fromNode, loopIdx);
      return { ...edge, path, points };
    }

    // Calculate centers
    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    // Determine direction for connection points
    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;
    const angle = Math.atan2(dy, dx);
    const absAngle = Math.abs(angle);

    let fromPoint: { x: number; y: number };
    let toPoint: { x: number; y: number };

    if (absAngle < Math.PI / 4) {
      fromPoint = { x: fromNode.x + fromNode.width, y: fromCenterY };
      toPoint = { x: toNode.x, y: toCenterY };
    } else if (absAngle > (3 * Math.PI) / 4) {
      fromPoint = { x: fromNode.x, y: fromCenterY };
      toPoint = { x: toNode.x + toNode.width, y: toCenterY };
    } else if (angle > 0) {
      fromPoint = { x: fromCenterX, y: fromNode.y + fromNode.height };
      toPoint = { x: toCenterX, y: toNode.y };
    } else {
      fromPoint = { x: fromCenterX, y: fromNode.y };
      toPoint = { x: toCenterX, y: toNode.y + toNode.height };
    }

    // Add small gap from node edge
    const gap = 2;
    const edgeDx = toPoint.x - fromPoint.x;
    const edgeDy = toPoint.y - fromPoint.y;
    const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

    if (length > gap * 2) {
      const dirX = edgeDx / length;
      const dirY = edgeDy / length;
      fromPoint = { x: fromPoint.x + dirX * gap, y: fromPoint.y + dirY * gap };
      toPoint = { x: toPoint.x - dirX * gap, y: toPoint.y - dirY * gap };
    }

    // Apply bidirectional offset if needed
    const biOffset = biOffsets.get(edge.id);
    if (biOffset) {
      const fromCenter = { x: fromCenterX, y: fromCenterY };
      const toCenter = { x: toCenterX, y: toCenterY };
      fromPoint = applyPerpendicularOffset(fromPoint, fromCenter, toCenter, biOffset);
      toPoint = applyPerpendicularOffset(toPoint, fromCenter, toCenter, biOffset);
    }

    const path = computeCurvedPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
    const midX = (fromPoint.x + toPoint.x) / 2;
    const midY = (fromPoint.y + toPoint.y) / 2;
    const points = [fromPoint, { x: midX, y: midY }, toPoint];

    return { ...edge, path, points };
  });
}

/**
 * Compute edge paths with simple straight lines
 */
function computeStraightEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const biOffsets = buildBidirectionalOffsetMap(edges);
  const selfLoopCounts = new Map<string, number>();

  return edges.map((edge) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (!fromNode || !toNode) {
      return { ...edge, path: '', points: [] };
    }

    // Self-loop: edge from a node to itself
    if (edge.from === edge.to) {
      const loopIdx = selfLoopCounts.get(edge.from) ?? 0;
      selfLoopCounts.set(edge.from, loopIdx + 1);
      const { path, points } = computeSelfLoopPath(fromNode, loopIdx);
      return { ...edge, path, points };
    }

    // Calculate centers
    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    // Determine direction
    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;

    // Calculate connection points on node edges (not centers)
    let fromPoint: { x: number; y: number };
    let toPoint: { x: number; y: number };

    // Use angle to determine best connection point
    const angle = Math.atan2(dy, dx);
    const absAngle = Math.abs(angle);

    if (absAngle < Math.PI / 4) {
      fromPoint = { x: fromNode.x + fromNode.width, y: fromCenterY };
      toPoint = { x: toNode.x, y: toCenterY };
    } else if (absAngle > (3 * Math.PI) / 4) {
      fromPoint = { x: fromNode.x, y: fromCenterY };
      toPoint = { x: toNode.x + toNode.width, y: toCenterY };
    } else if (angle > 0) {
      fromPoint = { x: fromCenterX, y: fromNode.y + fromNode.height };
      toPoint = { x: toCenterX, y: toNode.y };
    } else {
      fromPoint = { x: fromCenterX, y: fromNode.y };
      toPoint = { x: toCenterX, y: toNode.y + toNode.height };
    }

    // Add small gap from node edge
    const gap = 2;
    const edgeDx = toPoint.x - fromPoint.x;
    const edgeDy = toPoint.y - fromPoint.y;
    const length = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

    if (length > gap * 2) {
      const dirX = edgeDx / length;
      const dirY = edgeDy / length;
      fromPoint = { x: fromPoint.x + dirX * gap, y: fromPoint.y + dirY * gap };
      toPoint = { x: toPoint.x - dirX * gap, y: toPoint.y - dirY * gap };
    }

    // Apply bidirectional offset if needed
    const biOffset = biOffsets.get(edge.id);
    if (biOffset) {
      const fromCenter = { x: fromCenterX, y: fromCenterY };
      const toCenter = { x: toCenterX, y: toCenterY };
      fromPoint = applyPerpendicularOffset(fromPoint, fromCenter, toCenter, biOffset);
      toPoint = applyPerpendicularOffset(toPoint, fromCenter, toCenter, biOffset);
    }

    const path = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
    const points = [
      fromPoint,
      { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 },
      toPoint,
    ];

    return { ...edge, path, points };
  });
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Compute organized orthogonal edge paths with proper track-based routing
 * Uses channel allocation to avoid overlapping edges
 */
function computeOrthogonalEdgePaths(
  edges: DiagramEdge[],
  nodes: ComputedNode[],
  layout: DiagramBaseView['layout'],
): ComputedEdge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const biOffsets = buildBidirectionalOffsetMap(edges);
  const direction = layout.direction || 'TB';
  const isVerticalLayout = direction === 'TB' || direction === 'BT';

  const TRACK_SPACING = 16; // Space between parallel routing tracks
  const NODE_CLEARANCE = 24; // Minimum clearance from node edge for routing
  const NODE_GAP = 12; // Gap when turning toward a node

  // Find the bounding box of all nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  // Collect edge info
  type EdgeInfo = {
    edge: DiagramEdge;
    fromNode: ComputedNode;
    toNode: ComputedNode;
    fromSide: Side;
    toSide: Side;
    goesBackward: boolean;
  };

  const edgeInfos: EdgeInfo[] = [];
  const selfLoopEdges: ComputedEdge[] = [];
  const selfLoopCounts = new Map<string, number>();

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    // Self-loop: edge from a node to itself
    if (edge.from === edge.to) {
      const loopIdx = selfLoopCounts.get(edge.from) ?? 0;
      selfLoopCounts.set(edge.from, loopIdx + 1);
      const { path, points } = computeSelfLoopPath(fromNode, loopIdx);
      selfLoopEdges.push({ ...edge, path, points });
      continue;
    }

    const { fromSide, toSide } = determineConnectionSides(fromNode, toNode, isVerticalLayout);

    const goesBackward = isVerticalLayout
      ? (fromNode.y + fromNode.height / 2) > (toNode.y + toNode.height / 2)
      : (fromNode.x + fromNode.width / 2) > (toNode.x + toNode.width / 2);

    edgeInfos.push({ edge, fromNode, toNode, fromSide, toSide, goesBackward });
  }

  // Group edges by their routing needs to allocate non-overlapping channels
  // For horizontal layout: edges using vertical midline channels
  // For vertical layout: edges using horizontal midline channels

  // Channel allocation: group edges that share horizontal/vertical segments
  const horizontalChannels: { y: number; edges: EdgeInfo[] }[] = [];
  const verticalChannels: { x: number; edges: EdgeInfo[] }[] = [];

  // Pre-compute which channel each edge needs
  const edgeChannelInfo = new Map<string, {
    needsHorizontalChannel: boolean;
    needsVerticalChannel: boolean;
    horizontalY: number;
    verticalX: number;
  }>();

  edgeInfos.forEach((info) => {
    const { fromNode, toNode, fromSide, toSide } = info;
    const isFromVertical = fromSide === 'top' || fromSide === 'bottom';
    const isToVertical = toSide === 'top' || toSide === 'bottom';

    const fromCenterX = fromNode.x + fromNode.width / 2;
    const fromCenterY = fromNode.y + fromNode.height / 2;
    const toCenterX = toNode.x + toNode.width / 2;
    const toCenterY = toNode.y + toNode.height / 2;

    let needsHorizontalChannel = false;
    let needsVerticalChannel = false;

    // Calculate channel position with proper clearance from nodes
    // For horizontal channels: position between the two nodes with clearance
    let horizontalY: number;
    if (fromSide === 'bottom' && toSide === 'top') {
      // From bottom to top: place channel between nodes
      const fromBottom = fromNode.y + fromNode.height;
      const toTop = toNode.y;
      horizontalY = (fromBottom + toTop) / 2;
      // Ensure minimum clearance from both nodes
      horizontalY = Math.max(horizontalY, fromBottom + NODE_CLEARANCE);
      horizontalY = Math.min(horizontalY, toTop - NODE_CLEARANCE);
    } else if (fromSide === 'top' && toSide === 'bottom') {
      // From top to bottom: place channel between nodes
      const fromTop = fromNode.y;
      const toBottom = toNode.y + toNode.height;
      horizontalY = (fromTop + toBottom) / 2;
      horizontalY = Math.min(horizontalY, fromTop - NODE_CLEARANCE);
      horizontalY = Math.max(horizontalY, toBottom + NODE_CLEARANCE);
    } else {
      // Default: midpoint with offset toward the gap between nodes
      horizontalY = (fromCenterY + toCenterY) / 2;
    }

    // For vertical channels: position between nodes with clearance
    let verticalX: number;
    if (fromSide === 'right' && toSide === 'left') {
      const fromRight = fromNode.x + fromNode.width;
      const toLeft = toNode.x;
      verticalX = (fromRight + toLeft) / 2;
    } else if (fromSide === 'left' && toSide === 'right') {
      const fromLeft = fromNode.x;
      const toRight = toNode.x + toNode.width;
      verticalX = (fromLeft + toRight) / 2;
    } else {
      verticalX = (fromCenterX + toCenterX) / 2;
    }

    if (isFromVertical && isToVertical && Math.abs(fromCenterX - toCenterX) > 5) {
      needsHorizontalChannel = true;
    } else if (!isFromVertical && !isToVertical) {
      needsVerticalChannel = true;
    }

    edgeChannelInfo.set(info.edge.id, {
      needsHorizontalChannel,
      needsVerticalChannel,
      horizontalY,
      verticalX,
    });
  });

  // Allocate channels to avoid overlapping
  // Sort edges by their channel position to assign unique tracks
  const edgesNeedingHorizontal = edgeInfos.filter((e) =>
    edgeChannelInfo.get(e.edge.id)?.needsHorizontalChannel,
  );
  const edgesNeedingVertical = edgeInfos.filter((e) =>
    edgeChannelInfo.get(e.edge.id)?.needsVerticalChannel,
  );

  // Sort by natural channel position
  edgesNeedingHorizontal.sort((a, b) => {
    const aY = edgeChannelInfo.get(a.edge.id)!.horizontalY;
    const bY = edgeChannelInfo.get(b.edge.id)!.horizontalY;
    return aY - bY;
  });

  edgesNeedingVertical.sort((a, b) => {
    const aX = edgeChannelInfo.get(a.edge.id)!.verticalX;
    const bX = edgeChannelInfo.get(b.edge.id)!.verticalX;
    return aX - bX;
  });

  // Assign non-overlapping channel positions
  const horizontalChannelY = new Map<string, number>();
  const verticalChannelX = new Map<string, number>();

  // For horizontal channels: check if edges overlap in X and need different Y
  // Use a more aggressive separation algorithm
  const assignHorizontalChannels = () => {
    // Group edges by their approximate Y position (within tolerance)
    const assignedChannels: { minX: number; maxX: number; y: number; edgeId: string }[] = [];

    edgesNeedingHorizontal.forEach((info) => {
      const { fromNode, toNode } = info;
      const baseY = edgeChannelInfo.get(info.edge.id)!.horizontalY;
      // Use full node extent for overlap detection
      const edgeMinX = Math.min(fromNode.x, toNode.x);
      const edgeMaxX = Math.max(fromNode.x + fromNode.width, toNode.x + toNode.width);

      // Find all channels this edge would overlap with
      const overlappingChannels = assignedChannels.filter((channel) => {
        const overlapsX = !(edgeMaxX < channel.minX - 10 || edgeMinX > channel.maxX + 10);
        return overlapsX;
      });

      // Find a Y position that doesn't conflict with overlapping channels
      let assignedY = baseY;
      if (overlappingChannels.length > 0) {
        // Collect all Y positions that are taken
        const takenYs = overlappingChannels.map((c) => c.y).sort((a, b) => a - b);

        // Find a free slot
        let foundSlot = false;
        for (let offset = 0; offset <= overlappingChannels.length; offset++) {
          const candidateY = baseY + offset * TRACK_SPACING;
          const isTaken = takenYs.some((y) => Math.abs(y - candidateY) < TRACK_SPACING - 1);
          if (!isTaken) {
            assignedY = candidateY;
            foundSlot = true;
            break;
          }
          // Also try negative offset
          const candidateYNeg = baseY - offset * TRACK_SPACING;
          const isTakenNeg = takenYs.some((y) => Math.abs(y - candidateYNeg) < TRACK_SPACING - 1);
          if (!isTakenNeg && offset > 0) {
            assignedY = candidateYNeg;
            foundSlot = true;
            break;
          }
        }
        if (!foundSlot) {
          assignedY = baseY + (overlappingChannels.length) * TRACK_SPACING;
        }
      }

      assignedChannels.push({ minX: edgeMinX, maxX: edgeMaxX, y: assignedY, edgeId: info.edge.id });
      horizontalChannelY.set(info.edge.id, assignedY);
    });
  };

  const assignVerticalChannels = () => {
    const assignedChannels: { minY: number; maxY: number; x: number; edgeId: string }[] = [];

    edgesNeedingVertical.forEach((info) => {
      const { fromNode, toNode } = info;
      const baseX = edgeChannelInfo.get(info.edge.id)!.verticalX;
      const edgeMinY = Math.min(fromNode.y, toNode.y);
      const edgeMaxY = Math.max(fromNode.y + fromNode.height, toNode.y + toNode.height);

      // Find overlapping channels
      const overlappingChannels = assignedChannels.filter((channel) => {
        const overlapsY = !(edgeMaxY < channel.minY - 10 || edgeMinY > channel.maxY + 10);
        return overlapsY;
      });

      let assignedX = baseX;
      if (overlappingChannels.length > 0) {
        const takenXs = overlappingChannels.map((c) => c.x).sort((a, b) => a - b);

        let foundSlot = false;
        for (let offset = 0; offset <= overlappingChannels.length; offset++) {
          const candidateX = baseX + offset * TRACK_SPACING;
          const isTaken = takenXs.some((x) => Math.abs(x - candidateX) < TRACK_SPACING - 1);
          if (!isTaken) {
            assignedX = candidateX;
            foundSlot = true;
            break;
          }
          const candidateXNeg = baseX - offset * TRACK_SPACING;
          const isTakenNeg = takenXs.some((x) => Math.abs(x - candidateXNeg) < TRACK_SPACING - 1);
          if (!isTakenNeg && offset > 0) {
            assignedX = candidateXNeg;
            foundSlot = true;
            break;
          }
        }
        if (!foundSlot) {
          assignedX = baseX + (overlappingChannels.length) * TRACK_SPACING;
        }
      }

      assignedChannels.push({ minY: edgeMinY, maxY: edgeMaxY, x: assignedX, edgeId: info.edge.id });
      verticalChannelX.set(info.edge.id, assignedX);
    });
  };

  assignHorizontalChannels();
  assignVerticalChannels();

  // Group edges by source/target for port spreading
  const sourceGroups = new Map<string, EdgeInfo[]>();
  const targetGroups = new Map<string, EdgeInfo[]>();

  for (const info of edgeInfos) {
    const sourceKey = `${info.edge.from}:${info.fromSide}`;
    if (!sourceGroups.has(sourceKey)) sourceGroups.set(sourceKey, []);
    sourceGroups.get(sourceKey)!.push(info);

    const targetKey = `${info.edge.to}:${info.toSide}`;
    if (!targetGroups.has(targetKey)) targetGroups.set(targetKey, []);
    targetGroups.get(targetKey)!.push(info);
  }

  // Assign port indices
  const portIndex = new Map<string, { srcIdx: number; srcCount: number; tgtIdx: number; tgtCount: number }>();

  sourceGroups.forEach((group) => {
    group.sort((a, b) => (a.toNode.x + a.toNode.width/2) - (b.toNode.x + b.toNode.width/2));
    group.forEach((info, i) => {
      const existing = portIndex.get(info.edge.id) || { srcIdx: 0, srcCount: 1, tgtIdx: 0, tgtCount: 1 };
      portIndex.set(info.edge.id, { ...existing, srcIdx: i, srcCount: group.length });
    });
  });

  targetGroups.forEach((group) => {
    group.sort((a, b) => (a.fromNode.x + a.fromNode.width/2) - (b.fromNode.x + b.fromNode.width/2));
    group.forEach((info, i) => {
      const existing = portIndex.get(info.edge.id) || { srcIdx: 0, srcCount: 1, tgtIdx: 0, tgtCount: 1 };
      portIndex.set(info.edge.id, { ...existing, tgtIdx: i, tgtCount: group.length });
    });
  });

  // Backward edge track allocation
  const backwardEdges = edgeInfos.filter(e => e.goesBackward);
  backwardEdges.sort((a, b) => {
    const aDistance = isVerticalLayout
      ? Math.abs(a.fromNode.y - a.toNode.y)
      : Math.abs(a.fromNode.x - a.toNode.x);
    const bDistance = isVerticalLayout
      ? Math.abs(b.fromNode.y - b.toNode.y)
      : Math.abs(b.fromNode.x - b.toNode.x);
    return bDistance - aDistance;
  });

  const backwardTrackMap = new Map<string, number>();
  backwardEdges.forEach((info, i) => {
    backwardTrackMap.set(info.edge.id, i);
  });

  // Generate paths
  const computedEdges: ComputedEdge[] = edgeInfos.map((info) => {
    const { edge, fromNode, toNode, fromSide, toSide, goesBackward } = info;

    // Calculate port positions with spreading
    let srcT = 0.5, tgtT = 0.5;
    const ports = portIndex.get(edge.id);
    if (ports) {
      srcT = ports.srcCount === 1 ? 0.5 : 0.2 + (0.6 * ports.srcIdx) / Math.max(ports.srcCount - 1, 1);
      tgtT = ports.tgtCount === 1 ? 0.5 : 0.2 + (0.6 * ports.tgtIdx) / Math.max(ports.tgtCount - 1, 1);
    }

    const getPortPosition = (node: ComputedNode, side: Side, t: number) => {
      switch (side) {
        case 'top': return { x: node.x + node.width * t, y: node.y };
        case 'bottom': return { x: node.x + node.width * t, y: node.y + node.height };
        case 'left': return { x: node.x, y: node.y + node.height * t };
        case 'right': return { x: node.x + node.width, y: node.y + node.height * t };
      }
    };

    let fromPos = getPortPosition(fromNode, fromSide, srcT);
    let toPos = getPortPosition(toNode, toSide, tgtT);

    // Apply bidirectional offset if needed
    const biOffset = biOffsets.get(edge.id);
    if (biOffset) {
      const fromCenter = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 };
      const toCenter = { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 };
      fromPos = applyPerpendicularOffset(fromPos, fromCenter, toCenter, biOffset);
      toPos = applyPerpendicularOffset(toPos, fromCenter, toCenter, biOffset);
    }

    const points: Array<{ x: number; y: number }> = [fromPos];

    const isFromVertical = fromSide === 'top' || fromSide === 'bottom';
    const isToVertical = toSide === 'top' || toSide === 'bottom';

    if (goesBackward) {
      // Backward edge: route around the outside
      const trackNum = backwardTrackMap.get(edge.id) ?? 0;

      if (isVerticalLayout) {
        const trackX = minX - NODE_CLEARANCE - (trackNum + 1) * TRACK_SPACING;
        // Step away from source node first
        const stepAwayY = fromSide === 'bottom' ? fromPos.y + NODE_GAP : fromPos.y - NODE_GAP;
        const stepToY = toSide === 'top' ? toPos.y - NODE_GAP : toPos.y + NODE_GAP;
        points.push({ x: fromPos.x, y: stepAwayY });
        points.push({ x: trackX, y: stepAwayY });
        points.push({ x: trackX, y: stepToY });
        points.push({ x: toPos.x, y: stepToY });
      } else {
        const trackY = minY - NODE_CLEARANCE - (trackNum + 1) * TRACK_SPACING;
        const stepAwayX = fromSide === 'right' ? fromPos.x + NODE_GAP : fromPos.x - NODE_GAP;
        const stepToX = toSide === 'left' ? toPos.x - NODE_GAP : toPos.x + NODE_GAP;
        points.push({ x: stepAwayX, y: fromPos.y });
        points.push({ x: stepAwayX, y: trackY });
        points.push({ x: stepToX, y: trackY });
        points.push({ x: stepToX, y: toPos.y });
      }
    } else if (isFromVertical && isToVertical) {
      // Vertical to vertical - use allocated horizontal channel
      // Check if the node centers are aligned (not just port positions, which may be spread)
      const fromNodeCenterX = fromNode.x + fromNode.width / 2;
      const toNodeCenterX = toNode.x + toNode.width / 2;
      if (Math.abs(fromNodeCenterX - toNodeCenterX) < 5 && !biOffset) {
        // Nodes are vertically aligned - use a single straight line down the center
        // Skip this optimization when bidirectional offset is applied, as it would
        // override the offset and cause overlapping edges
        const centerX = (fromNodeCenterX + toNodeCenterX) / 2;
        points[0] = { x: centerX, y: fromPos.y };
        // toPos will be pushed with centerX below
        toPos = { x: centerX, y: toPos.y };
      } else {
        const channelY = horizontalChannelY.get(edge.id) ?? (fromPos.y + toPos.y) / 2;
        // Add step-out segments for cleaner routing
        const stepOutY = fromSide === 'bottom'
          ? Math.max(fromPos.y + NODE_GAP, channelY)
          : Math.min(fromPos.y - NODE_GAP, channelY);
        const stepInY = toSide === 'top'
          ? Math.min(toPos.y - NODE_GAP, channelY)
          : Math.max(toPos.y + NODE_GAP, channelY);

        // Only add intermediate points if the channel is significantly different
        if (Math.abs(stepOutY - channelY) > 2) {
          points.push({ x: fromPos.x, y: stepOutY });
        }
        points.push({ x: fromPos.x, y: channelY });
        points.push({ x: toPos.x, y: channelY });
        if (Math.abs(stepInY - channelY) > 2) {
          points.push({ x: toPos.x, y: stepInY });
        }
      }
    } else if (!isFromVertical && !isToVertical) {
      // Horizontal to horizontal - use allocated vertical channel
      const channelX = verticalChannelX.get(edge.id) ?? (fromPos.x + toPos.x) / 2;
      const stepOutX = fromSide === 'right'
        ? Math.max(fromPos.x + NODE_GAP, channelX)
        : Math.min(fromPos.x - NODE_GAP, channelX);
      const stepInX = toSide === 'left'
        ? Math.min(toPos.x - NODE_GAP, channelX)
        : Math.max(toPos.x + NODE_GAP, channelX);

      if (Math.abs(stepOutX - channelX) > 2) {
        points.push({ x: stepOutX, y: fromPos.y });
      }
      points.push({ x: channelX, y: fromPos.y });
      points.push({ x: channelX, y: toPos.y });
      if (Math.abs(stepInX - channelX) > 2) {
        points.push({ x: stepInX, y: toPos.y });
      }
    } else {
      // L-shaped connection - add clearance step
      if (isFromVertical) {
        // From vertical port, step out, then go to target
        const stepY = fromSide === 'bottom' ? fromPos.y + NODE_GAP : fromPos.y - NODE_GAP;
        if (Math.abs(stepY - toPos.y) > 5) {
          points.push({ x: fromPos.x, y: stepY });
          points.push({ x: toPos.x, y: stepY });
        } else {
          points.push({ x: fromPos.x, y: toPos.y });
        }
      } else {
        const stepX = fromSide === 'right' ? fromPos.x + NODE_GAP : fromPos.x - NODE_GAP;
        if (Math.abs(stepX - toPos.x) > 5) {
          points.push({ x: stepX, y: fromPos.y });
          points.push({ x: stepX, y: toPos.y });
        } else {
          points.push({ x: toPos.x, y: fromPos.y });
        }
      }
    }

    points.push(toPos);

    // Generate SVG path
    const pathParts = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length; i++) {
      pathParts.push(`L ${points[i].x} ${points[i].y}`);
    }

    return {
      ...edge,
      path: pathParts.join(' '),
      points,
    };
  });

  return [...selfLoopEdges, ...computedEdges];
}

/**
 * Determine which sides of the nodes to connect based on layout direction and positions
 */
function determineConnectionSides(
  fromNode: ComputedNode,
  toNode: ComputedNode,
  isVerticalLayout: boolean,
): { fromSide: Side; toSide: Side } {
  const fromCenterX = fromNode.x + fromNode.width / 2;
  const fromCenterY = fromNode.y + fromNode.height / 2;
  const toCenterX = toNode.x + toNode.width / 2;
  const toCenterY = toNode.y + toNode.height / 2;

  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  // For vertical layouts (TB/BT), prefer top/bottom connections
  if (isVerticalLayout) {
    if (Math.abs(dy) > 10) {
      // Significant vertical difference
      return dy > 0
        ? { fromSide: 'bottom', toSide: 'top' }
        : { fromSide: 'top', toSide: 'bottom' };
    }
    // Nearly same level - use horizontal
    return dx > 0
      ? { fromSide: 'right', toSide: 'left' }
      : { fromSide: 'left', toSide: 'right' };
  }

  // For horizontal layouts (LR/RL), prefer left/right connections
  if (Math.abs(dx) > 10) {
    // Significant horizontal difference
    return dx > 0
      ? { fromSide: 'right', toSide: 'left' }
      : { fromSide: 'left', toSide: 'right' };
  }
  // Nearly same level - use vertical
  return dy > 0
    ? { fromSide: 'bottom', toSide: 'top' }
    : { fromSide: 'top', toSide: 'bottom' };
}

/**
 * Compute a self-loop path for edges where from === to.
 * Exits from the top-right of the node, arcs up and right, returns to the right-top.
 */
function computeSelfLoopPath(node: ComputedNode, loopIndex: number = 0): { path: string; points: Array<{ x: number; y: number }> } {
  const topY = node.y;
  const rightX = node.x + node.width;
  const cx = node.x + node.width / 2;

  // Base radius for the loop, grows with each additional self-loop
  const baseRadius = Math.max(Math.min(node.width, node.height) * 0.4, 28);
  const indexOffset = loopIndex * 12;
  const radius = baseRadius + indexOffset;

  // Start: top-center of the node
  const startX = cx;
  const startY = topY;

  // End: right side of the node, near the top
  const endX = rightX;
  const endY = node.y + node.height * 0.25;

  // Control points form a round arc going up and to the right
  const cp1x = cx;
  const cp1y = topY - radius;
  const cp2x = rightX + radius;
  const cp2y = endY;

  const path = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
  const midX = (cp1x + cp2x) / 2;
  const midY = (cp1y + cp2y) / 2;
  const points = [
    { x: startX, y: startY },
    { x: cp1x, y: cp1y },
    { x: cp2x, y: cp2y },
    { x: midX, y: midY },
    { x: endX, y: endY },
  ];

  return { path, points };
}

/**
 * Compute curved path (bezier)
 */
function computeCurvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Calculate distance and use it to determine control point offset
  const distance = Math.sqrt(dx * dx + dy * dy);
  const offset = distance * 0.4;

  // Normalize direction vector
  const dirX = dx / distance;
  const dirY = dy / distance;

  // Control points offset along the direction from start to end
  // This ensures the curve exits toward the end and enters from the start direction
  const cx1 = x1 + dirX * offset;
  const cy1 = y1 + dirY * offset;
  const cx2 = x2 - dirX * offset;
  const cy2 = y2 - dirY * offset;

  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Compute group bounds
 */
function computeGroupBounds(groups: DiagramGroup[], nodes: ComputedNode[]): ComputedGroup[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return groups.map((group) => {
    // Get nodes from group.nodeIds if present
    const nodeIds = Array.isArray(group.nodeIds) ? [...group.nodeIds] : [];
    // Also include nodes that have this group as their group property
    nodes.forEach((n) => {
      if (n.group === group.id && !nodeIds.includes(n.id)) {
        nodeIds.push(n.id);
      }
    });
    const groupNodes = nodeIds.map((id) => nodeMap.get(id)).filter(Boolean) as ComputedNode[];

    if (groupNodes.length === 0) {
      return { ...group, x: 0, y: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...groupNodes.map((n) => n.x));
    const minY = Math.min(...groupNodes.map((n) => n.y));
    const maxX = Math.max(...groupNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...groupNodes.map((n) => n.y + n.height));

    const paddingX = 30;
    const paddingTop = 44; // More space for header/label
    const paddingBottom = 30;

    return {
      ...group,
      x: minX - paddingX,
      y: minY - paddingTop,
      width: maxX - minX + paddingX * 2,
      height: maxY - minY + paddingTop + paddingBottom,
    };
  });
}

/**
 * Compute overall bounds (including nodes, groups, and edge points)
 */
function computeBounds(nodes: ComputedNode[], groups?: ComputedGroup[], edges?: ComputedEdge[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Math.min(...nodes.map((n) => n.x));
  let minY = Math.min(...nodes.map((n) => n.y));
  let maxX = Math.max(...nodes.map((n) => n.x + n.width));
  let maxY = Math.max(...nodes.map((n) => n.y + n.height));

  // Include groups in bounds calculation
  if (groups && groups.length > 0) {
    minX = Math.min(minX, ...groups.map((g) => g.x));
    minY = Math.min(minY, ...groups.map((g) => g.y));
    maxX = Math.max(maxX, ...groups.map((g) => g.x + g.width));
    maxY = Math.max(maxY, ...groups.map((g) => g.y + g.height));
  }

  // Include edge points in bounds calculation (for routing tracks)
  if (edges && edges.length > 0) {
    for (const edge of edges) {
      if (edge.points) {
        for (const point of edge.points) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
