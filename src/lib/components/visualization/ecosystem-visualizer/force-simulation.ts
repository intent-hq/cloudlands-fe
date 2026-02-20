/**
 * Force simulation for organic layout
 * Uses d3.pack for deterministic circle packing without overlaps
 */

import {
  pack,
  hierarchy,
  type HierarchyCircularNode,
  forceSimulation,
  forceCollide,
  forceX,
  forceY,
  forceManyBody,
} from 'd3';
import type { ProcessedNode, SimulationResult } from './types';
import { DEFAULT_ECOSYSTEM_SETTINGS } from './types';

// Fixed spacing buffer for pack layout (in pack coordinate space)
// Using a fixed value prevents feedback loops when dimensions change
const FIXED_SPACING_BUFFER = 1; // Minimal spacing - let collision padding handle spacing

export interface SimulationConfig {
  width: number;
  height: number;
  collisionPadding?: number;
  folderPadding?: number;
  blobPadding?: number;
}

interface PackNode {
  id: string;
  r: number; // Visual radius
  packRadius: number; // Radius used for packing (includes spacing buffer)
  children?: PackNode[];
  originalNode: ProcessedNode | null;
}

type PackedNode = HierarchyCircularNode<PackNode>;

/**
 * Build a hierarchy structure for d3.pack from ProcessedNodes
 * Files get inflated radius for spacing, folders get inflated for hull padding
 * @param spacingBuffer - Spacing buffer to add to file radii (in pack coordinate space)
 * @param hullExpansion - Additional radius to add to folders to account for hull padding
 */
function buildPackHierarchy(
  nodes: ProcessedNode[],
  blobPadding: number,
  minFileRadius: number,
  collisionPadding: number,
  spacingBuffer: number,
  hullExpansion: number,
): PackNode {
  const topLevel = nodes.filter((n) => !n.parent);

  function buildNode(node: ProcessedNode, depth: number): PackNode {
    if (node.isFolder && node.children && node.children.length > 0) {
      // Folders need extra radius to account for hull expansion around their children
      // The hull expands outward by blobPadding, so we need to reserve that space
      // Deeper folders get MUCH less expansion - aggressive decay with depth
      const depthFactor = Math.max(0.15, 1 - (depth - 1) * 0.25);
      const folderHullExpansion = hullExpansion * depthFactor;
      // Also reduce blobPadding for deeper folders
      const adjustedBlobPadding = blobPadding * depthFactor;
      return {
        id: node.id,
        r: node.r + adjustedBlobPadding,
        packRadius: node.r + adjustedBlobPadding + folderHullExpansion,
        children: node.children.map((child) => buildNode(child, depth + 1)),
        originalNode: node,
      };
    }
    // For files, add spacing to prevent overlap when zoomed in
    const visualRadius = Math.max(node.r, minFileRadius);
    return {
      id: node.id,
      r: visualRadius,
      // Pack with extra radius proportional to file size to prevent overlap
      // Larger files need more spacing, smaller files can be tighter
      packRadius: visualRadius * 1.4 + spacingBuffer + collisionPadding * 0.5,
      originalNode: node,
    };
  }

  // Create a virtual root that contains all top-level items
  return {
    id: '__root__',
    r: 0,
    packRadius: 0,
    children: topLevel.map((n) => buildNode(n, 1)),
    originalNode: null,
  };
}

/**
 * Apply packed positions back to ProcessedNodes with separate x/y scaling
 * This allows the layout to stretch horizontally for landscape viewports
 */
