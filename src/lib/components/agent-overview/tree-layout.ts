/**
 * Tree Layout Engine
 *
 * Implements a modified Reingold-Tilford algorithm for laying out
 * hierarchical tree structures. This produces aesthetically pleasing
 * "tidy" trees with:
 * - Parents centered over children
 * - No overlapping nodes
 * - Minimal width while maintaining readability
 * - Support for variable node sizes
 * - Grouping of many children into compact pools
 *
 * Based on:
 * - Reingold & Tilford (1981) - Original tidy tree algorithm
 * - Walker (1990) - Extension for n-ary trees
 * - Buchheim et al. (2002) - Linear time improvement
 */

import type { AgentNode, FileNode } from './types';

// ============================================================================
// Types
// ============================================================================

export interface HierarchyNode {
  agent: AgentNode;
  files: FileNode[];
  children: HierarchyNode[];
  theme?: 'pink' | 'teal';
  edgeLabel?: string;
}

export interface LayoutNode extends HierarchyNode {
  /** X position (computed by layout) */
  x: number;
  /** Y position (depth level) */
  y: number;
  /** Modifier for shifting subtrees */
  mod: number;
  /** Whether this node's children should be grouped */
  isGrouped: boolean;
  /** Parent node reference */
  parent: LayoutNode | null;
  /** Layout children (may differ from hierarchy children if grouped) */
  layoutChildren: LayoutNode[];
}

export interface LayoutConfig {
  /** Horizontal spacing between sibling nodes */
  siblingSpacing: number;
  /** Vertical spacing between levels */
  levelSpacing: number;
  /** Minimum node width */
  nodeWidth: number;
  /** Minimum node height */
  nodeHeight: number;
  /** Maximum children before grouping */
  maxChildrenBeforeGroup: number;
  /** Width of grouped pool */
  groupedPoolWidth: number;
  /** Height of grouped pool */
  groupedPoolHeight: number;
}

export interface LayoutResult {
  /** Root nodes with computed positions */
  roots: LayoutNode[];
  /** Total width of the layout */
  width: number;
  /** Total height of the layout */
  height: number;
  /** Minimum X value (for centering) */
  minX: number;
  /** Maximum X value */
  maxX: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  siblingSpacing: 40,
  levelSpacing: 80,
  nodeWidth: 140,
  nodeHeight: 120,
  maxChildrenBeforeGroup: 4,
  groupedPoolWidth: 200,
  groupedPoolHeight: 80,
};

// ============================================================================
// Layout Engine
// ============================================================================

/**
 * Compute tree layout for hierarchy nodes
 */
export function computeTreeLayout(
  roots: HierarchyNode[],
  config: Partial<LayoutConfig> = {},
): LayoutResult {
  const cfg: LayoutConfig = { ...DEFAULT_LAYOUT_CONFIG, ...config };

  // Convert hierarchy nodes to layout nodes
  const layoutRoots = roots.map((root) => createLayoutNode(root, null, cfg));

  // Process each root tree
  for (const root of layoutRoots) {
    // First pass: compute initial X positions and Mod values
    firstWalk(root, cfg);

    // Second pass: ensure no nodes are off-screen (negative X)
    const minX = getMinX(root);
    if (minX < 0) {
      root.x -= minX;
      root.mod -= minX;
    }

    // Third pass: compute final X positions
    secondWalk(root, 0);
  }

  // If multiple roots, position them side by side
  if (layoutRoots.length > 1) {
    let currentX = 0;
    for (const root of layoutRoots) {
      const treeWidth = getTreeWidth(root);
      const treeMinX = getMinX(root);

      // Shift tree so it starts at currentX
      const shift = currentX - treeMinX;
      shiftTree(root, shift);

      currentX += treeWidth + cfg.siblingSpacing * 2;
    }
  }

  // Compute bounds
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;

  for (const root of layoutRoots) {
    traverseTree(root, (node) => {
      minX = Math.min(minX, node.x - cfg.nodeWidth / 2);
      maxX = Math.max(maxX, node.x + cfg.nodeWidth / 2);
      maxY = Math.max(maxY, node.y + cfg.nodeHeight);
    });
  }

  return {
    roots: layoutRoots,
    width: maxX - minX,
    height: maxY,
    minX,
    maxX,
  };
}

/**
 * Create a layout node from a hierarchy node
 */
