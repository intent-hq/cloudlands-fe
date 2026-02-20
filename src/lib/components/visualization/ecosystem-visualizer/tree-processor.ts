/**
 * Tree processing - converts raw file tree to processed nodes with layout info
 *
 * Performance optimizations:
 * 1. Smart pruning - consolidate excess siblings into "+N files/folders" nodes
 * 2. Focus-aware budgeting - allocate more nodes to focused/zoomed subtree
 * 3. Highlighted file preservation - always show changed files
 * 4. Depth-based limits - control max render depth
 */

import { hierarchy, pack } from 'd3';
import type { FileNode, ProcessedNode, BlobShape } from './types';
import { getColorForExtension } from './language-colors';
import { DEFAULT_ECOSYSTEM_SETTINGS } from './types';

// Default node limit for performance - can be overridden via options
const DEFAULT_MAX_NODES = 15000;
const MAX_SIBLINGS_PER_DEPTH = 100; // Consolidate when more siblings than this
const MIN_SIBLINGS_TO_KEEP = 5; // Always keep at least this many siblings

export interface TreeProcessorOptions {
  minFileRadius?: number;
  maxFileRadius?: number;
  maxNodes?: number;
  maxDepth?: number; // Maximum depth to render (default: unlimited)
  focusPath?: string | null; // Path to allocate more budget to
  highlightedPaths?: Set<string>; // Paths that must always be visible
}

/**
 * Get the depth of the focus path in the tree
 */
function getFocusDepth(focusPath: string | null): number {
  if (!focusPath) return 0;
  return focusPath.split('/').length;
}

// Cache for node counts to avoid repeated O(n) traversals
const nodeCountCache = new WeakMap<FileNode, number>();

/**
 * Count total nodes in a FileNode tree (cached)
 */
function countNodes(node: FileNode): number {
  const cached = nodeCountCache.get(node);
  if (cached !== undefined) return cached;

  const count =
    !node.children || node.children.length === 0
      ? 1
      : 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);

  nodeCountCache.set(node, count);
  return count;
}

/**
 * Check if a path is or contains a highlighted path
 */
function isOrContainsHighlighted(path: string, highlightedPaths: Set<string>): boolean {
  if (highlightedPaths.has(path)) return true;
  // Check if any highlighted path starts with this path
  for (const hp of highlightedPaths) {
    if (hp.startsWith(`${path}/`)) return true;
  }
  return false;
}

/**
 * Check if a path is an ancestor of the focus path
 */
function isAncestorOfFocus(nodePath: string, focus: string): boolean {
  if (!focus || !nodePath) return false;
  return focus.startsWith(`${nodePath}/`);
}

/**
 * Prune a file tree to fit within a node budget
 * - Prioritizes highlighted paths
 * - Consolidates excess siblings into "+N files/folders" nodes
 * - Focus-aware: allocates 80% of budget to focused subtree (like repo-visualizer)
 */
