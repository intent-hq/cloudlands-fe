/**
 * Blob shape generation for folder outlines
 * Creates organic, smooth amoeba-like shapes around groups of nodes
 * Uses Voronoi-based clipping to prevent sibling folder overlap
 */

import { polygonHull, line, curveCardinalClosed, Delaunay } from 'd3';
import type { ProcessedNode, BlobShape } from './types';
import { DEFAULT_ECOSYSTEM_SETTINGS } from './types';

// Default values (used when no settings passed)
export const HULL_PADDING = DEFAULT_ECOSYSTEM_SETTINGS.folderPadding;

// Number of noise layers for organic detail
const WOBBLE_OCTAVES = 2;

// Hull boundary margin is no longer used - we rely on the packing algorithm
// to create adequate spacing between folders. The hull is computed naturally
// from children positions without artificial constraints.

/**
 * Simple seeded random for consistent wobble per blob
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

/**
 * Multi-octave simplex-like noise for smooth organic perturbation
 * Creates natural-looking deformations that feel biological
 */
function organicNoise(angle: number, seed: number, octaves: number = WOBBLE_OCTAVES): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  // Use golden ratio-based frequencies for natural looking patterns
  const phi = 1.618033988749;

  for (let i = 0; i < octaves; i++) {
    // Combine multiple sine waves with irrational frequency ratios
    const freq1 = frequency * phi;
    const freq2 = (frequency * Math.PI) / 2;
    const phase = seed * (i + 1) * 0.137;

    value += Math.sin(angle * freq1 + phase) * amplitude * 0.6;
    value += Math.sin(angle * freq2 + phase * 1.3) * amplitude * 0.4;

    maxValue += amplitude;
    amplitude *= 0.55; // Slower falloff for more detail
    frequency *= 1.8;
  }

  return value / maxValue;
}

/**
 * Add organic perturbation to hull points to make them look like amoeba shapes
 * Uses multi-frequency noise for natural-looking undulations
 * IMPORTANT: Only expands outward, never shrinks inward, to ensure files stay inside hull
 */
function perturbHull(
  hull: [number, number][],
  seed: number,
  amplitude: number = DEFAULT_ECOSYSTEM_SETTINGS.wobbleAmplitude,
): [number, number][] {
  if (hull.length < 3) return hull;

  const random = seededRandom(seed);

  // Calculate centroid
  let cx = 0,
    cy = 0;
  hull.forEach(([x, y]) => {
    cx += x;
    cy += y;
  });
  cx /= hull.length;
  cy /= hull.length;

  // Calculate average radius for scale-aware perturbation
  let avgRadius = 0;
  hull.forEach(([x, y]) => {
    avgRadius += Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  });
  avgRadius /= hull.length;

  // Scale amplitude based on blob size (larger blobs get proportionally more wobble)
  // Cap the scaling to prevent excessive wobble on large blobs
  const scaledAmplitude = amplitude * Math.min(1.2, Math.max(0.3, avgRadius / 80));

  // Perturb each point radially with organic noise
  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return [x, y] as [number, number];

    // Use organic noise for natural-looking deformation
    const angle = Math.atan2(dy, dx);
    // Map noise from [-1, 1] to [0, 1] so we only expand outward, never shrink
    const rawNoise = organicNoise(angle, seed, WOBBLE_OCTAVES);
    const noise = (rawNoise * 0.5 + 0.5) * scaledAmplitude;

    // Add very subtle random jitter for micro-detail (also only positive)
    const jitter = random() * scaledAmplitude * 0.1;

    const newDist = dist + noise + jitter;
    const scale = newDist / dist;

    return [cx + dx * scale, cy + dy * scale] as [number, number];
  });
}

/**
 * Subdivide hull to add more points for smoother curves
 * Uses Chaikin's corner-cutting algorithm for smoother results
 */
function subdivideHull(hull: [number, number][], subdivisions: number = 3): [number, number][] {
  if (hull.length < 3) return hull;

  let result = [...hull];
  for (let s = 0; s < subdivisions; s++) {
    const newResult: [number, number][] = [];
    for (let i = 0; i < result.length; i++) {
      const curr = result[i];
      const next = result[(i + 1) % result.length];

      // Chaikin's algorithm: cut corners at 25% and 75%
      // This progressively smooths sharp corners into curves
      newResult.push([curr[0] * 0.75 + next[0] * 0.25, curr[1] * 0.75 + next[1] * 0.25]);
      newResult.push([curr[0] * 0.25 + next[0] * 0.75, curr[1] * 0.25 + next[1] * 0.75]);
    }
    result = newResult;
  }
  return result;
}