function createLayoutNode(
  node: HierarchyNode,
  parent: LayoutNode | null,
  config: LayoutConfig,
): LayoutNode {
  const shouldGroup = node.children.length >= config.maxChildrenBeforeGroup;

  const layoutNode: LayoutNode = {
    ...node,
    x: 0,
    y: parent ? parent.y + config.levelSpacing + config.nodeHeight : 0,
    mod: 0,
    isGrouped: shouldGroup,
    parent,
    layoutChildren: [],
  };

  // If grouped, children are rendered differently (not as separate tree nodes)
  if (!shouldGroup) {
    layoutNode.layoutChildren = node.children.map((child) =>
      createLayoutNode(child, layoutNode, config),
    );
  }

  return layoutNode;
}

/**
 * First walk: post-order traversal to compute initial X and Mod values
 */
function firstWalk(node: LayoutNode, config: LayoutConfig): void {
  // Process children first (post-order)
  for (const child of node.layoutChildren) {
    firstWalk(child, config);
  }

  // Get siblings
  const siblings = node.parent?.layoutChildren ?? [];
  const nodeIndex = siblings.indexOf(node);
  const leftSibling = nodeIndex > 0 ? siblings[nodeIndex - 1] : null;

  if (node.layoutChildren.length === 0) {
    // Leaf node: position relative to left sibling
    if (leftSibling) {
      node.x = leftSibling.x + config.nodeWidth + config.siblingSpacing;
    } else {
      node.x = 0;
    }
  } else {
    // Internal node: center over children
    const firstChild = node.layoutChildren[0];
    const lastChild = node.layoutChildren[node.layoutChildren.length - 1];
    const midpoint = (firstChild.x + lastChild.x) / 2;

    if (leftSibling) {
      node.x = leftSibling.x + config.nodeWidth + config.siblingSpacing;
      node.mod = node.x - midpoint;
    } else {
      node.x = midpoint;
    }
  }

  // Check for conflicts with left siblings' subtrees
  if (leftSibling) {
    resolveConflicts(node, config);
  }
}

/**
 * Resolve conflicts between this node's subtree and left siblings' subtrees
 */
function resolveConflicts(node: LayoutNode, config: LayoutConfig): void {
  const siblings = node.parent?.layoutChildren ?? [];
  const nodeIndex = siblings.indexOf(node);

  // Get right contour of all left siblings combined
  // Get left contour of this node's subtree
  let maxShift = 0;

  for (let i = 0; i < nodeIndex; i++) {
    const leftSibling = siblings[i];
    const leftContour = getRightContour(leftSibling);
    const rightContour = getLeftContour(node);

    // Check each level for conflicts
    const minLevel = Math.min(leftContour.size, rightContour.size);
    for (let level = 0; level < minLevel; level++) {
      const leftX = leftContour.get(level) ?? 0;
      const rightX = rightContour.get(level) ?? 0;

      const overlap = leftX - rightX + config.nodeWidth + config.siblingSpacing;
      if (overlap > maxShift) {
        maxShift = overlap;
      }
    }
  }

  if (maxShift > 0) {
    node.x += maxShift;
    node.mod += maxShift;

    // Center nodes between conflicting siblings
    centerNodesBetween(node, config);
  }
}

/**
 * Center nodes between the current node and its leftmost conflicting sibling
 */
function centerNodesBetween(node: LayoutNode, config: LayoutConfig): void {
  const siblings = node.parent?.layoutChildren ?? [];
  const nodeIndex = siblings.indexOf(node);

  if (nodeIndex <= 1) return; // No middle nodes to center

  const leftmostSibling = siblings[0];
  const numNodesBetween = nodeIndex - 1;
  const distanceBetween = node.x - leftmostSibling.x;
  const spacing = distanceBetween / (numNodesBetween + 1);

  for (let i = 1; i < nodeIndex; i++) {
    const middleNode = siblings[i];
    const desiredX = leftmostSibling.x + spacing * i;
    const shift = desiredX - middleNode.x;

    middleNode.x += shift;
    middleNode.mod += shift;
  }
}

/**
 * Get the left contour of a subtree (minimum X at each level)
 */
function getLeftContour(node: LayoutNode, modSum = 0, contour = new Map<number, number>()): Map<number, number> {
  const level = node.y;
  const x = node.x + modSum;

  if (!contour.has(level) || x < contour.get(level)!) {
    contour.set(level, x);
  }

  for (const child of node.layoutChildren) {
    getLeftContour(child, modSum + node.mod, contour);
  }

  return contour;
}

/**
 * Get the right contour of a subtree (maximum X at each level)
 */
