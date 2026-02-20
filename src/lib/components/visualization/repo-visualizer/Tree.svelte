<script lang="ts">
  /**
   * Tree - Main tree visualization component
   * Ported from githubocto/repo-visualizer
   */
  import type { FileType, ProcessedDataItem, ColorEncoding } from './types';
  import { packData, LOOSE_FILES_ID, DEFAULT_WIDTH, DEFAULT_HEIGHT } from './tree-processing';
  import { truncateString } from './utils';
  import languageColors from './language-colors';
  import CircleText from './CircleText.svelte';
  import Legend from './Legend.svelte';
  import ColorLegend from './ColorLegend.svelte';
  import { navigateToFile } from '$lib/utils/workspace-navigation';
  import { Delaunay } from 'd3-delaunay';

  const MAX_HOVER_DISTANCE = 50;

  interface Props {
    data: FileType | null;
    filesChanged?: string[];
    maxDepth?: number;
    colorEncoding?: ColorEncoding;
    customFileColors?: Record<string, string>;
    width?: number;
    height?: number;
  }

  let {
    data,
    filesChanged = [],
    maxDepth = 9,
    colorEncoding = 'type',
    customFileColors = {},
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
  }: Props = $props();

  const fileColors = $derived({ ...languageColors, ...customFileColors });

  // Caches for position and order stability
  let cachedPositions: Record<string, [number, number]> = {};
  let cachedOrders: Record<string, number> = {};

  // Process and pack the data
  const processed = $derived.by(() => {
    return packData(
      data,
      colorEncoding,
      customFileColors,
      width,
      height,
      cachedPositions,
      cachedOrders,
      filesChanged,
    );
  });

  const packedData = $derived(processed.packedData);
  const fileTypes = $derived(processed.fileTypes);
  const colorScale = $derived(processed.colorScale);
  const colorExtent = $derived(processed.colorExtent);

  const doHighlight = $derived(filesChanged.length > 0);

  // Filter to only real file nodes (not parents or consolidated nodes) for hover detection
  const fileNodes = $derived(
    packedData.filter(
      (item) =>
        item.depth > 0 &&
        item.depth <= maxDepth &&
        item.data.path !== LOOSE_FILES_ID &&
        !item.data.path.startsWith('__consolidated') &&
        !item.children,
    ),
  );

  // Build Delaunay triangulation for efficient nearest-neighbor lookup
  const delaunay = $derived.by(() => {
    if (fileNodes.length === 0) return null;
    const points = fileNodes.map((item) => [item.x, item.y] as [number, number]);
    return Delaunay.from(points);
  });

  // Track hovered node
  let hoveredPath = $state<string | null>(null);
  let hoveredItem = $derived(fileNodes.find((item) => item.data.path === hoveredPath) || null);
  let svgElement: SVGSVGElement | null = $state(null);

  // Handle mouse move on SVG
  function handleMouseMove(event: MouseEvent) {
    if (!delaunay || !svgElement || fileNodes.length === 0) {
      hoveredPath = null;
      return;
    }

    // Get mouse position relative to SVG
    const rect = svgElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Find nearest point using Delaunay
    const index = delaunay.find(x, y);
    if (index === -1 || index >= fileNodes.length) {
      hoveredPath = null;
      return;
    }

    const nearestItem = fileNodes[index];
    const dx = nearestItem.x - x;
    const dy = nearestItem.y - y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Only hover if within max distance (accounting for circle radius)
    if (distance <= MAX_HOVER_DISTANCE + nearestItem.r) {
      hoveredPath = nearestItem.data.path;
    } else {
      hoveredPath = null;
    }
  }

  function handleMouseLeave() {
    hoveredPath = null;
  }

  function handleClick() {
    if (hoveredPath) {
      navigateToFile(hoveredPath);
    }
  }

  // Check if a node should be highlighted
  function isHighlighted(path: string): boolean {
    return filesChanged.includes(path);
  }

  // Get fill color for a node
  function getFillColor(item: ProcessedDataItem): string {
    if (doHighlight) {
      return isHighlighted(item.data.path) ? 'var(--color-primary)' : 'var(--color-muted)';
    }
    return item.data.color || 'var(--color-muted)';
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="relative" style="width: {width}px; height: {height}px;">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <svg
    bind:this={svgElement}
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    class="font-sans overflow-visible absolute inset-0 cursor-pointer"
    xmlns="http://www.w3.org/2000/svg"
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
    onclick={handleClick}
    role="img"
    aria-label="Codebase visualization"
  >
    <defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Layer 1: Circles -->
    {#each packedData as item (item.data.path)}
      {@const { x, y, r, depth, data: nodeData, children } = item}
      {@const isParent = !!children}
      {@const highlighted = isHighlighted(nodeData.path)}

      {#if depth > 0 && depth <= maxDepth && nodeData.path !== LOOSE_FILES_ID}
        <g
          style="fill: {getFillColor(item)}; transition: transform {highlighted
            ? '0.5s'
            : '0s'} ease-out, fill 0.1s ease-out"
          transform="translate({x}, {y})"
        >
          {#if isParent}
            <circle
              {r}
              class="transition-all duration-500 ease-out text-muted/20"
              stroke="var(--color-border)"
              stroke-width="1"
              fill="currentColor"
            />
          {:else}
            <circle
              style="transition: all 0.5s ease-out"
              {r}
              stroke-width="0"
              stroke="var(--color-border)"
            />
          {/if}
        </g>
      {/if}
    {/each}

    <!-- Layer 2: Parent labels (curved text) -->
    {#each packedData as item (item.data.path + '-label')}
      {@const { x, y, r, depth, data: nodeData, children } = item}
      {@const isParent = !!children && depth !== maxDepth}

      {#if depth > 0 && depth <= maxDepth && isParent && nodeData.path !== LOOSE_FILES_ID}
        {#if r >= 16 && nodeData.label && nodeData.label.length <= r * 0.5}
          {@const label = truncateString(nodeData.label, r < 30 ? Math.floor(r / 2.7) + 3 : 100)}
          {@const offsetR = r + 12 - depth * 4}
          {@const fontSize = 16 - depth}

          <g
            style="pointer-events: none; transition: all 0.5s ease-out"
            transform="translate({x}, {y})"
          >
            <!-- Background stroke -->
            <CircleText
              r={Math.max(20, offsetR - 3)}
              fill="var(--color-muted-foreground)"
              stroke="var(--color-sidebar)"
              strokeWidth="6"
              rotate={depth * 1}
              text={label}
              {fontSize}
            />
            <!-- Foreground text -->
            <CircleText
              r={Math.max(20, offsetR - 3)}
              fill="var(--color-muted-foreground)"
              rotate={depth * 1}
              text={label}
              {fontSize}
            />
          </g>
        {/if}
      {/if}
    {/each}

    <!-- Layer 3: File labels (straight text) -->
    {#each packedData as item (item.data.path + '-file-label')}
      {@const { x, y, r, depth, data: nodeData, children } = item}
      {@const isParent = !!children}
      {@const highlighted = isHighlighted(nodeData.path)}

      {#if !hoveredItem}
        {#if depth > 0 && depth <= maxDepth && nodeData.path !== LOOSE_FILES_ID}
          {#if !isParent || highlighted}
            {#if highlighted || (!doHighlight && r > 22)}
              {@const label = highlighted
                ? nodeData.label
                : truncateString(nodeData.label || '', Math.floor(r / 4) + 3)}

              <g
                style="fill: {doHighlight
                  ? highlighted
                    ? 'var(--color-primary)'
                    : 'var(--color-muted-foreground) / 0.3'
                  : nodeData.color}; transition: transform {highlighted ? '0.5s' : '0s'} ease-out"
                transform="translate({x}, {y})"
              >
                <!-- Background stroke -->
                <text
                  class="pointer-events-none opacity-90 text-sm font-medium transition-all duration-500 ease-out"
                  fill="var(--color-muted-foreground)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  stroke="var(--color-sidebar)"
                  stroke-width="3"
                  stroke-linejoin="round"
                >
                  {label}
                </text>
                <!-- Main text -->
                <text
                  class="pointer-events-none opacity-100 text-sm font-medium transition-all duration-500 ease-out"
                  fill="var(--color-foreground)"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >
                  {label}
                </text>
              </g>
            {/if}
          {/if}
        {/if}
      {/if}
    {/each}

    <!-- Legend -->
    {#if !filesChanged.length}
      {#if colorEncoding === 'type'}
        <Legend {fileTypes} {fileColors} {width} {height} />
      {:else}
        <ColorLegend scale={colorScale} extent={colorExtent} {colorEncoding} {width} {height} />
      {/if}
    {/if}

    <!-- Layer 4: Hover highlight and label (using Delaunay for detection) -->
    {#if hoveredItem}
      {@const { x, y, r, data: nodeData } = hoveredItem}
      <!-- Hover ring -->
      <circle
        cx={x}
        cy={y}
        r={r + 2}
        fill="none"
        stroke="var(--color-primary)"
        stroke-width="2"
        stroke-opacity="0.6"
        class="pointer-events-none"
      />
      <!-- Hover label -->
      <g transform="translate({x}, {y - r - 8})" class="pointer-events-none">
        <!-- Background -->
        <text
          class="text-xs font-medium"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="var(--color-sidebar)"
          stroke="var(--color-sidebar)"
          stroke-width="4"
          stroke-linejoin="round"
        >
          {nodeData.label || nodeData.name}
        </text>
        <!-- Foreground -->
        <text
          class="text-xs font-medium"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="var(--color-foreground)"
        >
          {nodeData.label || nodeData.name}
        </text>
      </g>
    {/if}
  </svg>
</div>