function pruneTree(
  node: FileNode,
  maxNodes: number,
  highlightedPaths: Set<string>,
  focusPath: string | null,
  depth: number = 0,
): FileNode {
  if (!node.children || node.children.length === 0) return node;
  if (maxNodes <= 1) return { ...node, children: undefined };

  const availableForChildren = maxNodes - 1; // -1 for this node

  // Check if we're AT the focused folder - distribute budget normally among ALL children
  const atFocusedFolder = focusPath && node.path === focusPath;
  // Check if we're INSIDE the focused folder - all children get equal treatment
  const insideFocusedFolder = focusPath && node.path.startsWith(`${focusPath}/`);

  // Separate children into categories
  const folders: FileNode[] = [];
  const files: FileNode[] = [];
  const highlightedFolders: FileNode[] = [];
  const highlightedFiles: FileNode[] = [];
  let focusedFolder: FileNode | null = null;

  for (const child of node.children) {
    const isFolder = child.children && child.children.length > 0;
    const isHighlighted = isOrContainsHighlighted(child.path, highlightedPaths);
    const isOnFocusPath =
      focusPath && (isAncestorOfFocus(child.path, focusPath) || child.path === focusPath);

    if (isFolder) {
      if (isOnFocusPath && !atFocusedFolder && !insideFocusedFolder) {
        focusedFolder = child; // This folder is on the path to focus
      } else if (isHighlighted) {
        highlightedFolders.push(child);
      } else {
        folders.push(child);
      }
    } else {
      if (isHighlighted) highlightedFiles.push(child);
      else files.push(child);
    }
  }

  // Sort by size (largest first) for non-highlighted items
  folders.sort((a, b) => countNodes(b) - countNodes(a));
  files.sort((a, b) => (b.size || 0) - (a.size || 0));

  // Calculate budget allocation
  const highlightedCount = highlightedFolders.length + highlightedFiles.length;
  let remainingBudget = Math.max(0, availableForChildren - highlightedCount);

  // Focus-aware allocation: give 80% to the focused path, 20% to siblings
  let focusBudget = 0;
  if (focusedFolder) {
    focusBudget = Math.floor(remainingBudget * 0.8);
    remainingBudget -= focusBudget;
  }

  // Allocate remaining budget: 70% to folders, 30% to files
  const folderBudget = Math.floor(remainingBudget * 0.7);
  const fileBudget = remainingBudget - folderBudget;

  // Keep top folders and files within budget
  const maxFolders = Math.max(MIN_SIBLINGS_TO_KEEP, Math.min(folders.length, folderBudget));
  const maxFiles = Math.max(MIN_SIBLINGS_TO_KEEP, Math.min(files.length, fileBudget));

  const foldersToKeep = folders.slice(0, maxFolders);
  const foldersToConsolidate = folders.slice(maxFolders);
  const filesToKeep = files.slice(0, maxFiles);
  const filesToConsolidate = files.slice(maxFiles);

  // Build new children array
  const newChildren: FileNode[] = [];

  // Add highlighted items first (always visible)
  newChildren.push(...highlightedFolders, ...highlightedFiles);

  // Add the focused folder with its large budget share
  if (focusedFolder) {
    newChildren.push(pruneTree(focusedFolder, focusBudget, highlightedPaths, focusPath, depth + 1));
  }

  // Add kept folders (will be pruned recursively)
  const perFolderBudget =
    foldersToKeep.length > 0
      ? Math.floor((remainingBudget - filesToKeep.length) / foldersToKeep.length)
      : 0;
  for (const folder of foldersToKeep) {
    newChildren.push(pruneTree(folder, perFolderBudget, highlightedPaths, focusPath, depth + 1));
  }

  // Add kept files
  newChildren.push(...filesToKeep);

  // Add consolidation placeholders
  if (foldersToConsolidate.length > 0) {
    newChildren.push({
      name: `+${foldersToConsolidate.length} folders`,
      path: `__consolidated_folders_${node.path}_${depth}`,
      size: foldersToConsolidate.reduce((sum, f) => sum + countNodes(f), 0) * 10,
    });
  }

  if (filesToConsolidate.length > 0) {
    newChildren.push({
      name: `+${filesToConsolidate.length} files`,
      path: `__consolidated_files_${node.path}_${depth}`,
      size: filesToConsolidate.reduce((sum, f) => sum + (f.size || 100), 0),
    });
  }

  return { ...node, children: newChildren.length > 0 ? newChildren : undefined };
}

/**
 * Process a file tree into nodes ready for force simulation
 * Uses a horizontal layout strategy to spread folders across the width
 */
export function processTree(
  root: FileNode,
  width: number,
  height: number,
  options: TreeProcessorOptions = {},
): ProcessedNode[] {
  const {
    minFileRadius = DEFAULT_ECOSYSTEM_SETTINGS.minFileRadius,
    maxFileRadius = DEFAULT_ECOSYSTEM_SETTINGS.maxFileRadius,
    maxNodes = DEFAULT_MAX_NODES,
    maxDepth = 100,
    focusPath = null,
    highlightedPaths = new Set<string>(),
  } = options;

  // First, prune the tree if it's too large
  const originalCount = countNodes(root);
  const prunedRoot =
    originalCount > maxNodes ? pruneTree(root, maxNodes, highlightedPaths, focusPath) : root;

  const nodes: ProcessedNode[] = [];
  const nodeMap = new Map<string, ProcessedNode>();

  // Compute sizes using d3.pack for radius estimates
  // Use sqrt scale (area-proportional) for more visible size differences
  const h = hierarchy(prunedRoot)
    .sum((d) => {
      if (d.children && d.children.length > 0) return 0;
      // Use sqrt scale for sizes - gives better visual differentiation
      // Minimum size of 100 bytes, sqrt for area-proportional representation
      const sizeBytes = d.size || 100;
      return Math.sqrt(Math.max(100, sizeBytes));
    })
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  // Pack to get radius estimates
  const minPackSize = 400;
  const packSize = Math.max(minPackSize, Math.min(width, height) * 0.85);
  const packLayout = pack<FileNode>().size([packSize, packSize]).padding(20);

  const packed = packLayout(h);

  // Calculate min/max values for normalization
  let minValue = Infinity,
    maxValue = 0;
  const collectValues = (node: any) => {
    if (!node.children || node.children.length === 0) {
      minValue = Math.min(minValue, node.value || 0);
      maxValue = Math.max(maxValue, node.value || 0);
    }
    if (node.children) {
      for (const child of node.children) collectValues(child);
    }
  };
  collectValues(packed);
  const valueRange = maxValue - minValue || 1;

  // Convert to processed nodes
  let nodeCount = 0;

  // Calculate focus depth for relative depth checking
  // This allows focused subtrees to show more levels
  const focusDepth = getFocusDepth(focusPath);

  const processNode = (
    packedNode: any,
    parent?: ProcessedNode,
    depth: number = 0,
    siblingIndex: number = 0,
    siblingCount: number = 1,
  ): ProcessedNode | null => {
    const data = packedNode.data as FileNode;

    // Check if this node is on the focus path or inside the focused subtree
    const isOnFocusPath =
      focusPath && (focusPath.startsWith(`${data.path}/`) || data.path === focusPath);
    const isInsideFocus = focusPath && data.path.startsWith(`${focusPath}/`);

    // Calculate effective depth - relative to focus when inside focused subtree
    // This allows focused areas to show maxDepth levels deep from their root
    let effectiveDepth = depth;
    if (isInsideFocus) {
      // Inside focus: calculate depth relative to the focus path
      effectiveDepth = depth - focusDepth;
    }

    // Apply depth limit: use effective depth for focus subtree, absolute depth otherwise
    if (nodeCount >= maxNodes) return null;
    if (!isOnFocusPath && !isInsideFocus && depth > maxDepth) return null;
    if ((isOnFocusPath || isInsideFocus) && effectiveDepth > maxDepth) return null;
    const isFolder = !!(data.children && data.children.length > 0);
    const isConsolidated = data.path.startsWith('__consolidated_');
    const extension = isFolder || isConsolidated ? undefined : data.name.split('.').pop();

    // Calculate radius - scale based on relative size
    let radius = packedNode.r;
    if (!isFolder) {
      // Normalize value to 0-1 range and interpolate between min/max radius
      const normalizedValue = (packedNode.value - minValue) / valueRange;
      radius = minFileRadius + normalizedValue * (maxFileRadius - minFileRadius);
    }

    // Initial positions centered in canvas - force simulation will arrange them
    const node: ProcessedNode = {
      id: data.path || data.name,
      path: data.path,
      name: data.name,
      label: data.name,
      extension,
      color: getColorForExtension(extension),
      size: data.size,
      value: packedNode.value || 1,
      depth,
      isFolder,
      parent,
      children: undefined,
      // Initial positions at canvas center - force simulation will pack them
      x: width / 2,
      y: height / 2,
      vx: 0,
      vy: 0,
      r: radius,
      effectiveRadius: isFolder ? packedNode.r : undefined,
    };

    nodes.push(node);
    nodeMap.set(node.path, node);
    nodeCount++;

    if (packedNode.children) {
      const children: ProcessedNode[] = [];
      const childCount = packedNode.children.length;
      for (let i = 0; i < childCount; i++) {
        const child = packedNode.children[i];
        const childNode = processNode(child, node, depth + 1, i, childCount);
        if (childNode) {
          children.push(childNode);
        }
      }
      if (children.length > 0) {
        node.children = children;
      }
    }

    return node;
  };

  processNode(packed);

  return nodes;
}