function getRightContour(node: LayoutNode, modSum = 0, contour = new Map<number, number>()): Map<number, number> {
  const level = node.y;
  const x = node.x + modSum;

  if (!contour.has(level) || x > contour.get(level)!) {
    contour.set(level, x);
  }

  for (const child of node.layoutChildren) {
    getRightContour(child, modSum + node.mod, contour);
  }

  return contour;
}

/**
 * Second walk: pre-order traversal to compute final X positions
 */
function secondWalk(node: LayoutNode, modSum: number): void {
  node.x += modSum;

  for (const child of node.layoutChildren) {
    secondWalk(child, modSum + node.mod);
  }
}

/**
 * Get minimum X value in a tree
 */
function getMinX(node: LayoutNode, modSum = 0): number {
  let minX = node.x + modSum;

  for (const child of node.layoutChildren) {
    minX = Math.min(minX, getMinX(child, modSum + node.mod));
  }

  return minX;
}

/**
 * Get the width of a tree
 */
function getTreeWidth(node: LayoutNode): number {
  let minX = Infinity;
  let maxX = -Infinity;

  traverseTree(node, (n) => {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
  });

  return maxX - minX;
}

/**
 * Shift an entire tree by a given amount
 */
function shiftTree(node: LayoutNode, shift: number): void {
  traverseTree(node, (n) => {
    n.x += shift;
  });
}

/**
 * Traverse a tree and call a function on each node
 */
function traverseTree(node: LayoutNode, fn: (node: LayoutNode) => void): void {
  fn(node);
  for (const child of node.layoutChildren) {
    traverseTree(child, fn);
  }
}

// ============================================================================
// SVG Path Helpers
// ============================================================================

/**
 * Generate an SVG path for a curved connector between parent and child
 */
export function generateConnectorPath(
  parentX: number,
  parentY: number,
  childX: number,
  childY: number,
  nodeHeight: number,
): string {
  const startY = parentY + nodeHeight;
  const endY = childY;
  const midY = (startY + endY) / 2;

  // Curved path using cubic bezier
  return `M ${parentX} ${startY}
          C ${parentX} ${midY}, ${childX} ${midY}, ${childX} ${endY}`;
}

/**
 * Generate an SVG path for a branching connector (one parent to multiple children)
 */
export function generateBranchingPath(
  parentX: number,
  parentY: number,
  childXPositions: number[],
  nodeHeight: number,
  levelSpacing: number,
): string {
  if (childXPositions.length === 0) return '';

  const startY = parentY + nodeHeight;
  const branchY = startY + levelSpacing * 0.4;
  const endY = parentY + nodeHeight + levelSpacing;

  const paths: string[] = [];

  // Vertical line from parent
  paths.push(`M ${parentX} ${startY} L ${parentX} ${branchY}`);

  // Horizontal line spanning all children
  const minChildX = Math.min(...childXPositions);
  const maxChildX = Math.max(...childXPositions);

  if (childXPositions.length > 1) {
    paths.push(`M ${minChildX} ${branchY} L ${maxChildX} ${branchY}`);
  }

  // Vertical lines down to each child
  for (const childX of childXPositions) {
    paths.push(`M ${childX} ${branchY} L ${childX} ${endY}`);
  }

  return paths.join(' ');
}

/**
 * Generate a curved bracket path for grouped children
 */
export function generateBracketPath(
  centerX: number,
  startY: number,
  width: number,
  height: number,
): string {
  const leftX = centerX - width / 2;
  const rightX = centerX + width / 2;
  const curveRadius = 8;

  // Two paths: left branch and right branch
  const leftPath = `M ${centerX} ${startY}
                    L ${centerX} ${startY + height * 0.3}
                    Q ${centerX} ${startY + height * 0.5}, ${centerX - curveRadius} ${startY + height * 0.5}
                    L ${leftX + curveRadius} ${startY + height * 0.5}
                    Q ${leftX} ${startY + height * 0.5}, ${leftX} ${startY + height * 0.5 + curveRadius}
                    L ${leftX} ${startY + height}`;

  const rightPath = `M ${centerX} ${startY}
                     L ${centerX} ${startY + height * 0.3}
                     Q ${centerX} ${startY + height * 0.5}, ${centerX + curveRadius} ${startY + height * 0.5}
                     L ${rightX - curveRadius} ${startY + height * 0.5}
                     Q ${rightX} ${startY + height * 0.5}, ${rightX} ${startY + height * 0.5 + curveRadius}
                     L ${rightX} ${startY + height}`;

  return `${leftPath} ${rightPath}`;
}