function applyPackedPositionsScaledXY(
  packedRoot: PackedNode,
  viewCenterX: number,
  viewCenterY: number,
  contentCenterX: number,
  contentCenterY: number,
  scaleX: number,
  scaleY: number,
) {
  // Use the minimum scale for radius to keep circles circular
  const radiusScale = Math.min(scaleX, scaleY);

  function applyPositions(packedNode: PackedNode) {
    const original = packedNode.data.originalNode;
    if (original && packedNode.data.id !== '__root__') {
      // Transform with separate x/y scaling
      const scaledX = (packedNode.x - contentCenterX) * scaleX + viewCenterX;
      const scaledY = (packedNode.y - contentCenterY) * scaleY + viewCenterY;
      original.x = scaledX;
      original.y = scaledY;
      // Store original pack position for hull constraints
      // d3.pack guarantees non-overlap at these positions, so hulls should be constrained here
      if (original.isFolder) {
        original.packX = scaledX;
        original.packY = scaledY;
      }
      // Scale radius uniformly to keep circles circular
      if (original.isFolder) {
        original.r = packedNode.r * radiusScale;
      } else {
        // For files, use the visual radius directly - pack layout handles spacing
        const visualRadius = packedNode.data.r;
        original.r = visualRadius * radiusScale;
      }
    }
    if (packedNode.children) {
      packedNode.children.forEach(applyPositions);
    }
  }

  applyPositions(packedRoot);
}

/**
 * Update folder positions to be at the centroid of their children
 * Also compute effectiveRadius for folder hit detection
 *
 * @param blobPadding - The base hull padding from settings (used to compute accurate hull extent)
 */
function updateFolderCentroids(nodes: ProcessedNode[], blobPadding: number = 8) {
  const folders = nodes.filter((n) => n.isFolder).sort((a, b) => (b.depth || 0) - (a.depth || 0));

  for (const folder of folders) {
    if (folder.children && folder.children.length > 0) {
      let sumX = 0;
      let sumY = 0;
      for (const child of folder.children) {
        sumX += child.x;
        sumY += child.y;
      }
      folder.x = sumX / folder.children.length;
      folder.y = sumY / folder.children.length;

      // Compute effective radius that matches the visual hull extent
      // The hull adds padding around each child: effectivePadding = blobPadding * depthFactor
      // depthFactor = max(0.4, 1 - (depth-1) * 0.15) per blob-shapes.ts
      const depthFactor = Math.max(0.4, 1 - ((folder.depth || 1) - 1) * 0.15);
      const hullPadding = blobPadding * depthFactor;

      let maxDist = 0;
      for (const child of folder.children) {
        const dx = child.x - folder.x;
        const dy = child.y - folder.y;
        // Include hull padding to match visual extent
        const childRadius = (child.effectiveRadius || child.r) + hullPadding;
        const dist = Math.sqrt(dx * dx + dy * dy) + childRadius;
        maxDist = Math.max(maxDist, dist);
      }
      folder.effectiveRadius = maxDist;
    }
  }
}

/**
 * Helper to calculate bounds of a packed layout
 */
function calculatePackedBounds(packedRoot: PackedNode): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  contentWidth: number;
  contentHeight: number;
  contentCenterX: number;
  contentCenterY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const collectBounds = (node: PackedNode) => {
    const r = node.r || 0;
    minX = Math.min(minX, node.x - r);
    minY = Math.min(minY, node.y - r);
    maxX = Math.max(maxX, node.x + r);
    maxY = Math.max(maxY, node.y + r);
    if (node.children) {
      for (const child of node.children) {
        collectBounds(child);
      }
    }
  };
  collectBounds(packedRoot);

  return {
    minX,
    minY,
    maxX,
    maxY,
    contentWidth: maxX - minX,
    contentHeight: maxY - minY,
    contentCenterX: (minX + maxX) / 2,
    contentCenterY: (minY + maxY) / 2,
  };
}

/**
 * Create and run circle packing on nodes
 * Uses a TWO-PASS approach to ensure proper spacing after scaling:
 * 1. First pass: Pack with minimal spacing to determine scale factor
 * 2. Calculate required spacing buffer based on desired pixel spacing and scale
 * 3. Second pass: Repack with calculated spacing buffer
 */
