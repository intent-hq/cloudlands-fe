/**
 * Force Simulation for Agent Overview
 *
 * D3-force simulation for positioning agents, files, and notes
 * with proper alpha management for smooth animations.
 */

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3';
import type { GraphNode, GraphEdge, AgentNode } from './types';
import {
  NODE_DIMENSIONS,
  SIMULATION_CONFIG,
  LINK_DISTANCES,
  LINK_STRENGTHS,
  CHARGE_STRENGTH,
  HIERARCHICAL_LAYOUT,
  COLLISION_PADDING,
  DEFAULT_LAYOUT_MODE,
  type LayoutMode,
} from './constants';

// ============================================================================
// Types
// ============================================================================

export interface SimulationNode extends SimulationNodeDatum {
  id: string;
  type: 'agent' | 'file' | 'note' | 'task';
  radius: number;
  /** Width for rectangular collision (agents have larger width) */
  width: number;
  /** Height for rectangular collision */
  height: number;
  /** Whether this is a background agent (should cluster in bottom-left) */
  isBackground?: boolean;
  /** Target position set by user drag (weighted force pulls toward this) */
  targetX?: number;
  targetY?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimulationLink extends SimulationLinkDatum<SimulationNode> {
  id: string;
  type: GraphEdge['type'];
}

export interface ForceSimulationConfig {
  width: number;
  height: number;
  layoutMode?: LayoutMode;
  onTick?: (nodes: SimulationNode[]) => void;
}

// ============================================================================
// Custom Rectangular Collision Force
// ============================================================================

/**
 * Custom force that handles rectangular collision detection for nodes.
 * D3's built-in forceCollide only supports circular collision.
 */
function forceRectCollide(
  strength = SIMULATION_CONFIG.collisionStrength,
  iterations = SIMULATION_CONFIG.collisionIterations,
) {
  let nodes: SimulationNode[] = [];

  // Get per-type collision padding
  function getPadding(nodeType: string): number {
    if (nodeType === 'agent') return COLLISION_PADDING.agent;
    if (nodeType === 'file') return COLLISION_PADDING.file;
    if (nodeType === 'note') return COLLISION_PADDING.note;
    if (nodeType === 'task') return COLLISION_PADDING.task;
    return SIMULATION_CONFIG.collisionPadding;
  }

  function force() {
    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < nodes.length; j++) {
        for (let k = j + 1; k < nodes.length; k++) {
          const nodeA = nodes[j];
          const nodeB = nodes[k];

          // Determine which nodes are pinned (can't be moved)
          const aIsPinned = nodeA.fx != null && nodeA.fy != null;
          const bIsPinned = nodeB.fx != null && nodeB.fy != null;

          // Skip if BOTH nodes are pinned - can't move either
          if (aIsPinned && bIsPinned) {
            continue;
          }

          // Use per-type padding (use the smaller of the two for collision)
          const paddingA = getPadding(nodeA.type);
          const paddingB = getPadding(nodeB.type);
          const padding = Math.min(paddingA, paddingB);

          const aHalfW = nodeA.width / 2 + padding;
          const aHalfH = nodeA.height / 2 + padding;
          const bHalfW = nodeB.width / 2 + padding;
          const bHalfH = nodeB.height / 2 + padding;

          const dx = (nodeB.x ?? 0) - (nodeA.x ?? 0);
          const dy = (nodeB.y ?? 0) - (nodeA.y ?? 0);

          const overlapX = aHalfW + bHalfW - Math.abs(dx);
          const overlapY = aHalfH + bHalfH - Math.abs(dy);

          // Check if rectangles are overlapping
          if (overlapX > 0 && overlapY > 0) {
            // Push apart along the axis with smaller overlap
            const pushX = overlapX < overlapY;
            const push = (pushX ? overlapX : overlapY) * strength * 0.5;

            if (pushX) {
              const sign = dx > 0 ? 1 : -1;
              // Only move nodes that aren't pinned, but push twice as hard
              if (!aIsPinned) nodeA.x = (nodeA.x ?? 0) - push * sign * (bIsPinned ? 2 : 1);
              if (!bIsPinned) nodeB.x = (nodeB.x ?? 0) + push * sign * (aIsPinned ? 2 : 1);
            } else {
              const sign = dy > 0 ? 1 : -1;
              if (!aIsPinned) nodeA.y = (nodeA.y ?? 0) - push * sign * (bIsPinned ? 2 : 1);
              if (!bIsPinned) nodeB.y = (nodeB.y ?? 0) + push * sign * (aIsPinned ? 2 : 1);
            }
          }
        }
      }
    }
  }

  force.initialize = function (_nodes: SimulationNode[]) {
    nodes = _nodes;
  };

  return force;
}

