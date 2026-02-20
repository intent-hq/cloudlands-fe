/**
 * Type definitions for the ecosystem visualizer
 * Organic, force-based visualization of file trees
 */

export type FileNode = {
  name: string;
  path: string;
  size: number;
  children?: FileNode[];
};

export type ProcessedNode = {
  id: string;
  path: string;
  name: string;
  label: string;
  extension?: string;
  color: string;
  size: number;
  value: number; // For layout calculations
  depth: number;
  isFolder: boolean;
  parent?: ProcessedNode;
  children?: ProcessedNode[];
  // Force simulation properties
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // Radius
  effectiveRadius?: number; // For folders: radius that encompasses all children
  fx?: number; // Fixed x
  fy?: number; // Fixed y
  // Original pack position (before centroid adjustment)
  // Used for hull constraints since d3.pack guarantees non-overlap at these positions
  packX?: number;
  packY?: number;
};

/**
 * Result from force simulation including scale factors for hull computation
 */
export type SimulationResult = {
  nodes: ProcessedNode[];
  scaleRatio: number; // scaleX / scaleY ratio for elliptical hull constraints
};

export type BlobShape = {
  path: string; // Folder path
  points: [number, number][];
  hull: [number, number][];
  color: string;
  depth: number;
};

export interface EcosystemVisualizerProps {
  data: FileNode;
  width?: number;
  height?: number;
  filesChanged?: string[];
  onFileClick?: (path: string) => void;
}

/**
 * Visualization settings that can be tweaked
 */
export interface EcosystemSettings {
  // Blob/Hull settings
  blobPadding: number; // Base padding around circles for hull (default: 19)
  depthPaddingFactor: number; // How much to reduce padding per depth level (default: 0.2)
  minDepthPaddingFactor: number; // Minimum padding factor for deep folders (default: 0.3)
  wobbleAmplitude: number; // Organic wobble amount (default: 0)
  hullSubdivisions: number; // Chaikin subdivision iterations (default: 3)
  hullSmoothing: number; // Gaussian smoothing iterations (default: 2)

  // File size settings
  minFileRadius: number; // Minimum file circle radius (default: 10)
  maxFileRadius: number; // Maximum file circle radius (default: 60)

  // Layout settings
  collisionPadding: number; // Padding between file circles (default: 0)
  folderPadding: number; // Padding between folder groups (default: 3)

  // Performance settings
  maxNodes: number; // Maximum number of nodes to render (default: 15000)
  maxDepth: number; // Maximum folder depth to render (default: 50)

  // Visual settings
  hullFillOpacity: number; // Hull fill opacity (default: 0.08)
  hullStrokeOpacity: number; // Hull stroke opacity (default: 1)
  hullContraction: number; // Hull contraction amount to prevent overlap (default: 3)
}

export const DEFAULT_ECOSYSTEM_SETTINGS: EcosystemSettings = {
  blobPadding: 8, // Hull padding around content
  depthPaddingFactor: 0.15,
  minDepthPaddingFactor: 0.4,
  wobbleAmplitude: 0,
  hullSubdivisions: 2,
  hullSmoothing: 2,
  minFileRadius: 3, // Small min for dense visualizations
  maxFileRadius: 79, // Larger max for better size differentiation
  collisionPadding: 2,
  folderPadding: 10, // Moderate inter-folder spacing
  maxNodes: 15000,
  maxDepth: 50,
  hullFillOpacity: 0.08,
  hullStrokeOpacity: 1,
  hullContraction: 3, // Base contraction amount
};
