/**
 * Diagram rendering types
 *
 * Internal types used by the diagram rendering engine
 */

import type {
  DiagramNode,
  DiagramEdge,
  DiagramGroup,
  DiagramModel,
  DiagramBaseView,
  DiagramState,
  DiagramGrammar,
} from '$shared/types/notes-primitives';

/**
 * Node styling configuration
 * These values are used by both the layout engine (for size computation)
 * and the node component (for CSS rendering)
 */
export interface NodeStyleConfig {
  /** Font size for the main label in pixels */
  labelFontSize: number;
  /** Character width ratio for label (0.6 = 60% of font size) */
  labelCharWidthRatio: number;
  /** Line height for label */
  labelLineHeight: number;
  /** Font size for the kind/type label in pixels */
  kindFontSize: number;
  /** Character width ratio for kind (accounts for uppercase + letter-spacing) */
  kindCharWidthRatio: number;
  /** Line height for kind */
  kindLineHeight: number;
  /** Horizontal padding in pixels */
  paddingX: number;
  /** Vertical padding in pixels */
  paddingY: number;
  /** Gap between label and kind in pixels */
  gap: number;
  /** Maximum lines for label text */
  maxLines: number;
  /** Maximum node width in pixels */
  maxWidth: number;
}

/**
 * Default node style configuration
 */
export const DEFAULT_NODE_STYLE: NodeStyleConfig = {
  labelFontSize: 13,
  labelCharWidthRatio: 0.6,
  labelLineHeight: 1.26,
  kindFontSize: 8,
  kindCharWidthRatio: 0.88,
  kindLineHeight: 1.0,
  paddingX: 16,
  paddingY: 12,
  gap: 4,
  maxLines: 3,
  maxWidth: 250,
};

/**
 * Computed node position and size for rendering
 */
export interface ComputedNode extends DiagramNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computed edge path for rendering
 */
export interface ComputedEdge extends DiagramEdge {
  path: string; // SVG path data
  points?: { x: number; y: number }[];
}

/**
 * Computed group bounds for rendering
 */
export interface ComputedGroup extends DiagramGroup {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computed diagram layout
 */
export interface ComputedLayout {
  nodes: ComputedNode[];
  edges: ComputedEdge[];
  groups?: ComputedGroup[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
}

/**
 * Grammar configuration
 */
export interface GrammarConfig {
  defaultNodeKinds: string[];
  defaultEdgeKinds: string[];
  defaultLayout: DiagramBaseView['layout'];
  nodeDefaults: {
    width: number;
    height: number;
  };
  validation?: {
    requiredFields?: string[];
    allowedNodeKinds?: string[];
    allowedEdgeKinds?: string[];
  };
}

/**
 * Grammar registry
 */
export const GRAMMAR_CONFIGS: Record<DiagramGrammar, GrammarConfig> = {
  architecture: {
    defaultNodeKinds: ['service', 'db', 'queue', 'actor', 'ui_component'],
    defaultEdgeKinds: ['request', 'response', 'event', 'data'],
    defaultLayout: {
      type: 'layered',
      direction: 'LR',
      spacing: 30,
      edgeRouting: 'orthogonal',
    },
    nodeDefaults: {
      width: 80,
      height: 40,
    },
  },
  sequence: {
    defaultNodeKinds: ['actor'],
    defaultEdgeKinds: ['message', 'return'],
    defaultLayout: {
      type: 'layered',
      direction: 'TB',
      spacing: 50,
      edgeRouting: 'polyline',
    },
    nodeDefaults: {
      width: 75,
      height: 32,
    },
  },
  state_machine: {
    defaultNodeKinds: ['state', 'start', 'end'],
    defaultEdgeKinds: ['transition'],
    defaultLayout: {
      type: 'layered',
      direction: 'LR',
      spacing: 35,
      edgeRouting: 'curved',
    },
    nodeDefaults: {
      width: 75,
      height: 38,
    },
  },
  data_flow: {
    defaultNodeKinds: ['process', 'data_store', 'external'],
    defaultEdgeKinds: ['flow'],
    defaultLayout: {
      type: 'layered',
      direction: 'LR',
      spacing: 30,
      edgeRouting: 'polyline',
    },
    nodeDefaults: {
      width: 80,
      height: 40,
    },
  },
  network: {
    defaultNodeKinds: ['node', 'router', 'switch', 'server'],
    defaultEdgeKinds: ['connection'],
    defaultLayout: {
      type: 'force',
      spacing: 60,
      edgeRouting: 'polyline',
    },
    nodeDefaults: {
      width: 60,
      height: 60,
    },
  },
  flowchart: {
    defaultNodeKinds: ['process', 'decision', 'start', 'end', 'data'],
    defaultEdgeKinds: ['flow'],
    defaultLayout: {
      type: 'layered',
      direction: 'TB',
      spacing: 50,
      edgeRouting: 'orthogonal',
    },
    nodeDefaults: {
      width: 80,
      height: 40,
    },
  },
  timeline: {
    defaultNodeKinds: ['event', 'milestone'],
    defaultEdgeKinds: ['sequence'],
    defaultLayout: {
      type: 'layered',
      direction: 'LR',
      spacing: 60,
      edgeRouting: 'polyline',
    },
    nodeDefaults: {
      width: 75,
      height: 38,
    },
  },
  dependency_graph: {
    defaultNodeKinds: ['module', 'package', 'file'],
    defaultEdgeKinds: ['depends_on', 'imports'],
    defaultLayout: {
      type: 'layered',
      direction: 'TB',
      spacing: 40,
      edgeRouting: 'polyline',
    },
    nodeDefaults: {
      width: 75,
      height: 38,
    },
  },
};
