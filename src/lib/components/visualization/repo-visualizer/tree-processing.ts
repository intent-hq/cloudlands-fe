/**
 * Tree processing logic for the repo visualizer
 * Ported from githubocto/repo-visualizer
 */
import {
  hierarchy,
  pack,
  scaleLinear,
  extent,
  range,
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
} from 'd3';
import type { FileType, ExtendedFileType, ProcessedDataItem, ColorEncoding } from './types';
import languageColors from './language-colors';

export const LOOSE_FILES_ID = '__structure_loose_file__';
export const DEFAULT_WIDTH = 580;
export const DEFAULT_HEIGHT = 580 * (5 / 3);
export const MAX_CHILDREN = 20000; // Max nodes to render
export const MAX_SIBLINGS_PER_DEPTH = 50; // Consolidate when more than this many siblings
export const HIGHLIGHTED_SIZE_MULTIPLIER = 80; // How much to scale up highlighted files

/** Clamp a value between min and max */
const keepBetween = (min: number, value: number, max: number): number =>
  Math.max(min, Math.min(max, value));

// Accessors for commit data
export const lastCommitAccessor = (d: ExtendedFileType) =>
  new Date(`${d.commits?.[0]?.date || 0}0`);
export const numberOfCommitsAccessor = (d: ExtendedFileType) => d.commits?.length || 0;

// Count occurrences of each extension
function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const k = key(item);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// Find max entry
function maxByValue(obj: Record<string, number>): [string, number] | undefined {
  let maxKey: string | undefined;
  let maxVal = -Infinity;
  for (const [k, v] of Object.entries(obj)) {
    if (v > maxVal) {
      maxVal = v;
      maxKey = k;
    }
  }
  return maxKey ? [maxKey, maxVal] : undefined;
}

// Flatten tree to get all leaf nodes
function flattenTree(d: FileType): FileType[] {
  if (d.children) {
    return d.children.flatMap(flattenTree);
  }
  return [d];
}