// ============================================================================
// Force Simulation Factory
// ============================================================================

export function createForceSimulation(config: ForceSimulationConfig) {
  const { width: initialWidth, height: initialHeight, onTick, layoutMode: initialLayoutMode = DEFAULT_LAYOUT_MODE } = config;
  let currentWidth = initialWidth;
  let currentHeight = initialHeight;
  let centerX = currentWidth / 2;
  let centerY = currentHeight / 2;
  let currentLayoutMode = initialLayoutMode;

  let simulation: Simulation<SimulationNode, SimulationLink> | null = null;
  let nodes: SimulationNode[] = [];
  let links: SimulationLink[] = [];

  // Position for background agents cluster (bottom-left)
  const backgroundX = 150;
  let backgroundY = currentHeight - 150;

  // Track the coordinator node ID so we can pin it to center
  let coordinatorId: string | null = null;

  // Store graph data for layout mode changes
  let currentGraphNodes: GraphNode[] = [];
  let currentGraphEdges: GraphEdge[] = [];

  /**
   * Calculate hierarchical positions for agents.
   * Returns a map of node ID to { x, y, level } for agents only.
   * Agents are sorted by creation time, with children indented under parents.
   */
  function calculateAgentHierarchy(
    graphNodes: GraphNode[],
  ): Map<string, { x: number; y: number; level: number }> {
    const agentNodes = graphNodes.filter((n) => n.type === 'agent') as AgentNode[];
    const positions = new Map<string, { x: number; y: number; level: number }>();

    // Build parent-child relationships
    const childrenOf = new Map<string, AgentNode[]>();
    const rootAgents: AgentNode[] = [];

    for (const agent of agentNodes) {
      if (agent.parentAgentId) {
        const children = childrenOf.get(agent.parentAgentId) || [];
        children.push(agent);
        childrenOf.set(agent.parentAgentId, children);
      } else {
        rootAgents.push(agent);
      }
    }

    // Sort root agents: coordinator first, then by creation time (oldest first)
    rootAgents.sort((a, b) => {
      // Coordinator always goes first
      if (a.isCoordinator && !b.isCoordinator) return -1;
      if (!a.isCoordinator && b.isCoordinator) return 1;
      // Then sort by creation time (oldest first)
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Sort children by creation time (oldest first)
    for (const children of childrenOf.values()) {
      children.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    // Traverse hierarchy and assign positions
    let currentY = HIERARCHICAL_LAYOUT.topMargin;
    // Agents go in the center (midpoint between the two swim lanes)
    const baseX = (HIERARCHICAL_LAYOUT.notesColumnX + (currentWidth - HIERARCHICAL_LAYOUT.filesColumnXFromRight)) / 2;

    function positionAgent(agent: AgentNode, level: number) {
      const x = baseX + level * HIERARCHICAL_LAYOUT.agentIndentPerLevel;
      const y = currentY;
      positions.set(agent.id, { x, y, level });
      currentY += HIERARCHICAL_LAYOUT.agentVerticalSpacing;

      // Position children recursively
      const children = childrenOf.get(agent.agentId) || [];
      for (const child of children) {
        positionAgent(child, level + 1);
      }
    }

    for (const rootAgent of rootAgents) {
      positionAgent(rootAgent, 0);
    }

    return positions;
  }

  /**
   * Initialize or update the simulation with new graph data
   */
  function update(graphNodes: GraphNode[], graphEdges: GraphEdge[]) {
    // Check if there are actual structural changes (new/removed nodes or edges)
    const prevNodeIds = new Set(nodes.map((n) => n.id));
    const newNodeIds = new Set(graphNodes.map((n) => n.id));
    const prevEdgeIds = new Set(links.map((l) => l.id));
    const newEdgeIds = new Set(graphEdges.map((e) => e.id));

    const hasNewNodes = graphNodes.some((n) => !prevNodeIds.has(n.id));
    const hasRemovedNodes = nodes.some((n) => !newNodeIds.has(n.id));
    const hasNewEdges = graphEdges.some((e) => !prevEdgeIds.has(e.id));
    const hasRemovedEdges = links.some((l) => !newEdgeIds.has(l.id));
    const hasStructuralChanges = hasNewNodes || hasRemovedNodes || hasNewEdges || hasRemovedEdges;

    // Store current graph data for layout mode changes
    currentGraphNodes = graphNodes;
    currentGraphEdges = graphEdges;

    // Calculate agent positions for hierarchical layout
    const agentHierarchy =
      currentLayoutMode === 'hierarchical' ? calculateAgentHierarchy(graphNodes) : null;

    // X positions for files and notes in hierarchical mode (fixed pixel values)
    const filesX = currentWidth - HIERARCHICAL_LAYOUT.filesColumnXFromRight;
    const notesX = HIERARCHICAL_LAYOUT.notesColumnX;
    const agentCenterX = (notesX + filesX) / 2;

    // Count foreground agents (non-background, non-coordinator) for initial radial positioning (force mode)
    const foregroundAgents = graphNodes.filter(
      (n) => n.type === 'agent' && !(n as any).isBackground && !(n as any).isCoordinator,
    );
    let foregroundAgentIndex = 0;

    // Convert graph nodes to simulation nodes
    const newNodes: SimulationNode[] = graphNodes.map((node) => {
      // Find existing node to preserve position
      const existing = nodes.find((n) => n.id === node.id);
      const dims = NODE_DIMENSIONS[node.type];
      // Check if this is a background agent
      const isBackground = node.type === 'agent' && (node as any).isBackground === true;
      // Use the isCoordinator flag from the store (set based on parentId and isBackground)
      const isCoordinator = node.type === 'agent' && (node as any).isCoordinator === true;
      const isForegroundAgent = node.type === 'agent' && !isBackground && !isCoordinator;

      // Initial position calculation
      let defaultX: number;
      let defaultY: number;
      let fixedX: number | undefined = undefined;
      let fixedY: number | undefined = undefined;

      if (existing?.targetX !== undefined || existing?.targetY !== undefined) {
        // Preserve user-set target position
        defaultX = existing.targetX ?? existing.x ?? centerX;
        defaultY = existing.targetY ?? existing.y ?? centerY;
      } else if (currentLayoutMode === 'hierarchical') {
        // HIERARCHICAL LAYOUT MODE
        if (node.type === 'agent') {
          const agentPos = agentHierarchy?.get(node.id);
          if (agentPos) {
            defaultX = agentPos.x;
            defaultY = agentPos.y;
            // In hierarchical mode, agents have fixed X and Y positions
            fixedX = agentPos.x;
            fixedY = agentPos.y;
          } else {
            defaultX = agentCenterX;
            defaultY = HIERARCHICAL_LAYOUT.topMargin;
          }
        } else if (node.type === 'file') {
          // Files go on the right - start at swim lane center, can wiggle within lane
          // Always use the swim lane X, only preserve Y from existing
          defaultX = filesX;
          defaultY = existing?.y ?? centerY + (Math.random() - 0.5) * 100;
          // No fixedX - use forceX to pull toward swim lane center
        } else if (node.type === 'note' || node.type === 'task') {
          // Notes and tasks go on the left - start at swim lane center, can wiggle within lane
          // Always use the swim lane X, only preserve Y from existing
          defaultX = notesX;
          defaultY = existing?.y ?? centerY + (Math.random() - 0.5) * 100;
          // No fixedX - use forceX to pull toward swim lane center
        } else {
          defaultX = centerX;
          defaultY = centerY;
        }
      } else {
        // FORCE LAYOUT MODE (original behavior)
        if (isBackground) {
          defaultX = backgroundX + (Math.random() - 0.5) * 100;
          defaultY = backgroundY + (Math.random() - 0.5) * 100;
        } else if (isCoordinator) {
          defaultX = centerX;
          defaultY = centerY;
          fixedX = centerX;
          fixedY = centerY;
          coordinatorId = node.id;
        } else if (isForegroundAgent) {
          const agentCount = Math.max(1, foregroundAgents.length);
          const angle = (foregroundAgentIndex / agentCount) * 2 * Math.PI - Math.PI / 2;
          const radius = Math.min(currentWidth, currentHeight) * 0.3;
          defaultX = centerX + Math.cos(angle) * radius;
          defaultY = centerY + Math.sin(angle) * radius;
          foregroundAgentIndex++;
        } else {
          defaultX = centerX + (Math.random() - 0.5) * 100;
          defaultY = centerY + (Math.random() - 0.5) * 100;
        }
      }

      const xPos = existing?.x ?? node.x ?? defaultX;
      const yPos = existing?.y ?? node.y ?? defaultY;
      return {
        id: node.id,
        type: node.type,
        radius: dims.radius,
        width: dims.width,
        height: dims.height,
        isBackground,
        // Preserve user-set target position
        targetX: existing?.targetX,
        targetY: existing?.targetY,
        x: xPos,
        y: yPos,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: fixedX,
        fy: fixedY,
      };
    });

    // Convert graph edges to simulation links
    const newLinks: SimulationLink[] = graphEdges.map((edge) => ({
      id: edge.id,
      type: edge.type,
      source: edge.sourceId,
      target: edge.targetId,
    }));

    nodes = newNodes;
    links = newLinks;

    if (!simulation) {
      createSimulation();
    } else {
      // Update existing simulation
      simulation.nodes(nodes);
      simulation.force(
        'link',
        forceLink<SimulationNode, SimulationLink>(links)
          .id((d) => d.id)
          .distance(getLinkDistance)
          .strength(getLinkStrength),
      );

      // Only reheat if there are structural changes (new/removed nodes or edges)
      // This prevents constant reheating from reactive updates
      if (hasStructuralChanges) {
        simulation.alpha(0.2).restart();
      }
    }
  }

  /**
   * Create the D3 force simulation
   *
   * In force mode: nodes spread via forceManyBody repulsion and link forces.
   * In hierarchical mode: agents are fixed on X, files/notes use links for Y positioning.
   */
  function createSimulation() {
    simulation = forceSimulation<SimulationNode>(nodes)
      // Link force - connects related nodes with per-edge-type distance and strength
      .force(
        'link',
        forceLink<SimulationNode, SimulationLink>(links)
          .id((d) => d.id)
          .distance(currentLayoutMode === 'hierarchical' ? getHierarchicalLinkDistance : getLinkDistance)
          .strength(currentLayoutMode === 'hierarchical' ? getHierarchicalLinkStrength : getLinkStrength),
      )
      // Repulsion force - weaker in hierarchical mode to allow vertical alignment
      .force(
        'charge',
        forceManyBody<SimulationNode>()
          .strength((d) => {
            if (currentLayoutMode === 'hierarchical') {
              // In hierarchical mode, same-type nodes should repel less horizontally
              // since they're already separated into columns
              return d.type === 'agent' ? -50 : -20;
            }
            return CHARGE_STRENGTH[d.type] ?? -30;
          })
          .distanceMax(SIMULATION_CONFIG.chargeDistanceMax),
      )
      // X centering force - pulls nodes toward their column positions
      .force(
        'x',
        forceX<SimulationNode>((d) => {
          if (currentLayoutMode === 'hierarchical') {
            // Files/notes/tasks go to their swim lane centers (fixed pixel positions)
            if (d.type === 'file') {
              return currentWidth - HIERARCHICAL_LAYOUT.filesColumnXFromRight;
            }
            if (d.type === 'note' || d.type === 'task') {
              return HIERARCHICAL_LAYOUT.notesColumnX;
            }
            // Agents use fixed X via fx
            return d.fx ?? centerX;
          }
          return d.fx ?? centerX;
        }).strength((d) => {
          if (currentLayoutMode === 'hierarchical') {
            // Files/notes/tasks have strong X pull to stay in their swim lane
            if (d.type === 'file' || d.type === 'note' || d.type === 'task') {
              return 0.8; // Strong pull to stay in swim lane
            }
            return 0; // Agents: X is controlled by fx
          }
          return d.fx != null ? 0 : SIMULATION_CONFIG.centeringStrength;
        }),
      )
      // Y force - different behavior per mode
      .force(
        'y',
        forceY<SimulationNode>((d) => {
          if (currentLayoutMode === 'hierarchical' && d.type === 'agent') {
            // Agents should stay at their hierarchical Y position
            const agentHierarchy = calculateAgentHierarchy(currentGraphNodes);
            const pos = agentHierarchy.get(d.id);
            return pos?.y ?? d.y ?? centerY;
          }
          return centerY;
        }).strength((d) => {
          if (currentLayoutMode === 'hierarchical') {
            // Agents have strong Y pull to their hierarchical position
            // Files/notes have weak Y centering, rely on links
            return d.type === 'agent' ? 0.3 : 0.02;
          }
          return d.fy != null ? 0 : SIMULATION_CONFIG.centeringStrength;
        }),
      )
      // Rectangular collision force - handles rectangular bounds for cards
      .force('rectCollide', forceRectCollide())
      // Velocity decay for smoother animation
      .velocityDecay(SIMULATION_CONFIG.velocityDecay)
      // Alpha decay controls how quickly simulation "cools"
      .alphaDecay(SIMULATION_CONFIG.alphaDecay)
      .alphaMin(SIMULATION_CONFIG.alphaMin)
      .on('tick', () => {
        // Enforce swim lane boundaries in hierarchical mode
        if (currentLayoutMode === 'hierarchical') {
          const filesLaneCenter = currentWidth - HIERARCHICAL_LAYOUT.filesColumnXFromRight;
          const notesLaneCenter = HIERARCHICAL_LAYOUT.notesColumnX;
          const halfLaneWidth = HIERARCHICAL_LAYOUT.swimLaneWidth / 2;

          for (const node of nodes) {
            if (node.type === 'file') {
              // Clamp files to right swim lane
              const minX = filesLaneCenter - halfLaneWidth;
              const maxX = filesLaneCenter + halfLaneWidth;
              node.x = Math.max(minX, Math.min(maxX, node.x ?? filesLaneCenter));
            } else if (node.type === 'note' || node.type === 'task') {
              // Clamp notes and tasks to left swim lane
              const minX = notesLaneCenter - halfLaneWidth;
              const maxX = notesLaneCenter + halfLaneWidth;
              node.x = Math.max(minX, Math.min(maxX, node.x ?? notesLaneCenter));
            }
          }
        }
        onTick?.(nodes);
      });
  }

  /**
   * Get link distance based on edge type (force mode)
   */
  function getLinkDistance(link: SimulationLink): number {
    return LINK_DISTANCES[link.type] ?? LINK_DISTANCES.default;
  }

  /**
   * Get link strength based on edge type (force mode)
   */
  function getLinkStrength(link: SimulationLink): number {
    return LINK_STRENGTHS[link.type] ?? LINK_STRENGTHS.default;
  }

  /**
   * Get link distance for hierarchical mode.
   * Links mainly affect Y positioning, so distance is more about Y offset.
   */
  function getHierarchicalLinkDistance(link: SimulationLink): number {
    // Shorter distances since we're mainly influencing Y
    switch (link.type) {
      case 'delegation':
        return 0; // Delegation is handled by hierarchy, not links
      case 'file-read':
      case 'file-write':
        return 30; // Files should be close to their agents vertically
      case 'note-read':
      case 'note-write':
        return 30; // Notes should be close to their agents vertically
      default:
        return 40;
    }
  }

  /**
   * Get link strength for hierarchical mode.
   * Stronger links to keep files/notes aligned with their agents.
   */
  function getHierarchicalLinkStrength(link: SimulationLink): number {
    switch (link.type) {
      case 'delegation':
        return 0; // Delegation is handled by hierarchy, not links
      case 'file-read':
        return 1.5;
      case 'file-write':
        return 2.0;
      case 'note-read':
        return 1.5;
      case 'note-write':
        return 2.0;
      default:
        return 1.0;
    }
  }

  /**
   * Reheat the simulation (e.g., when new data arrives)
   */
  function reheat(alpha = SIMULATION_CONFIG.reheatAlpha) {
    simulation?.alpha(alpha).restart();
  }

  /**
   * Stop the simulation
   */
  function stop() {
    simulation?.stop();
  }

  /**
   * Destroy the simulation
   */
  function destroy() {
    simulation?.stop();
    simulation = null;
    nodes = [];
    links = [];
  }

  /**
   * Update center position (e.g., on resize)
   * Moves the pinned coordinator to the new center
   */
  function updateCenter(newWidth: number, newHeight: number) {
    currentWidth = newWidth;
    currentHeight = newHeight;
    centerX = newWidth / 2;
    centerY = newHeight / 2;
    backgroundY = newHeight - 150;

    // Update the coordinator's fixed position to the new center
    if (coordinatorId) {
      const coordinator = nodes.find((n) => n.id === coordinatorId);
      if (coordinator) {
        coordinator.fx = centerX;
        coordinator.fy = centerY;
        coordinator.x = centerX;
        coordinator.y = centerY;
      }
    }

    // Gently reheat to let nodes adjust
    simulation?.alpha(0.1).restart();
  }

  /**
   * Set a node's fixed position (for dragging)
   */
  function setNodePosition(nodeId: string, x: number, y: number) {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      node.fx = x;
      node.fy = y;
      // Keep simulation minimally active during drag - low alpha to prevent other nodes moving much
      if (simulation && simulation.alpha() < 0.05) {
        simulation.alpha(0.05).restart();
      }
    }
  }

  /**
   * Release a node from fixed position (after dragging)
   * Sets targetX/targetY so forces will pull toward dropped location
   */
  function releaseNode(nodeId: string, keepPosition = true) {
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      if (keepPosition) {
        // Store target position - forces will pull toward this
        node.targetX = node.fx ?? node.x;
        node.targetY = node.fy ?? node.y;
        node.x = node.targetX;
        node.y = node.targetY;
      }
      // Release fixed position - let simulation apply forces with minimal reheat
      node.fx = null;
      node.fy = null;
      simulation?.alpha(0.1).restart();
    }
  }

  /**
   * Set the layout mode and recalculate positions
   */
  function setLayoutMode(mode: LayoutMode) {
    if (mode === currentLayoutMode) return;
    currentLayoutMode = mode;

    // Recreate simulation with new forces
    if (simulation) {
      simulation.stop();
      simulation = null;
    }

    // Re-update with current graph data to apply new positions
    if (currentGraphNodes.length > 0) {
      // Clear nodes to force recalculation of positions
      nodes = [];
      update(currentGraphNodes, currentGraphEdges);
    }
  }

  return {
    update,
    reheat,
    stop,
    destroy,
    updateCenter,
    setNodePosition,
    releaseNode,
    setLayoutMode,
    get nodes() {
      return nodes;
    },
    get links() {
      return links;
    },
    get layoutMode() {
      return currentLayoutMode;
    },
  };
}

export type ForceSimulation = ReturnType<typeof createForceSimulation>;
