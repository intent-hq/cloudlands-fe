<script lang="ts">
  /**
   * AgentHierarchyGraph Component
   *
   * Displays agents in a hierarchical tree with delegators above delegatees.
   * Features:
   * - Curved bezier connection lines between parent/child agents
   * - Staggered layout: children positioned between parents
   * - Pan/zoom controls like Figma
   * - Activity pills showing what active agents are working on
   * - Fixed-width cards for consistent layout
   * - Hover cards showing agent details
   */
  import type { AgentNode, GraphEdge } from './types';
  import AgentHierarchyCard, { CARD_WIDTH, CARD_HEIGHT } from './AgentHierarchyCard.svelte';
  import BackgroundAgentCard, { BG_CARD_SIZE } from './BackgroundAgentCard.svelte';
  import HoverCard from '$lib/components/ui/HoverCard.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { formatRelativeTime } from '$lib/utils/timeFormatting';

  interface Props {
    agents: AgentNode[];
    edges: GraphEdge[];
    onAgentClick?: (agentId: string, agentName: string, event: MouseEvent) => void;
  }

  let { agents, edges, onAgentClick }: Props = $props();

  // Layout constants
  const GAPX = 12; // Gap between cards
  const GAPY = 6; // Gap between cards
  const MAX_CHILDREN_PER_ROW = 5; // Max agents in odd rows (even rows have N-1 for stagger)

  // Utility agent type groups - agents that run in the background for specific tasks
  const UTILITY_AGENT_GROUPS = [
    { id: 'git', label: 'Git', types: ['commit-message', 'pr-description'] },
    { id: 'review', label: 'Review', types: ['code-review', 'code-walkthrough'] },
  ] as const;

  // Pan/zoom state
  let scale = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let isPanning = $state(false);
  let lastPanPoint = $state({ x: 0, y: 0 });
  let containerRef = $state<HTMLDivElement | null>(null);

  // Hover state for agent cards
  let hoveredAgentId = $state<string | null>(null);
  let hoverTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

  function handleAgentHover(agentId: string) {
    // Clear any pending timeout
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
    // Show immediately - no delay
    hoveredAgentId = agentId;
  }

  function handleAgentLeave() {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }
    hoveredAgentId = null;
  }

  // Get the hovered agent data
  const hoveredAgent = $derived(
    hoveredAgentId ? agents.find(a => a.agentId === hoveredAgentId) : null
  );

  // Zoom constants
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2;
  const ZOOM_STEP = 0.1;

  // Pan/zoom handlers
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (1 + delta)));

    // Zoom towards cursor
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const scaleFactor = newScale / scale;
      panX = mouseX - (mouseX - panX) * scaleFactor;
      panY = mouseY - (mouseY - panY) * scaleFactor;
    }
    scale = newScale;
  }

  function handleMouseDown(e: MouseEvent) {
    // Left click (on canvas background), middle button, or shift+left click for panning
    // Check if we're clicking on the canvas itself, not on a card
    const target = e.target as HTMLElement;
    const isOnCanvas = target.closest('.agent-hierarchy-graph') && !target.closest('.agent-card') && !target.closest('.bg-agent-card') && !target.closest('.zoom-controls');

    if (e.button === 1 || (e.button === 0 && (e.shiftKey || isOnCanvas))) {
      isPanning = true;
      lastPanPoint = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isPanning) return;
    const dx = e.clientX - lastPanPoint.x;
    const dy = e.clientY - lastPanPoint.y;
    panX += dx;
    panY += dy;
    lastPanPoint = { x: e.clientX, y: e.clientY };
  }

  function handleMouseUp() {
    isPanning = false;
  }

  function zoomIn() {
    scale = Math.min(MAX_SCALE, scale + ZOOM_STEP);
  }

  function zoomOut() {
    scale = Math.max(MIN_SCALE, scale - ZOOM_STEP);
  }

  function resetZoom() {
    scale = 1;
    panX = 0;
    panY = 0;
  }

  function fitToView() {
    // Reset to center and fit
    scale = 0.8;
    panX = 0;
    panY = 0;
  }

  const zoomPercent = $derived(Math.round(scale * 100));

  // Build hierarchy from agents
  interface HierarchyAgent {
    agent: AgentNode;
    children: HierarchyAgent[];
    activeFile?: string;
    activeNote?: string;
  }

  // Map of agentId -> agent name for displaying waiting-for info
  const agentNames = $derived.by(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.agentId, agent.name);
    }
    return map;
  });

  // All utility agent types for filtering
  const UTILITY_AGENT_TYPES = new Set<string>(
    UTILITY_AGENT_GROUPS.flatMap(g => [...g.types])
  );

  // Group utility agents by their group
  const utilityAgentGroups = $derived.by(() => {
    const groups: { id: string; label: string; agents: AgentNode[] }[] = [];

    for (const group of UTILITY_AGENT_GROUPS) {
      const typeSet = new Set<string>(group.types);
      const groupAgents = agents.filter(a =>
        a.agentType && typeSet.has(a.agentType)
      );
      if (groupAgents.length > 0) {
        groups.push({
          id: group.id,
          label: group.label,
          agents: groupAgents,
        });
      }
    }

    return groups;
  });

  // Filter out utility agents from main hierarchy
  const mainAgents = $derived(
    agents.filter(a => !a.agentType || !UTILITY_AGENT_TYPES.has(a.agentType))
  );

  const hierarchy = $derived.by(() => {
    const agentMap = new Map<string, HierarchyAgent>();
    const roots: HierarchyAgent[] = [];

    // Create hierarchy nodes for main agents (excluding utility agents)
    for (const agent of mainAgents) {
      agentMap.set(agent.agentId, {
        agent,
        children: [],
        activeFile: undefined,
        activeNote: undefined,
      });
    }

    // Find active files/notes from edges
    const activeEdges = edges.filter(e => e.isActive);
    for (const edge of activeEdges) {
      const sourceAgentId = edge.sourceId.replace('agent-', '');
      const hierarchyAgent = agentMap.get(sourceAgentId);
      if (hierarchyAgent) {
        if (edge.type === 'file-read' || edge.type === 'file-write') {
          hierarchyAgent.activeFile = edge.targetId.replace('file-', '').split('/').pop();
        } else if (edge.type === 'note-read' || edge.type === 'note-write') {
          hierarchyAgent.activeNote = edge.targetId.replace('note-', '');
        }
      }
    }

    // Build parent-child relationships
    for (const [, hierarchyAgent] of agentMap) {
      const parentId = hierarchyAgent.agent.parentAgentId;
      if (parentId && agentMap.has(parentId)) {
        agentMap.get(parentId)!.children.push(hierarchyAgent);
      } else {
        roots.push(hierarchyAgent);
      }
    }

    return roots;
  });

  function handleClick(agent: AgentNode, event: MouseEvent) {
    onAgentClick?.(agent.agentId, agent.name, event);
  }