// Get unique values (kept for potential future use)
function _uniqBy<T>(arr: T[], key: (item: T) => unknown): T[] {
  const seen = new Set();
  return arr.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function createColorScale(
  data: FileType | null,
  colorEncoding: ColorEncoding,
  _fileColors: Record<string, string>,
) {
  if (!data) return { colorScale: () => '#f4f4f4', colorExtent: [0, 0] as [number, number] };

  const items = flattenTree(data) as ExtendedFileType[];

  let colorExtent: [number, number];
  if (colorEncoding === 'last-change') {
    const flatTree = items
      .map(lastCommitAccessor)
      .sort((a, b) => b.getTime() - a.getTime())
      .slice(0, -8);
    const extentResult = extent(flatTree, (d) => d.getTime());
    colorExtent = [
      extentResult[0] !== undefined ? extentResult[0] : 0,
      extentResult[1] !== undefined ? extentResult[1] : 0,
    ];
  } else {
    const flatTree = items
      .map(numberOfCommitsAccessor)
      .sort((a, b) => b - a)
      .slice(2, -2);
    const extentResult = extent(flatTree);
    colorExtent = [
      extentResult[0] !== undefined ? extentResult[0] : 0,
      extentResult[1] !== undefined ? extentResult[1] : 0,
    ];
  }

  const colors = [
    '#f4f4f4',
    '#f4f4f4',
    '#f4f4f4',
    colorEncoding === 'last-change' ? '#C7ECEE' : '#FEEAA7',
    colorEncoding === 'number-of-changes' ? '#3C40C6' : '#823471',
  ];

  const colorScale = scaleLinear<string>()
    .domain(
      range(0, colors.length).map(
        (i: number) =>
          +colorExtent[0] + ((colorExtent[1] - colorExtent[0]) * i) / (colors.length - 1),
      ),
    )
    .range(colors)
    .clamp(true);

  return { colorScale, colorExtent };
}

export function getColor(
  d: ExtendedFileType,
  colorEncoding: ColorEncoding,
  fileColors: Record<string, string>,
  colorScale: (value: number) => string,
): string {
  // Use a hex color that canvas can understand (muted gray)
  const defaultColor = '#71717a';
  if (colorEncoding === 'type') {
    const isParent = !!d.children;
    if (isParent && d.children) {
      const extensions = countBy(d.children as ExtendedFileType[], (c) => c.extension || '');
      const mainExtension = maxByValue(extensions)?.[0];
      return (mainExtension && fileColors[mainExtension]) || defaultColor;
    }
    return (d.extension && fileColors[d.extension]) || defaultColor;
  } else if (colorEncoding === 'number-of-changes') {
    return colorScale(numberOfCommitsAccessor(d)) || defaultColor;
  } else if (colorEncoding === 'last-change') {
    return colorScale(lastCommitAccessor(d).getTime()) || defaultColor;
  }
  return defaultColor;
}

export function getSortOrder(
  item: ExtendedFileType,
  cachedOrders: Record<string, number>,
  i: number = 0,
): number {
  if (cachedOrders[item.path]) return cachedOrders[item.path];
  if (cachedOrders[item.path?.split('/').slice(0, -1).join('/')]) return -100000000;
  if (item.name === 'public') return -1000000;
  return (item.value || 0) + -i;
}

/**
 * Check if a path is highlighted or contains highlighted files
 */
function isPathOrContainsHighlighted(
  path: string,
  highlightedPaths: Set<string>,
  ancestorPaths: Set<string>,
): boolean {
  if (highlightedPaths.has(path)) return true;
  if (ancestorPaths.has(path)) return true;
  return false;
}

/**
 * Consolidate too many siblings by grouping them into "other" buckets by extension
 */
function consolidateSiblings(
  children: ExtendedFileType[],
  highlightedPaths: Set<string>,
  depth: number = 0,
  ancestorPaths: Set<string> = new Set(),
): ExtendedFileType[] {
  // Only consolidate at top level - all deeper levels keep all files for zoom
  if (depth >= 1) return children;

  const maxAtDepth = MAX_SIBLINGS_PER_DEPTH;
  if (children.length <= maxAtDepth) return children;

  // Separate directories from files, prioritizing those with highlighted descendants
  // IMPORTANT: Also treat ancestor paths as directories even if they have no children
  // (this can happen if children were filtered out or not loaded due to depth limits)
  const isDirectory = (c: ExtendedFileType) => {
    // Has children with content
    if (c.children?.length) return true;
    // Is an ancestor path (must be a directory to be an ancestor)
    if (ancestorPaths.has(c.path)) return true;
    // Contains a highlighted file (must be a directory)
    if (highlightedPaths.has(c.path)) return false; // highlighted files are files, not dirs
    return false;
  };

  const directories = children.filter(isDirectory);
  const files = children.filter((c) => !isDirectory(c));

  // Separate directories that are on the path to highlighted files (must keep these!)
  const highlightedDirs = directories.filter((d) =>
    isPathOrContainsHighlighted(d.path, highlightedPaths, ancestorPaths),
  );
  let nonHighlightedDirs = directories.filter(
    (d) => !isPathOrContainsHighlighted(d.path, highlightedPaths, ancestorPaths),
  );

  // Consolidate non-highlighted directories aggressively
  const maxDirs = Math.max(2, Math.floor(maxAtDepth / 2)) - highlightedDirs.length;
  if (nonHighlightedDirs.length > maxDirs) {
    // Sort by total descendant count
    nonHighlightedDirs.sort((a, b) => countDescendants(b) - countDescendants(a));

    const dirsToKeep = nonHighlightedDirs.slice(0, maxDirs);
    const dirsToConsolidate = nonHighlightedDirs.slice(maxDirs);

    if (dirsToConsolidate.length > 0) {
      // Count total descendants to estimate size
      const totalDescendants = dirsToConsolidate.reduce((sum, d) => sum + countDescendants(d), 0);
      const estimatedValue = Math.max(100, totalDescendants * 10); // Ensure visible size
      dirsToKeep.push({
        name: `+${dirsToConsolidate.length} folders`,
        path: `__consolidated_dirs__${depth}_${Math.random().toString(36).slice(2)}`,
        label: `+${dirsToConsolidate.length} folders`,
        size: estimatedValue,
        value: Math.min(estimatedValue, 500),
        color: '#71717a',
        sortOrder: -2000,
      });
    }
    nonHighlightedDirs = dirsToKeep;
  }

  const allDirs = [...highlightedDirs, ...nonHighlightedDirs];

  // Keep highlighted files separate (they should always be visible)
  const highlightedFiles = files.filter((f) => highlightedPaths.has(f.path));
  const nonHighlightedFiles = files.filter((f) => !highlightedPaths.has(f.path));

  // Very few non-highlighted files to keep
  const keepCount = Math.max(1, maxAtDepth - highlightedFiles.length - allDirs.length);

  // Sort by size to keep largest files visible
  nonHighlightedFiles.sort((a, b) => (b.value || 0) - (a.value || 0));
  const filesToKeep = nonHighlightedFiles.slice(0, keepCount);
  const filesToConsolidate = nonHighlightedFiles.slice(keepCount);

  if (filesToConsolidate.length === 0) {
    return [...allDirs, ...highlightedFiles, ...filesToKeep];
  }

  // Create a single consolidated "other files" node
  const totalSize = filesToConsolidate.reduce((sum, f) => sum + (f.value || 0), 0);
  // Ensure consolidated node has visible size based on file count
  const consolidatedValue = Math.max(50, Math.min(totalSize, 300), filesToConsolidate.length * 5);
  const consolidated: ExtendedFileType = {
    name: `+${filesToConsolidate.length} files`,
    path: `__consolidated__${depth}_${Math.random().toString(36).slice(2)}`,
    label: `+${filesToConsolidate.length} files`,
    size: consolidatedValue,
    value: consolidatedValue,
    color: '#71717a',
    sortOrder: -1500,
  };

  return [...allDirs, ...highlightedFiles, ...filesToKeep, consolidated];
}

/**
 * Count total descendants in a node
 */
function countDescendants(node: ExtendedFileType): number {
  if (!node.children) return 1;
  return node.children.reduce((sum, child) => sum + countDescendants(child), 0);
}

export function processChild(
  child: FileType,
  getColorFn: (d: ExtendedFileType) => string,
  cachedOrders: Record<string, number>,
  i: number = 0,
  fileColors: Record<string, string>,
  highlightedPaths: Set<string> = new Set(),
  depth: number = 0,
  ancestorPaths: Set<string> = new Set(),
): ExtendedFileType | undefined {
  if (!child) return undefined;
  const isRoot = !child.path;
  let name = child.name;
  let path = child.path;

  let children = child.children
    ?.map((c, idx) =>
      processChild(
        c,
        getColorFn,
        cachedOrders,
        idx,
        fileColors,
        highlightedPaths,
        depth + 1,
        ancestorPaths,
      ),
    )
    .filter(Boolean) as ExtendedFileType[] | undefined;

  // Collapse single-child directories - BUT NOT if the child is on the highlighted path!
  // Also don't collapse if the single child is a FILE (no children) - we want to keep the directory structure
  if (children?.length === 1) {
    const singleChild = children[0];
    const childPath = singleChild.path;
    const childIsHighlighted = highlightedPaths.has(childPath) || ancestorPaths.has(childPath);
    const childIsDirectory = singleChild.children && singleChild.children.length > 0;

    // Only collapse if:
    // 1. The single child is not highlighted/an ancestor
    // 2. The single child is a DIRECTORY (has children) - don't collapse if it's a file
    if (!childIsHighlighted && childIsDirectory) {
      name = `${name}/${singleChild.name}`;
      path = singleChild.path;
      children = singleChild.children;
    }
  }

  // Consolidate if too many siblings (but preserve highlighted files and their ancestors)
  // Only consolidate at top level - all deeper levels keep all files for zoom detail
  if (depth < 1 && children && children.length > MAX_SIBLINGS_PER_DEPTH) {
    children = consolidateSiblings(children, highlightedPaths, depth, ancestorPaths);
  }

  const pathWithoutExtension = path?.split('.').slice(0, -1).join('.');
  // Only set extension if name actually has a dot (files), otherwise undefined (folders)
  const nameParts = name?.split('.') || [];
  const extension = nameParts.length > 1 ? nameParts.slice(-1)[0] : undefined;
  const hasExtension = !!(extension && fileColors[extension]);

  // Group loose files at root level
  if (isRoot && children) {
    const looseChildren = children.filter((d) => !d.children?.length);
    children = [
      ...children.filter((d) => d.children?.length),
      {
        name: LOOSE_FILES_ID,
        path: LOOSE_FILES_ID,
        size: 0,
        children: looseChildren,
      },
    ];
  }

  // Calculate display size and pack value separately
  // Display size is for visual reference, pack value determines circle radius
  const isHighlighted = highlightedPaths.has(path);
  const rawSize = child.size || 0;

  // Display size (for reference)
  let displaySize = ['woff', 'woff2', 'ttf', 'otf', 'png', 'jpg', 'svg'].includes(extension || '')
    ? 100
    : Math.min(15000, hasExtension ? rawSize : Math.min(rawSize, 9000));

  // Pack value uses LOG SCALE to prevent huge files from dominating
  // This gives reasonable circle sizes regardless of file size
  // Files range from value 10 (tiny) to ~100 (large)
  let packValue = rawSize > 0 ? Math.max(10, Math.log10(rawSize + 1) * 20) : 10;

  // Apply size multiplier for highlighted files
  if (isHighlighted) {
    displaySize = displaySize * HIGHLIGHTED_SIZE_MULTIPLIER;
    packValue = packValue * 5; // Boost highlighted files but not as extremely
  }

  const extendedChild: ExtendedFileType = {
    ...child,
    name,
    path,
    label: name,
    extension,
    pathWithoutExtension,
    size: displaySize,
    value: packValue, // Use log-scaled value for circle packing
    color: '#fff',
    children,
  };

  extendedChild.color = getColorFn(extendedChild);
  extendedChild.sortOrder = getSortOrder(extendedChild, cachedOrders, i);

  return extendedChild;
}

export function packData(
  data: FileType | null,
  colorEncoding: ColorEncoding,
  customFileColors: Record<string, string>,
  width: number,
  height: number,
  cachedPositions: Record<string, [number, number]>,
  cachedOrders: Record<string, number>,
  highlightedPaths: string[] = [],
  focusPath: string | null = null, // When set, give this subtree more of the node budget
): {
  packedData: ProcessedDataItem[];
  fileTypes: string[];
  colorScale: any;
  colorExtent: [number, number];
} {
  const fileColors = { ...languageColors, ...customFileColors };

  if (!data) {
    return {
      packedData: [],
      fileTypes: [],
      colorScale: () => '#f4f4f4',
      colorExtent: [0, 0],
    };
  }

  const { colorScale, colorExtent } = createColorScale(data, colorEncoding, fileColors);

  const getColorFn = (d: ExtendedFileType) =>
    getColor(d, colorEncoding, fileColors, colorScale as any);

  // Convert highlighted paths to a Set, including all ancestor directories
  // This ensures the entire path to each highlighted file is preserved
  const highlightedPathsSet = new Set(highlightedPaths);
  const ancestorPaths = new Set<string>();
  for (const path of highlightedPaths) {
    const parts = path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      ancestorPaths.add(current);
    }
  }

  const processedData = processChild(
    data,
    getColorFn,
    cachedOrders,
    0,
    fileColors,
    highlightedPathsSet,
    0,
    ancestorPaths,
  );
  if (!processedData) {
    return {
      packedData: [],
      fileTypes: [],
      colorScale,
      colorExtent,
    };
  }

  // Prune tree to MAX_CHILDREN nodes BEFORE packing
  // Balance: ensure all top-level folders get representation, then prioritize by size
  function countNodes(node: ExtendedFileType): number {
    if (!node.children || node.children.length === 0) return 1;
    return 1 + node.children.reduce((sum, c) => sum + countNodes(c as ExtendedFileType), 0);
  }

  function getTotalValue(node: ExtendedFileType): number {
    if (!node.children || node.children.length === 0) return node.value || 0;
    return node.children.reduce((sum, c) => sum + getTotalValue(c as ExtendedFileType), 0);
  }

  // Check if a path is an ancestor of the focus path (focus starts with path/)
  function isAncestorOfFocus(nodePath: string, focus: string): boolean {
    if (!focus || !nodePath) return false;
    return focus.startsWith(`${nodePath}/`);
  }

  // Focus-aware pruning: give more budget to the focused subtree
  function pruneBalanced(
    root: ExtendedFileType,
    maxNodes: number,
    isTopLevel: boolean = true,
    focus: string | null = null,
    depth: number = 0,
  ): ExtendedFileType {
    if (!root.children || root.children.length === 0) return root;

    const availableForChildren = maxNodes - 1; // -1 for root itself
    const numChildren = root.children.length;

    // Check if we're AT the focused folder - if so, distribute budget normally among ALL children
    const atFocusedFolder = focus && root.path === focus;
    // Check if we're INSIDE the focused folder - if so, all children get equal treatment
    const insideFocusedFolder = focus && root.path.startsWith(`${focus}/`);

    const childrenWithInfo = root.children.map((c) => ({
      child: c as ExtendedFileType,
      value: getTotalValue(c as ExtendedFileType),
      count: countNodes(c as ExtendedFileType),
      // Only mark as "on focus path" if this child is an ancestor of focus (not at or inside)
      onFocusPath: focus ? isAncestorOfFocus((c as ExtendedFileType).path, focus) : false,
      // Check if child equals the focus
      isFocusTarget: focus ? (c as ExtendedFileType).path === focus : false,
    }));

    let allocations: number[];

    // Find child that's on the path to focus (ancestor) or IS the focus target
    const focusedChild = childrenWithInfo.find((c) => c.onFocusPath || c.isFocusTarget);

    if (focusedChild && !atFocusedFolder && !insideFocusedFolder) {
      // We're above the focus - give 80% to the path leading to focus
      const focusBudget = Math.floor(availableForChildren * 0.8);
      const otherBudget = availableForChildren - focusBudget;
      const otherChildren = childrenWithInfo.filter((c) => !c.onFocusPath && !c.isFocusTarget);
      const otherCount = otherChildren.length;

      // Distribute other budget evenly among non-focused children
      const perOther = otherCount > 0 ? Math.max(3, Math.floor(otherBudget / otherCount)) : 0;

      allocations = childrenWithInfo.map((c) => {
        if (c.onFocusPath || c.isFocusTarget) return focusBudget;
        return perOther;
      });
    } else if (isTopLevel && numChildren > 1 && !atFocusedFolder) {
      // Normal top-level allocation: fair minimum + value proportion
      const minPerChild = Math.max(5, Math.floor(availableForChildren / numChildren / 2));
      const totalMin = minPerChild * numChildren;
      const remaining = Math.max(0, availableForChildren - totalMin);

      const totalValue = childrenWithInfo.reduce((sum, c) => sum + c.value, 0);
      allocations = childrenWithInfo.map((c) => {
        const valueProportion = totalValue > 0 ? c.value / totalValue : 1 / numChildren;
        return Math.floor(minPerChild + remaining * valueProportion);
      });
    } else {
      // At or inside focused folder, OR normal distribution by value proportion
      // Give children proportional allocation based on their content
      const totalValue = childrenWithInfo.reduce((sum, c) => sum + c.value, 0);
      allocations = childrenWithInfo.map((c) => {
        const valueProportion = totalValue > 0 ? c.value / totalValue : 1 / numChildren;
        // Allow allocations < 1 - these children will be dropped
        return availableForChildren * valueProportion;
      });
    }

    // Apply allocations with hard budget constraint
    const prunedChildren: ExtendedFileType[] = [];
    let totalKept = 1; // Count root (always keep the folder itself)
    // Sort children by allocation (descending) to prioritize higher-value children
    const sortedIndices = childrenWithInfo
      .map((_, i) => i)
      .sort((a, b) => allocations[b] - allocations[a]);

    for (const i of sortedIndices) {
      const { child, count, onFocusPath, isFocusTarget } = childrenWithInfo[i];
      const allocated = allocations[i];
      const passFocus =
        onFocusPath || isFocusTarget || atFocusedFolder || insideFocusedFolder ? focus : null;

      // Check if we have budget for this child
      const remainingBudget = maxNodes - totalKept;
      if (remainingBudget < 1) {
        continue; // No more budget
      }

      // For focus path children, always include them
      const mustInclude = onFocusPath || isFocusTarget;

      if (!child.children || child.children.length === 0) {
        // Leaf node - keep it if we have budget or it's on focus path
        if (allocated >= 0.5 || mustInclude) {
          prunedChildren.push(child);
          totalKept += 1;
        }
        // else: drop the leaf node (no budget)
      } else if (count <= allocated && count <= remainingBudget && !passFocus) {
        // Child fits in both allocation AND remaining budget - keep as-is
        prunedChildren.push(child);
        totalKept += count;
      } else if (allocated >= 1 || mustInclude) {
        // Child needs pruning - recurse with constrained budget
        const budget = Math.max(2, Math.min(count, Math.floor(allocated), remainingBudget));
        const prunedChild = pruneBalanced(child, budget, false, passFocus, depth + 1);
        const prunedCount = countNodes(prunedChild);
        prunedChildren.push(prunedChild);
        totalKept += prunedCount;
      }
      // else: child doesn't meet budget threshold - drop it
    }

    return { ...root, children: prunedChildren.length > 0 ? prunedChildren : undefined };
  }

  // Always use same limit, but focus-aware pruning allocates budget to focused subtree
  const maxNodes = MAX_CHILDREN;
  const originalCount = countNodes(processedData);

  // First pass: try focus-aware pruning
  let prunedData =
    originalCount > maxNodes
      ? pruneBalanced(processedData, maxNodes, true, focusPath, 0)
      : processedData;
  let prunedCount = countNodes(prunedData);

  // If still over budget (focus-aware pruning doesn't always hit the target exactly),
  // do aggressive proportional pruning as fallback
  if (prunedCount > maxNodes) {
    prunedData = pruneBalanced(prunedData, maxNodes, true, null, 0);
    prunedCount = countNodes(prunedData);
  }

  // Count nodes in focused subtree for debugging (kept for potential future use)
  let _focusedSubtreeCount = 0;
  if (focusPath) {
    function countInSubtree(node: ExtendedFileType, targetPath: string): number {
      if (node.path === targetPath) return countNodes(node);
      if (!node.children) return 0;
      for (const child of node.children) {
        const count = countInSubtree(child as ExtendedFileType, targetPath);
        if (count > 0) return count;
      }
      return 0;
    }
    _focusedSubtreeCount = countInSubtree(prunedData, focusPath);
  }

  const hierarchicalData = hierarchy(prunedData)
    .sum((d: ExtendedFileType) => d.value ?? 0)
    .sort(
      (a, b) =>
        (b.data.sortOrder ?? 0) - (a.data.sortOrder ?? 0) || (b.data.name > a.data.name ? 1 : -1),
    );

  // Debug: check hierarchy values (kept for potential future use)
  const _allNodes = hierarchicalData.descendants();
  const _leaves = _allNodes.filter((n) => !n.children);
  const _totalValue = hierarchicalData.value || 0;

  // Pack into a square - d3.pack() guarantees children are contained within parents
  const packSize = Math.min(width, height);
  const packedTree = pack<ExtendedFileType>()
    .size([packSize, packSize])
    .padding((d: any) => {
      if (d.depth <= 0) return 0;
      // Reduce padding at deeper levels so nested circles use space more efficiently
      // This helps when zooming into deeply nested folders
      const depthFactor = Math.max(0.3, 1 - d.depth * 0.15);
      const hasChildWithNoChildren = d.children?.filter((c: any) => !c.children?.length).length > 1;
      if (hasChildWithNoChildren) return 1 * depthFactor; // Tight packing for files
      return 2 * depthFactor; // Small gap between folders
    })(hierarchicalData as any);

  // Get top-level items for force simulation spreading
  const topLevelItems = (packedTree.children || []) as any[];

  // Store original positions for each top-level item (relative to pack center)
  const originalPositions = new Map<string, { x: number; y: number }>();
  for (const item of topLevelItems) {
    originalPositions.set(item.data.path, { x: item.x, y: item.y });
  }

  // Run force simulation on TOP-LEVEL items only to spread them across the viewport
  if (topLevelItems.length > 1) {
    // Scale positions to fill the viewport better (stretch from square to rectangle)
    const scaleX = width / packSize;
    const scaleY = height / packSize;

    // Create simulation items with positions scaled to fill the viewport
    const simItems = topLevelItems.map((item: any) => ({
      item,
      // Scale from center of pack to fill viewport
      x: width / 2 + (item.x - packSize / 2) * scaleX,
      y: height / 2 + (item.y - packSize / 2) * scaleY,
      r: item.r,
    }));

    const simulation = forceSimulation(simItems)
      .force('centerX', forceX(width / 2).strength(0.01))
      .force('centerY', forceY(height / 2).strength(0.01))
      .force(
        'x',
        forceX((d: any) => cachedPositions[d.item.data.path]?.[0] || d.x).strength((d: any) =>
          cachedPositions[d.item.data.path] ? 0.5 : 0.05,
        ),
      )
      .force(
        'y',
        forceY((d: any) => cachedPositions[d.item.data.path]?.[1] || d.y).strength((d: any) =>
          cachedPositions[d.item.data.path] ? 0.5 : 0.05,
        ),
      )
      .force(
        'collide',
        forceCollide((d: any) => d.r + 10)
          .iterations(4)
          .strength(1),
      )
      .stop();

    // Run simulation
    for (let i = 0; i < 120; i++) {
      simulation.tick();
      // Keep within bounds
      simItems.forEach((d) => {
        d.x = keepBetween(d.r, d.x, width - d.r);
        d.y = keepBetween(d.r, d.y, height - d.r);
      });
    }

    // Apply movement to top-level items and translate all their descendants
    for (const simItem of simItems) {
      const item = simItem.item;
      const orig = originalPositions.get(item.data.path)!;

      // Calculate how much to translate descendants:
      // Children's original positions are relative to the pack's coordinate system.
      // The top-level item moved from orig.x,orig.y to simItem.x,simItem.y
      const dx = simItem.x - orig.x;
      const dy = simItem.y - orig.y;

      // Update the top-level item position
      item.x = simItem.x;
      item.y = simItem.y;

      // Recursively translate all descendants by the same delta
      const translateDescendants = (node: any) => {
        node.x += dx;
        node.y += dy;
        if (node.children) {
          node.children.forEach(translateDescendants);
        }
      };

      if (item.children) {
        item.children.forEach(translateDescendants);
      }
    }
  } else {
    // Just center everything if only one top-level item
    const centerPositions = (node: any) => {
      node.x = node.x + (width - packSize) / 2;
      node.y = node.y + (height - packSize) / 2;
      if (node.children) {
        node.children.forEach(centerPositions);
      }
    };
    centerPositions(packedTree);
  }

  // Get all descendants
  const allDescendants = packedTree.descendants() as unknown as ProcessedDataItem[];

  // Prioritize highlighted items - always include them
  const highlightedItems = allDescendants.filter(
    (d) => highlightedPathsSet.has(d.data.path) || ancestorPaths.has(d.data.path),
  );
  const nonHighlightedItems = allDescendants.filter(
    (d) => !highlightedPathsSet.has(d.data.path) && !ancestorPaths.has(d.data.path),
  );

  // Combine: highlighted first, then fill with non-highlighted up to MAX_CHILDREN
  const remainingSlots = MAX_CHILDREN - highlightedItems.length;
  const children = [
    ...highlightedItems,
    ...nonHighlightedItems.slice(0, Math.max(0, remainingSlots)),
  ];

  // Update caches
  Object.keys(cachedOrders).forEach((key) => delete cachedOrders[key]);
  Object.keys(cachedPositions).forEach((key) => delete cachedPositions[key]);

  const saveCachedPositionForItem = (item: any) => {
    cachedOrders[item.data.path] = item.data.sortOrder;
    if (item.children) {
      item.children.forEach(saveCachedPositionForItem);
    }
  };
  saveCachedPositionForItem(packedTree);

  children.forEach((d) => {
    cachedPositions[d.data.path] = [d.x, d.y];
  });

  // Get unique file types for legend
  const fileTypes = [
    ...new Set(
      children
        .map((d) => d.data.extension)
        .filter((ext): ext is string => !!ext && !!fileColors[ext]),
    ),
  ].sort();

  return { packedData: children, fileTypes, colorScale, colorExtent };
}