/**
 * Get only leaf nodes (files) for rendering
 */
export function getLeafNodes(nodes: ProcessedNode[]): ProcessedNode[] {
  return nodes.filter((n) => !n.isFolder);
}

/**
 * Get folder nodes for blob shapes
 */
export function getFolderNodes(nodes: ProcessedNode[]): ProcessedNode[] {
  return nodes.filter((n) => n.isFolder);
}

/**
 * Point-in-polygon test using ray casting algorithm
 */
function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Cache for findNodeAtPosition optimization
let cachedLeafNodes: ProcessedNode[] | null = null;
let cachedSortedBlobs: BlobShape[] | null = null;
let cachedNodesByPath: Map<string, ProcessedNode> | null = null;
let lastNodesRef: ProcessedNode[] | null = null;
let lastBlobsRef: BlobShape[] | null = null;

/**
 * Find node at position - checks files first, then folders by their hull shapes
 * Optimized with caching for repeated calls (hover detection)
 */
export function findNodeAtPosition(
  nodes: ProcessedNode[],
  x: number,
  y: number,
  scale: number = 1,
  blobs: BlobShape[] = [],
): ProcessedNode | null {
  // Update cache if nodes/blobs changed
  if (nodes !== lastNodesRef) {
    lastNodesRef = nodes;
    cachedLeafNodes = getLeafNodes(nodes);
    cachedNodesByPath = new Map(nodes.map((n) => [n.path, n]));
  }
  if (blobs !== lastBlobsRef) {
    lastBlobsRef = blobs;
    cachedSortedBlobs = [...blobs].sort((a, b) => b.depth - a.depth);
  }

  const files = cachedLeafNodes!;
  const sortedBlobs = cachedSortedBlobs!;
  const nodesByPath = cachedNodesByPath!;

  // Check files first (they're on top visually)
  // Use squared distance to avoid sqrt (faster)
  const minRadiusSq = (4 / scale) ** 2;
  for (const node of files) {
    const dx = node.x - x;
    const dy = node.y - y;
    const distSq = dx * dx + dy * dy;
    const effectiveRadiusSq = Math.max(node.r * node.r, minRadiusSq);
    if (distSq <= effectiveRadiusSq) {
      return node;
    }
  }

  // Check folders using their blob hull shapes (more accurate than circle)
  for (const blob of sortedBlobs) {
    if (pointInPolygon(x, y, blob.hull)) {
      // Find the corresponding folder node (use cached map)
      const folder = nodesByPath.get(blob.path);
      if (folder?.isFolder) return folder;
    }
  }

  return null;
}