export function runForceSimulation(
  nodes: ProcessedNode[],
  config: SimulationConfig,
  onTick?: (nodes: ProcessedNode[]) => void,
): Promise<SimulationResult> {
  const {
    width,
    height,
    folderPadding = DEFAULT_ECOSYSTEM_SETTINGS.folderPadding,
    blobPadding = DEFAULT_ECOSYSTEM_SETTINGS.blobPadding,
    collisionPadding = DEFAULT_ECOSYSTEM_SETTINGS.collisionPadding,
  } = config;
  const minFileRadius = DEFAULT_ECOSYSTEM_SETTINGS.minFileRadius;

  const centerX = width / 2;
  const centerY = height / 2;

  // Calculate pack size - use a reference size that we'll scale to fit viewport later
  const packSize = 1000;

  // View padding for hull expansion
  const viewPadding = blobPadding + 20;
  const availWidth = Math.max(width - viewPadding * 2, 100);
  const availHeight = Math.max(height - viewPadding * 2, 100);

  // Hull expansion: how much extra space folders need for their hull padding
  // This accounts for the blob padding that will be added around folder contents
  // Keep it minimal - hulls will expand around children naturally
  const hullExpansion = blobPadding * 0.5; // Reduced to prevent overlap between folder hulls

  /**
   * Run d3.pack with given spacing buffer
   */
  const runPack = (spacingBuffer: number) => {
    const packHierarchy = buildPackHierarchy(
      nodes,
      blobPadding,
      minFileRadius,
      collisionPadding,
      spacingBuffer,
      hullExpansion,
    );

    const root = hierarchy(packHierarchy)
      .sum((d) => {
        if (!d.children || d.children.length === 0) {
          return d.packRadius * d.packRadius;
        }
        return 0;
      })
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const packLayout = pack<PackNode>()
      .size([packSize, packSize])
      .radius((d) => d.data.packRadius)
      .padding((d) => {
        if (d.children && d.children.length > 0) {
          // Aggressive padding decay with depth - deeper = tighter packing
          const depthFactor = Math.max(0.1, 1 - d.depth * 0.3);
          return (folderPadding * 0.3 + blobPadding * 0.5) * depthFactor;
        }
        // Minimal file padding - let files be close together
        return collisionPadding * 0.2;
      });

    return packLayout(root);
  };

  return new Promise((resolve) => {
    // Single pass pack with fixed spacing (constant defined at top of file)
    const packedRoot = runPack(FIXED_SPACING_BUFFER);
    const bounds = calculatePackedBounds(packedRoot);

    // Calculate aspect ratio for layout decisions
    const aspectRatio = width / height;

    // Use UNIFORM scaling initially - the force simulation will spread folders to fill the viewport
    // This follows the user's guidance: "construct the layout normally and then run a force simulation
    // for a bit to relax it into the correct dimensions"
    const uniformScale = Math.min(
      availWidth / bounds.contentWidth,
      availHeight / bounds.contentHeight,
    );
    const scaleX = uniformScale;
    const scaleY = uniformScale;

    // Apply positions with uniform scaling
    applyPackedPositionsScaledXY(
      packedRoot,
      centerX,
      centerY,
      bounds.contentCenterX,
      bounds.contentCenterY,
      scaleX,
      scaleY,
    );

    // Get top-level folders AND root-level files
    // Root-level files need to be included in spreading to avoid orphan elements
    const topLevelFolders = nodes.filter((n) => !n.parent && n.isFolder);
    const topLevelFiles = nodes.filter((n) => !n.parent && !n.isFolder);

    // Group root-level files together as a virtual cluster if there are any
    // This prevents them from appearing as orphan elements
    const topLevelNodes = topLevelFolders;

    // Collect folders at different depths for spreading
    const collectFoldersAtDepth = (
      startNodes: ProcessedNode[],
      targetDepth: number,
    ): ProcessedNode[] => {
      const result: ProcessedNode[] = [];
      const traverse = (node: ProcessedNode, currentDepth: number) => {
        if (currentDepth === targetDepth && node.isFolder) {
          result.push(node);
        } else if (currentDepth < targetDepth && node.children) {
          node.children.forEach((child) => traverse(child, currentDepth + 1));
        }
      };
      startNodes.forEach((n) => traverse(n, 0));
      return result;
    };

    // Determine how many folders we need to spread based on aspect ratio
    // For very wide viewports, we need more spread targets
    const minSpreadTargets = Math.max(3, Math.ceil(aspectRatio * 2));

    // If only one top-level folder, spread its children instead
    let nodesToSpread: ProcessedNode[] = topLevelNodes;
    let rootFilesToPosition: ProcessedNode[] = [];

    if (topLevelNodes.length === 1 && topLevelNodes[0].children) {
      // Start with depth-1 folders
      const depth1Folders = topLevelNodes[0].children.filter((n) => n.isFolder);
      // Also collect root-level files (children of the single top-level folder that are files)
      rootFilesToPosition = topLevelNodes[0].children.filter((n) => !n.isFolder);

      nodesToSpread = depth1Folders;

      // If not enough folders at depth 1, collect from depth 2
      if (nodesToSpread.length < minSpreadTargets) {
        const depth2Folders = collectFoldersAtDepth(topLevelNodes, 2);
        if (depth2Folders.length >= minSpreadTargets) {
          nodesToSpread = depth2Folders;
        } else if (depth2Folders.length > nodesToSpread.length) {
          // Use depth 2 if it has more folders than depth 1
          nodesToSpread = depth2Folders;
        }
      }
    } else if (topLevelNodes.length < minSpreadTargets) {
      // Even with multiple top-level folders, if not enough, try depth 1
      const depth1Folders = collectFoldersAtDepth(topLevelNodes, 1);
      if (depth1Folders.length >= minSpreadTargets) {
        nodesToSpread = depth1Folders;
      }
    }

    // Also collect any true root-level files (files with no parent)
    if (topLevelFiles.length > 0) {
      rootFilesToPosition = [...rootFilesToPosition, ...topLevelFiles];
    }

    // CRITICAL: Compute effectiveRadius for all folders BEFORE running the force simulation
    // This ensures collision detection uses the correct visual radius of each folder
    // Pass blobPadding so effectiveRadius includes hull padding for accurate collision
    updateFolderCentroids(nodes, blobPadding);

    // Spread folders using force simulation to fill the viewport naturally
    // Following user guidance: "construct the layout normally and then run a force simulation
    // for a bit to relax it into the correct dimensions"
    if (nodesToSpread.length > 1) {
      // Store original positions for all nodes
      const originalPositions = new Map<string, { x: number; y: number }>();
      nodes.forEach((n) => {
        originalPositions.set(n.id, { x: n.x, y: n.y });
      });

      // Determine the layout strategy based on aspect ratio and node count
      const viewportAspect = availWidth / availHeight;
      const nodeCount = nodesToSpread.length;

      // Calculate optimal grid dimensions
      // Use a dampened aspect ratio to avoid too many columns in wide viewports
      // sqrt(aspect) provides a gentler scaling that better fills the space
      const dampenedAspect = Math.sqrt(viewportAspect);
      let cols: number, rows: number;
      if (viewportAspect >= 1) {
        // Landscape or square - use dampened aspect to avoid too many columns
        cols = Math.ceil(Math.sqrt(nodeCount * dampenedAspect));
        rows = Math.ceil(nodeCount / cols);
        // Ensure we have at least 2 rows for better vertical distribution
        if (rows < 2 && nodeCount >= 4) {
          rows = 2;
          cols = Math.ceil(nodeCount / rows);
        }
      } else {
        // Portrait - use dampened aspect for rows
        rows = Math.ceil(Math.sqrt(nodeCount / dampenedAspect));
        cols = Math.ceil(nodeCount / rows);
        // Ensure we have at least 2 columns for better horizontal distribution
        if (cols < 2 && nodeCount >= 4) {
          cols = 2;
          rows = Math.ceil(nodeCount / cols);
        }
      }

      // Use most of the viewport (90%) as starting positions
      // Collision force will push things apart to avoid overlap
      const gridSpan = 0.9;
      const gridWidth = availWidth * gridSpan;
      const gridHeight = availHeight * gridSpan;
      const gridOffsetX = (availWidth - gridWidth) / 2;
      const gridOffsetY = (availHeight - gridHeight) / 2;

      // Calculate cell dimensions within the reduced grid area
      const cellWidth = gridWidth / cols;
      const cellHeight = gridHeight / rows;

      // Assign target positions based on a grid layout
      // Sort nodes by size (largest first) to give bigger folders better positions
      const targetPositions = new Map<string, { x: number; y: number }>();

      // Sort by effective radius (size) descending, then by name for stability
      const sortedNodes = [...nodesToSpread].sort((a, b) => {
        const aSize = a.effectiveRadius || a.r;
        const bSize = b.effectiveRadius || b.r;
        if (Math.abs(aSize - bSize) > 1) return bSize - aSize; // Larger first
        return a.name.localeCompare(b.name); // Alphabetical for stability
      });

      // Assign grid positions using a boustrophedon (snake) pattern
      // This creates a more natural flow and better space utilization
      sortedNodes.forEach((node, idx) => {
        const row = Math.floor(idx / cols);
        const colInRow = idx % cols;
        // Alternate direction each row for snake pattern
        const col = row % 2 === 0 ? colInRow : cols - 1 - colInRow;

        // Calculate target position at cell center within the reduced grid
        const targetX = viewPadding + gridOffsetX + cellWidth * (col + 0.5);
        const targetY = viewPadding + gridOffsetY + cellHeight * (row + 0.5);

        targetPositions.set(node.id, { x: targetX, y: targetY });
      });

      // IMPORTANT: Initialize nodes at their target positions BEFORE running simulation
      // This ensures nodes start spread out, then collision force resolves any overlaps
      nodesToSpread.forEach((node) => {
        const target = targetPositions.get(node.id);
        if (target) {
          node.x = target.x;
          node.y = target.y;
        }
      });

      // Single-phase force simulation with collision + strong center pull
      // effectiveRadius now includes hull padding (computed in updateFolderCentroids)
      // Minimal gap - let folders touch for a cohesive blob
      const visualGap = 2;

      const getRadius = (d: ProcessedNode) => {
        const radius = d.effectiveRadius || d.r;
        return radius + visualGap;
      };

      const simulation = forceSimulation(nodesToSpread)
        .force('collide', forceCollide<ProcessedNode>(getRadius).strength(1.0).iterations(15))
        .force('centerX', forceX<ProcessedNode>(centerX).strength(0.3)) // Strong center pull
        .force('centerY', forceY<ProcessedNode>(centerY).strength(0.3))
        .velocityDecay(0.4) // Higher decay for stability
        .alphaDecay(0.005) // Even slower decay = more time to settle into tight cluster
        .stop();

      // Run many iterations - let it fully converge
      for (let i = 0; i < 1000; i++) {
        simulation.tick();
      }

      // Clamp positions to viewport bounds
      nodesToSpread.forEach((folder) => {
        const r = folder.effectiveRadius || folder.r;
        folder.x = Math.max(viewPadding + r, Math.min(width - viewPadding - r, folder.x));
        folder.y = Math.max(viewPadding + r, Math.min(height - viewPadding - r, folder.y));
      });

      // Move children relative to their parent folder's movement (translation only, no scaling)
      // This preserves the internal structure of each folder
      nodesToSpread.forEach((folder) => {
        const orig = originalPositions.get(folder.id);
        if (!orig) return;

        const dx = folder.x - orig.x;
        const dy = folder.y - orig.y;

        // Recursively move all descendants by the same delta
        const moveDescendants = (node: ProcessedNode) => {
          node.children?.forEach((child) => {
            child.x += dx;
            child.y += dy;
            if (child.isFolder) {
              moveDescendants(child);
            }
          });
        };
        moveDescendants(folder);
      });
    }

    // Position root-level files using force simulation to cluster them organically
    // They should nestle into gaps between folders rather than being in a rigid grid
    if (rootFilesToPosition.length > 0 && nodesToSpread.length > 0) {
      // Find the centroid of all folders to position files nearby
      let sumX = 0;
      let sumY = 0;
      nodesToSpread.forEach((folder) => {
        sumX += folder.x;
        sumY += folder.y;
      });
      const folderCentroidX = sumX / nodesToSpread.length;
      const folderCentroidY = sumY / nodesToSpread.length;

      // Initialize root files near the folder centroid (slightly offset)
      rootFilesToPosition.forEach((file, idx) => {
        // Spiral pattern around centroid for initial positions
        const angle = (idx / rootFilesToPosition.length) * Math.PI * 2;
        const radius = 50 + idx * 10;
        file.x = folderCentroidX + Math.cos(angle) * radius;
        file.y = folderCentroidY + Math.sin(angle) * radius;
      });

      // Run a mini force simulation to position root files organically
      // They should avoid folders and cluster together
      const fileSimulation = forceSimulation(rootFilesToPosition)
        .force(
          'collide',
          forceCollide<ProcessedNode>((d) => d.r + 3)
            .strength(1.0)
            .iterations(5),
        )
        // Avoid folders - use radius with extra padding
        .force(
          'avoidFolders',
          forceCollide<ProcessedNode>()
            .radius((d) => d.r + 5)
            .strength(0.8),
        )
        // Pull toward folder centroid to stay near the main content
        .force('x', forceX<ProcessedNode>(folderCentroidX).strength(0.15))
        .force('y', forceY<ProcessedNode>(folderCentroidY).strength(0.15))
        // Files attract each other slightly to cluster
        .force(
          'charge',
          forceManyBody<ProcessedNode>()
            .strength(5) // Positive = attraction between files
            .distanceMax(100),
        )
        .stop();

      // Run simulation
      for (let i = 0; i < 150; i++) {
        fileSimulation.tick();

        // Push files away from folders manually each tick
        rootFilesToPosition.forEach((file) => {
          nodesToSpread.forEach((folder) => {
            const dx = file.x - folder.x;
            const dy = file.y - folder.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minDist = (folder.effectiveRadius || folder.r) + file.r + 10;
            if (dist < minDist && dist > 0) {
              const pushFactor = ((minDist - dist) / dist) * 0.5;
              file.x += dx * pushFactor;
              file.y += dy * pushFactor;
            }
          });
        });
      }

      // Clamp files to viewport
      rootFilesToPosition.forEach((file) => {
        file.x = Math.max(viewPadding + file.r, Math.min(width - viewPadding - file.r, file.x));
        file.y = Math.max(viewPadding + file.r, Math.min(height - viewPadding - file.r, file.y));
      });
    }

    // Update folder centroids with blobPadding for accurate hull extent
    updateFolderCentroids(nodes, blobPadding);

    // === FINAL CENTERING (no scaling) ===
    // The force simulation has already spread content to fill the viewport
    // We only need to center the content, not scale it
    const finalBounds = calculateActualBounds(nodes);

    if (finalBounds.width > 0 && finalBounds.height > 0) {
      // Content center
      const contentCenterX = finalBounds.minX + finalBounds.width / 2;
      const contentCenterY = finalBounds.minY + finalBounds.height / 2;

      // Check if we need to re-center
      const needsCentering =
        Math.abs(contentCenterX - centerX) > 5 || Math.abs(contentCenterY - centerY) > 5;

      if (needsCentering) {
        const dx = centerX - contentCenterX;
        const dy = centerY - contentCenterY;
        nodes.forEach((node) => {
          node.x += dx;
          node.y += dy;
        });

        // Update folder centroids after centering with blobPadding
        updateFolderCentroids(nodes, blobPadding);
      }
    }

    // Trigger final tick callback
    onTick?.(nodes);

    // Return nodes with scale ratio (1 since we use uniform scaling)
    resolve({ nodes, scaleRatio: 1 });
  });
}

/**
 * Calculate the actual bounding box of all positioned nodes
 * Considers both top-level folders (using effectiveRadius) and leaf nodes
 * to capture the full visual extent after force simulation spreading
 */
function calculateActualBounds(nodes: ProcessedNode[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Include top-level folders (depth 1) with their effectiveRadius
  // These are the nodes that get spread by the force simulation
  const topLevelFolders = nodes.filter((n) => n.isFolder && n.depth === 1);

  topLevelFolders.forEach((node) => {
    const r = node.effectiveRadius || node.r;
    minX = Math.min(minX, node.x - r);
    maxX = Math.max(maxX, node.x + r);
    minY = Math.min(minY, node.y - r);
    maxY = Math.max(maxY, node.y + r);
  });

  // Also include leaf nodes to ensure we capture any files outside folders
  const leafNodes = nodes.filter((n) => !n.isFolder);

  leafNodes.forEach((node) => {
    const r = node.r;
    minX = Math.min(minX, node.x - r);
    maxX = Math.max(maxX, node.x + r);
    minY = Math.min(minY, node.y - r);
    maxY = Math.max(maxY, node.y + r);
  });

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