/**
 * Apply Gaussian-like smoothing to hull points
 * Averages each point with its neighbors for organic softness
 */
function smoothHull(hull: [number, number][], iterations: number = 2): [number, number][] {
  if (hull.length < 3) return hull;

  let result = [...hull];
  for (let iter = 0; iter < iterations; iter++) {
    const smoothed: [number, number][] = [];
    for (let i = 0; i < result.length; i++) {
      const prev = result[(i - 1 + result.length) % result.length];
      const curr = result[i];
      const next = result[(i + 1) % result.length];

      // Weighted average: 25% prev, 50% current, 25% next
      smoothed.push([
        prev[0] * 0.25 + curr[0] * 0.5 + next[0] * 0.25,
        prev[1] * 0.25 + curr[1] * 0.5 + next[1] * 0.25,
      ]);
    }
    result = smoothed;
  }
  return result;
}

/**
 * Constrain hull points to stay within an elliptical boundary
 * This prevents sibling folder hulls from overlapping by keeping each hull
 * within its folder's allocated pack radius, accounting for non-uniform scaling
 *
 * @param hull - The hull points to constrain
 * @param centerX - Center X of the boundary ellipse
 * @param centerY - Center Y of the boundary ellipse
 * @param maxRadius - The base radius (used for Y axis)
 * @param scaleRatio - The ratio of scaleX/scaleY from the layout (default 1 = circular)
 */
function constrainHullToRadius(
  hull: [number, number][],
  centerX: number,
  centerY: number,
  maxRadius: number,
  scaleRatio: number = 1,
): [number, number][] {
  if (hull.length < 3 || maxRadius <= 0) return hull;

  // For elliptical constraint:
  // - radiusX = maxRadius * scaleRatio (stretched horizontally when scaleRatio > 1)
  // - radiusY = maxRadius
  const radiusX = maxRadius * scaleRatio;
  const radiusY = maxRadius;

  return hull.map(([x, y]) => {
    const dx = x - centerX;
    const dy = y - centerY;

    // Check if point is inside the ellipse: (dx/radiusX)^2 + (dy/radiusY)^2 <= 1
    const normalizedDist = (dx * dx) / (radiusX * radiusX) + (dy * dy) / (radiusY * radiusY);

    if (normalizedDist <= 1) {
      return [x, y] as [number, number];
    }

    // Clamp point to the ellipse boundary
    // Scale the point so it lies on the ellipse
    const scale = 1 / Math.sqrt(normalizedDist);
    return [centerX + dx * scale, centerY + dy * scale] as [number, number];
  });
}

/**
 * Contract a hull inward by moving each point toward the centroid
 * Uses proportional contraction to avoid collapsing small hulls
 */
function contractHull(hull: [number, number][], amount: number): [number, number][] {
  if (hull.length < 3 || amount <= 0) return hull;

  // Calculate centroid
  let cx = 0,
    cy = 0;
  for (const [x, y] of hull) {
    cx += x;
    cy += y;
  }
  cx /= hull.length;
  cy /= hull.length;

  // Find minimum distance to centroid to limit contraction
  let minDist = Infinity;
  for (const [x, y] of hull) {
    const dx = x - cx;
    const dy = y - cy;
    minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy));
  }

  // Limit contraction to max 20% of the smallest radius
  const maxContraction = minDist * 0.2;
  const actualAmount = Math.min(amount, maxContraction);

  if (actualAmount <= 0) return hull;

  // Move each point toward the centroid
  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= actualAmount) return [cx, cy] as [number, number];
    const scale = (dist - actualAmount) / dist;
    return [cx + dx * scale, cy + dy * scale] as [number, number];
  });
}

/**
 * Check if a folder is a "leaf folder" (contains only files, no subfolders)
 */
function isLeafFolder(folder: ProcessedNode): boolean {
  if (!folder.children) return false;
  return folder.children.every((child) => !child.isFolder);
}

/**
 * Sutherland-Hodgman polygon clipping algorithm
 * Clips a subject polygon against a convex clip polygon
 */
function clipPolygon(subject: [number, number][], clip: [number, number][]): [number, number][] {
  if (subject.length < 3 || clip.length < 3) return subject;

  let output = [...subject];

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];

    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];

    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const next = input[(j + 1) % input.length];

      const currentInside = isLeftOfEdge(current, edgeStart, edgeEnd);
      const nextInside = isLeftOfEdge(next, edgeStart, edgeEnd);

      if (currentInside) {
        output.push(current);
        if (!nextInside) {
          const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
          if (intersection) output.push(intersection);
        }
      } else if (nextInside) {
        const intersection = lineIntersection(current, next, edgeStart, edgeEnd);
        if (intersection) output.push(intersection);
      }
    }
  }

  return output;
}