</script>

{#snippet agentTree(node: HierarchyAgent, depth: number = 0)}
  {@const isBackground = node.agent.isBackground}
  {@const hasChildren = node.children.length > 0}
  {@const childCardWidth = hasChildren && node.children[0]?.agent.isBackground ? BG_CARD_SIZE : CARD_WIDTH}
  {@const curveRadius = 16}
  {@const connectorHeight = 60}
  {@const cardStep = childCardWidth + GAPX}

  <!-- Build honeycomb rows: odd rows have N agents, even rows have N-1 agents staggered -->
  {@const childRows = hasChildren ? (() => {
    const rows: typeof node.children[] = [];
    let remaining = [...node.children];
    let isOddRow = true;
    while (remaining.length > 0) {
      // Odd rows: up to MAX_CHILDREN_PER_ROW
      // Even rows: up to MAX_CHILDREN_PER_ROW - 1 (staggered)
      const rowSize = isOddRow ? MAX_CHILDREN_PER_ROW : MAX_CHILDREN_PER_ROW - 1;
      rows.push(remaining.slice(0, rowSize));
      remaining = remaining.slice(rowSize);
      isOddRow = !isOddRow;
    }
    return rows;
  })() : []}

  <!-- Calculate the width of the first row for parent center reference -->
  {@const firstRowCount = childRows[0]?.length ?? 0}
  {@const firstRowWidth = firstRowCount * cardStep - GAPX}

  <div class="agent-tree-node flex flex-col items-center">
    <!-- Agent card - use BackgroundAgentCard for background agents -->
    {#if isBackground}
      <BackgroundAgentCard
        agent={node.agent}
        onclick={(e) => handleClick(node.agent, e)}
        onmouseenter={() => handleAgentHover(node.agent.agentId)}
        onmouseleave={handleAgentLeave}
      />
    {:else}
      <AgentHierarchyCard
        agent={node.agent}
        activeFile={node.activeFile}
        activeNote={node.activeNote}
        {agentNames}
        onclick={(e) => handleClick(node.agent, e)}
        onmouseenter={() => handleAgentHover(node.agent.agentId)}
        onmouseleave={handleAgentLeave}
      />
    {/if}

    <!-- Children with curved connectors -->
    {#if hasChildren}
      {@const parentWaitingFor = node.agent.waitingForAgentIds || []}
      {@const hasAnyWaiting = parentWaitingFor.length > 0}
      {@const horizontalY1 = connectorHeight / 2}
      {@const horizontalYStep = 3.5}
      {@const staggerAmount = BG_CARD_SIZE + GAPX }
      {@const cardHeight = isBackground ? BG_CARD_SIZE : CARD_HEIGHT}
      <!-- Total width needed: first row width + stagger for second row -->
      {@const totalWidth = firstRowWidth + staggerAmount}
      <!-- Parent center is at the middle of the first row (not including stagger) -->
      {@const parentCenterX = staggerAmount / 2 + firstRowWidth / 2}

      <!-- Wrapper to keep SVG and children aligned -->
      <div class="children-wrapper" style="width: {totalWidth}px;">
        <!-- Single SVG for ALL connector lines from parent -->
        <svg
          class="connector-svg"
          width={totalWidth}
          height={connectorHeight}
          style="overflow: visible; display: block;"
        >
          <!-- Vertical line from parent center down -->
          <path
            d="M {parentCenterX} 0 L {parentCenterX} {connectorHeight / 3}"
            stroke={hasAnyWaiting ? 'var(--primary)' : 'currentColor'}
            class={hasAnyWaiting ? '' : 'text-border'}
            stroke-width={hasAnyWaiting ? 2 : 1}
            fill="none"
          />

          <!-- Draw connectors for ALL rows from the same parent origin -->
          {#each childRows as row, rowIndex}
            {@const isStaggeredRow = rowIndex % 2 === 1}
            <!-- Non-staggered rows start at staggerAmount/2, staggered rows start at staggerAmount -->
            {@const rowStartX = isStaggeredRow ? staggerAmount : staggerAmount / 2}
            <!-- Each row's horizontal line is 5px lower than the previous -->
            {@const thisHorizontalY = horizontalY1 + rowIndex * horizontalYStep}
            <!-- Y position where lines end for this row -->
            {@const rowEndY = connectorHeight + rowIndex * (BG_CARD_SIZE + GAPY)}

            {#each row as child, i}
              {@const childCenterX = rowStartX + i * cardStep + childCardWidth / 2}
              {@const isWaitingForChild = parentWaitingFor.includes(child.agent.agentId)}
              {@const lineStroke = isWaitingForChild ? 'var(--color-primary)' : 'currentColor'}
              {@const lineClass = isWaitingForChild ? '' : 'text-border'}
              {@const lineWidth = isWaitingForChild ? 2 : 1}

              {#if Math.abs(childCenterX - parentCenterX) < 1}
                <!-- Center child - straight line down -->
                <path
                  d="M {parentCenterX} {connectorHeight / 3} L {parentCenterX} {rowEndY}"
                  stroke={lineStroke}
                  class={lineClass}
                  stroke-width={lineWidth}
                  fill="none"
                />
              {:else if childCenterX < parentCenterX}
                <!-- Left child - curve left then down -->
                <path
                  d="M {parentCenterX} {connectorHeight / 3}
                     L {parentCenterX} {thisHorizontalY - curveRadius}
                     Q {parentCenterX} {thisHorizontalY}, {parentCenterX - curveRadius} {thisHorizontalY}
                     L {childCenterX + curveRadius} {thisHorizontalY}
                     Q {childCenterX} {thisHorizontalY}, {childCenterX} {thisHorizontalY + curveRadius}
                     L {childCenterX} {rowEndY}"
                  stroke={lineStroke}
                  class={lineClass}
                  stroke-width={lineWidth}
                  fill="none"
                />
              {:else}
                <!-- Right child - curve right then down -->
                <path
                  d="M {parentCenterX} {connectorHeight / 3}
                     L {parentCenterX} {thisHorizontalY - curveRadius}
                     Q {parentCenterX} {thisHorizontalY}, {parentCenterX + curveRadius} {thisHorizontalY}
                     L {childCenterX - curveRadius} {thisHorizontalY}
                     Q {childCenterX} {thisHorizontalY}, {childCenterX} {thisHorizontalY + curveRadius}
                     L {childCenterX} {rowEndY}"
                  stroke={lineStroke}
                  class={lineClass}
                  stroke-width={lineWidth}
                  fill="none"
                />
              {/if}
            {/each}
          {/each}
        </svg>

        <!-- Children rows container -->
        <div class="children-rows flex flex-col" style="gap: {GAPY}px;">
          {#each childRows as row, rowIndex}
            {@const isStaggeredRow = rowIndex % 2 === 1}
            <!-- Match the SVG positioning: non-staggered at staggerAmount/2, staggered at staggerAmount -->
            {@const rowStartX = isStaggeredRow ? staggerAmount : staggerAmount / 2}

            <!-- Children row -->
            <div
              class="children-row flex"
              style="gap: {GAPX}px; margin-left: {rowStartX}px;"
            >
              {#each row as child (child.agent.agentId)}
                {@render agentTree(child, depth + 1)}
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="agent-hierarchy-graph relative w-full h-full overflow-hidden bg-background"
  bind:this={containerRef}
  onwheel={handleWheel}
  onmousedown={handleMouseDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onmouseleave={handleMouseUp}
>
  {#if hierarchy.length === 0}
    <div class="absolute inset-0 flex items-center justify-center">
      <div class="text-center text-muted-foreground">
        <p class="text-lg font-medium">No agents yet</p>
        <p class="text-sm mt-1">Agent hierarchy will appear here</p>
      </div>
    </div>
  {:else}
    <!-- Zoomable/pannable content -->
    <div
      class="canvas-content absolute inset-0 flex items-center justify-center p-8"
      style="transform: translate({panX}px, {panY}px) scale({scale}); transform-origin: center center;"
    >
      <div class="hierarchy-wrapper flex items-start gap-8">
        <!-- Utility agent corrals (left side) -->
        {#if utilityAgentGroups.length > 0}
          <div class="utility-corrals flex flex-col gap-4">
            {#each utilityAgentGroups as group (group.id)}
              <div class="utility-corral border-2 border-dashed border-border/50 rounded-lg p-3 min-w-20">
                <div class="corral-label text-xs text-muted-foreground font-medium mb-2 text-center">
                  {group.label}
                </div>
                <div class="corral-agents flex flex-col items-center gap-2">
                  {#each group.agents as agent (agent.agentId)}
                    <BackgroundAgentCard
                      {agent}
                      onclick={(e) => handleClick(agent, e)}
                      onmouseenter={() => handleAgentHover(agent.agentId)}
                      onmouseleave={handleAgentLeave}
                    />
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Main hierarchy (center) -->
        <div class="main-hierarchy flex flex-col items-center gap-4">
          <!-- Main hierarchy -->
          <div class="hierarchy-container flex flex-col items-center gap-4">
            <!-- Root level agents -->
            <div class="roots-row flex justify-center" style="gap: {GAPX}px;">
              {#each hierarchy as root (root.agent.agentId)}
                {@render agentTree(root, 0)}
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- Hover Card for agent details - inside canvas so it moves with pan/zoom -->
      {#if hoveredAgent}
        <HoverCard anchor={'--agent-hierarchy-' + hoveredAgentId} position="top" absolute>
          <div class="p-3 space-y-2">
            <!-- Header with avatar and name -->
            <div class="flex items-center gap-2">
              <AuggieAvatar
                size={24}
                colorSeed={hoveredAgent.agentId}
                faceSeed={hoveredAgent.agentId}
              />
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate">{hoveredAgent.name}</div>
                {#if hoveredAgent.specialist}
                  <div class="text-xs text-muted-foreground capitalize">{hoveredAgent.specialist.replace('-', ' ')}</div>
                {/if}
              </div>
              {#if hoveredAgent.isBackground}
                <span class="px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded">
                  BG
                </span>
              {/if}
            </div>

            <!-- Status -->
            <div class="text-xs text-muted-foreground">
              {#if hoveredAgent.status === 'responding'}
                <span class="text-primary">● Responding</span>
              {:else if hoveredAgent.status === 'waiting'}
                <span class="text-yellow-500">● Waiting</span>
              {:else if hoveredAgent.status === 'completed'}
                <span class="text-green-500">● Completed</span>
              {:else if hoveredAgent.status === 'failed'}
                <span class="text-red-500">● Failed</span>
              {:else}
                <span>● Idle</span>
              {/if}
            </div>

            <!-- Created time -->
            <div class="text-xs text-muted-foreground">
              Created {formatRelativeTime(hoveredAgent.createdAt)}
            </div>

            <!-- Last response preview -->
            {#if hoveredAgent.lastResponse}
              <div class="text-xs text-muted-foreground/80 line-clamp-3 border-t border-border pt-2 mt-2">
                {hoveredAgent.lastResponse}
              </div>
            {/if}

            <!-- Active tool -->
            {#if hoveredAgent.activeToolName}
              <div class="text-xs text-muted-foreground flex items-center gap-1">
                <span class="animate-spin">⚙️</span>
                <span>Using: {hoveredAgent.activeToolName}</span>
              </div>
            {/if}
          </div>
        </HoverCard>
      {/if}
    </div>

    <!-- Zoom controls - Figma style (bottom right) -->
    <div class="zoom-controls absolute bottom-4 right-4 flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm p-1">
      <button
        type="button"
        class="zoom-btn w-8 h-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        onclick={zoomOut}
        title="Zoom out"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      <button
        type="button"
        class="zoom-percent w-12 h-8 flex items-center justify-center text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        onclick={resetZoom}
        title="Reset zoom (click to reset)"
      >
        {zoomPercent}%
      </button>

      <button
        type="button"
        class="zoom-btn w-8 h-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        onclick={zoomIn}
        title="Zoom in"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>

      <div class="w-px h-6 bg-border mx-1"></div>

      <button
        type="button"
        class="zoom-btn w-8 h-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        onclick={fitToView}
        title="Fit to view"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
        </svg>
      </button>
    </div>

    <!-- Pan hint -->
    <div class="absolute bottom-4 left-4 text-xs text-muted-foreground/50">
      Scroll to zoom • Drag to pan
    </div>
  {/if}
</div>

<style>
  .agent-hierarchy-graph {
    cursor: grab;
  }
  .agent-hierarchy-graph:active {
    cursor: grabbing;
  }
  .canvas-content {
    transition: transform 0.1s ease-out;
    will-change: transform;
  }
</style>