/**
 * Check if a point is on the left side of an edge (inside for CCW polygon)
 */
function isLeftOfEdge(
  point: [number, number],
  edgeStart: [number, number],
  edgeEnd: [number, number],
): boolean {
  return (
    (edgeEnd[0] - edgeStart[0]) * (point[1] - edgeStart[1]) -
      (edgeEnd[1] - edgeStart[1]) * (point[0] - edgeStart[0]) >=
    0
  );
}

/**
 * Find intersection point of two line segments
 */
function lineIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): [number, number] | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;

  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;

  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/**
 * Compute the centroid of a polygon
 */
function polygonCentroid(points: [number, number][]): [number, number] {
  let cx = 0,
    cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  return [cx / points.length, cy / points.length];
}

/**
 * Compute Voronoi cells for sibling folders and return a map of path -> cell polygon
 * The cells are bounded to a reasonable area around the siblings
 */
function computeVoronoiCells(
  siblings: { path: string; centroid: [number, number]; hull: [number, number][] }[],
  boundsPadding: number = 100,
): Map<string, [number, number][]> {
  const cells = new Map<string, [number, number][]>();

  if (siblings.length <= 1) {
    // Single sibling - no clipping needed, return null to skip clipping
    return cells;
  }

  // Compute bounding box of all siblings
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  for (const sibling of siblings) {
    for (const [x, y] of sibling.hull) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  // Add padding to bounds
  minX -= boundsPadding;
  maxX += boundsPadding;
  minY -= boundsPadding;
  maxY += boundsPadding;

  // Create Delaunay triangulation from centroids
  const points = siblings.map((s) => s.centroid);
  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([minX, minY, maxX, maxY]);

  // Extract cell polygons
  for (let i = 0; i < siblings.length; i++) {
    const cellPolygon = voronoi.cellPolygon(i);
    if (cellPolygon && cellPolygon.length >= 3) {
      // cellPolygon is closed (first point repeated), remove the duplicate
      const cell = cellPolygon.slice(0, -1) as [number, number][];
      cells.set(siblings[i].path, cell);
    }
  }

  return cells;
}

export interface BlobShapeOptions {
  basePadding?: number;
  minDepth?: number;
  onlyLeafFolders?: boolean;
  depthPaddingFactor?: number;
  minDepthPaddingFactor?: number;
  wobbleAmplitude?: number;
  hullSubdivisions?: number;
  hullSmoothing?: number;
  /** Scale ratio (scaleX/scaleY) for elliptical hull constraints in landscape viewports */
  scaleRatio?: number;
  /** Current zoom scale - used to adjust padding (less padding when zoomed in) */
  zoomScale?: number;
  /** Depth of the focused folder (0 = root) - used for relative depth calculations */
  focusDepth?: number;
}

export function computeBlobShapes(
  nodes: ProcessedNode[],
  options: BlobShapeOptions = {},
): BlobShape[] {
  const {
    basePadding = DEFAULT_ECOSYSTEM_SETTINGS.blobPadding,
    minDepth = 1,
    onlyLeafFolders = false,
    depthPaddingFactor = DEFAULT_ECOSYSTEM_SETTINGS.depthPaddingFactor,
    minDepthPaddingFactor = DEFAULT_ECOSYSTEM_SETTINGS.minDepthPaddingFactor,
    wobbleAmplitude = DEFAULT_ECOSYSTEM_SETTINGS.wobbleAmplitude,
    hullSubdivisions = DEFAULT_ECOSYSTEM_SETTINGS.hullSubdivisions,
    hullSmoothing = DEFAULT_ECOSYSTEM_SETTINGS.hullSmoothing,
    scaleRatio = 1, // Default to circular (no stretch)
    zoomScale = 1, // Current zoom level
    focusDepth = 0, // Depth of the focused folder
  } = options;

  // Zoom-adjusted base padding: less padding when zoomed in
  // At scale 1: full padding, at scale 4+: 50% padding
  const zoomPaddingFactor = Math.max(0.5, 1 - (zoomScale - 1) * 0.15);
  const zoomAdjustedBasePadding = basePadding * zoomPaddingFactor;

  // Filter folders based on options
  let folders = nodes.filter(
    (n) => n.isFolder && n.children && n.children.length > 0 && n.depth >= minDepth,
  );

  // Optionally filter to only leaf folders (no overlap possible)
  if (onlyLeafFolders) {
    folders = folders.filter(isLeafFolder);
  }

  // Performance: limit max blobs to render (prioritize shallower folders)
  const MAX_BLOBS = 500;
  if (folders.length > MAX_BLOBS) {
    folders = folders.sort((a, b) => a.depth - b.depth).slice(0, MAX_BLOBS);
  }

  // Sort folders by depth (deepest first) so we can build hulls bottom-up
  // This allows parent folders to use child folder hulls
  const sortedFolders = [...folders].sort((a, b) => b.depth - a.depth);

  // Store computed hulls for each folder (used by parent folders)
  const folderHulls = new Map<string, [number, number][]>();

  // Pre-compute direct files for each folder
  type FilePoint = { point: [number, number]; radius: number };
  const directFilesMap = new Map<string, FilePoint[]>();

  for (const folder of folders) {
    const directFiles: FilePoint[] = [];
    if (folder.children) {
      for (const child of folder.children) {
        if (!child.isFolder) {
          directFiles.push({ point: [child.x, child.y], radius: child.r });
        }
      }
    }
    directFilesMap.set(folder.path, directFiles);
  }

  const blobs: BlobShape[] = [];

  // Store raw hulls before Voronoi clipping (for parent folder computation)
  const rawHulls = new Map<string, [number, number][]>();

  // First pass: compute raw hulls for all folders (deepest first)
  for (const folder of sortedFolders) {
    const isLeaf = isLeafFolder(folder);

    // Calculate effective depth relative to focus (if focused)
    // This makes hulls at the focused level act like they're at depth 1
    const effectiveDepth =
      focusDepth > 0 ? Math.max(1, folder.depth - focusDepth + 1) : folder.depth;

    // Depth-dependent padding: shallower folders get more padding, deeper get less
    const depthFactor = Math.max(
      minDepthPaddingFactor,
      1 - (effectiveDepth - 1) * depthPaddingFactor,
    );
    const effectivePadding = zoomAdjustedBasePadding * depthFactor;

    // Collect points for hull calculation
    const expandedPoints: [number, number][] = [];
    const numPointsPerCircle = 8;

    // Always include direct files with padding
    const directFiles = directFilesMap.get(folder.path) || [];
    const filePadding = effectivePadding;
    for (const { point, radius } of directFiles) {
      for (let i = 0; i < numPointsPerCircle; i++) {
        const angle = (i / numPointsPerCircle) * Math.PI * 2;
        expandedPoints.push([
          point[0] + Math.cos(angle) * (radius + filePadding),
          point[1] + Math.sin(angle) * (radius + filePadding),
        ]);
      }
    }

    // For non-leaf folders, include child folder hulls (hull-of-hulls approach)
    if (!isLeaf && folder.children) {
      for (const child of folder.children) {
        if (child.isFolder) {
          const childHull = folderHulls.get(child.path);
          if (childHull && childHull.length > 0) {
            // Add points from child hull with padding for visual separation
            const separationPadding = effectivePadding * 0.5;
            for (const [x, y] of childHull) {
              const dx = x - child.x;
              const dy = y - child.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist > 0) {
                const scale = (dist + separationPadding) / dist;
                expandedPoints.push([child.x + dx * scale, child.y + dy * scale]);
              } else {
                expandedPoints.push([x, y]);
              }
            }
          } else {
            // Fallback: if child hull not computed, use child's effective radius
            const childRadius = child.effectiveRadius || child.r || 20;
            const fallbackPadding = effectivePadding * 2;
            for (let i = 0; i < numPointsPerCircle; i++) {
              const angle = (i / numPointsPerCircle) * Math.PI * 2;
              expandedPoints.push([
                child.x + Math.cos(angle) * (childRadius + fallbackPadding),
                child.y + Math.sin(angle) * (childRadius + fallbackPadding),
              ]);
            }
          }
        }
      }
    }

    if (expandedPoints.length < 3) {
      continue;
    }

    // Compute convex hull around the expanded points
    const hull = polygonHull(expandedPoints);
    if (!hull) {
      continue;
    }

    // Store raw hull for parent folder computation
    rawHulls.set(folder.path, [...hull]);
    // Also store in folderHulls for child->parent hull building
    folderHulls.set(folder.path, [...hull]);
  }

  // Group folders by parent path for Voronoi clipping
  const foldersByParent = new Map<string, ProcessedNode[]>();
  for (const folder of sortedFolders) {
    const parentPath = folder.parent?.path || '';
    if (!foldersByParent.has(parentPath)) {
      foldersByParent.set(parentPath, []);
    }
    foldersByParent.get(parentPath)!.push(folder);
  }

  // Compute Voronoi cells for each sibling group
  const voronoiCells = new Map<string, [number, number][]>();
  for (const [_parentPath, siblings] of foldersByParent) {
    if (siblings.length <= 1) continue; // No clipping needed for single child

    // Build sibling data for Voronoi computation
    const siblingData = siblings
      .map((folder) => {
        const hull = rawHulls.get(folder.path);
        if (!hull || hull.length < 3) return null;
        return {
          path: folder.path,
          centroid: polygonCentroid(hull),
          hull,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (siblingData.length <= 1) continue;

    // Compute Voronoi cells
    const cells = computeVoronoiCells(siblingData);
    for (const [path, cell] of cells) {
      voronoiCells.set(path, cell);
    }
  }

  // Second pass: apply Voronoi clipping, perturbation, and smoothing
  for (const folder of sortedFolders) {
    let hull = rawHulls.get(folder.path);
    if (!hull || hull.length < 3) continue;

    const directFiles = directFilesMap.get(folder.path) || [];

    // DISABLED: Voronoi clipping was causing hulls to not contain their children
    // TODO: Fix Voronoi clipping to only clip where siblings actually overlap
    // const voronoiCell = voronoiCells.get(folder.path);
    // if (voronoiCell && voronoiCell.length >= 3) {
    //   const clipped = clipPolygon(hull, voronoiCell);
    //   if (clipped.length >= 3) {
    //     hull = clipped;
    //   }
    // }

    // For performance: reduce complexity for deep or small blobs
    const isSimpleBlob = folder.depth >= 4 || hull.length <= 24;
    const effectiveSubdivisions = isSimpleBlob ? Math.min(1, hullSubdivisions) : hullSubdivisions;
    const effectiveSmoothing = isSimpleBlob ? Math.min(1, hullSmoothing) : hullSmoothing;

    // Add organic perturbation based on folder path hash BEFORE subdivision
    // This creates larger-scale organic deformations (skip for deep blobs)
    if (wobbleAmplitude > 0 && !isSimpleBlob) {
      const seed = folder.path.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      hull = perturbHull(hull, seed, wobbleAmplitude);
    }

    // Subdivide for smoother curves (configurable iterations)
    hull = subdivideHull(hull, effectiveSubdivisions);

    // Apply additional smoothing for more organic shapes
    hull = smoothHull(hull, effectiveSmoothing);

    blobs.push({
      path: folder.path,
      points: directFiles.map((n) => n.point),
      hull,
      color: folder.color,
      depth: folder.depth,
    });
  }

  // Sort by depth (shallower = render first / on bottom)
  return blobs.sort((a, b) => a.depth - b.depth);
}

/**
 * Create smooth path string from hull points
 */
export function createBlobPath(hull: [number, number][]): string {
  if (hull.length < 3) return '';

  const lineGenerator = line<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(curveCardinalClosed.tension(0.7));

  return lineGenerator(hull) || '';
}

/**
 * Draw a blob shape to canvas with solid fill
 * @param zoomScale - Current zoom scale (1 = normal, >1 = zoomed in). Hull contracts when zoomed in.
 * @param basePadding - The original hull padding, used to calculate contraction amount
 * @param depth - Folder depth, used for depth-based contraction to prevent sibling overlap
 * @param hullContraction - Base contraction amount from settings
 */
export function drawBlobToCanvas(
  ctx: CanvasRenderingContext2D,
  hull: [number, number][],
  fillColor: string,
  strokeColor: string,
  fillOpacity: number = 0.1,
  strokeWidth: number = 1,
  zoomScale: number = 1,
  basePadding: number = 0,
  depth: number = 1,
  hullContraction: number = 3,
) {
  if (hull.length < 3) return;

  // Contract hulls inward to prevent sibling overlap
  // Deeper folders get more contraction since they're packed tighter
  const contractionAmount = hullContraction + depth * 1.5;
  const drawHull = contractHull(hull, contractionAmount);

  // Create the path - hull is already smoothed by Chaikin subdivision
  ctx.beginPath();
  ctx.moveTo(drawHull[0][0], drawHull[0][1]);
  for (let i = 1; i < drawHull.length; i++) {
    ctx.lineTo(drawHull[i][0], drawHull[i][1]);
  }
  ctx.closePath();

  // Solid fill (subtle like repo-visualizer folders)
  ctx.fillStyle = fillColor;
  ctx.globalAlpha = fillOpacity;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Border stroke - use full opacity since color already has opacity baked in
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.globalAlpha = 1;
  ctx.stroke();
}
