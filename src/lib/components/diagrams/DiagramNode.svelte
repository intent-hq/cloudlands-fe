<script lang="ts">
  /**
   * Diagram Node Component
   */
  import type { ComputedNode } from './types';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';

  interface Props {
    node: ComputedNode;
    editable?: boolean;
    onMove?: (x: number, y: number) => void;
  }

  let { node, editable = false, onMove }: Props = $props();

  const logger = createLogger('DiagramNode');
  let isDragging = $state(false);
  let dragStartX = $state(0);
  let dragStartY = $state(0);

  function handleMouseDown(e: MouseEvent) {
    if (!editable) return;
    isDragging = true;
    dragStartX = e.clientX - node.x;
    dragStartY = e.clientY - node.y;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !editable) return;
    const newX = e.clientX - dragStartX;
    const newY = e.clientY - dragStartY;
    onMove?.(newX, newY);
  }

  function handleMouseUp() {
    isDragging = false;
  }

  // Handle binding click
  async function handleClick() {
    if (node.bindings && node.bindings.length > 0) {
      const binding = node.bindings[0];
      if (binding.type === 'file') {
        // Open file in editor (only in Electron)
        try {
          await invoke('workspace:openFile', { filePath: binding.target });
        } catch {
          // In browser, IPC is not available
          logger.debug('Would open file (browser mode)', { target: binding.target });
        }
      }
      // TODO: Handle other binding types
    }
  }

  // Get node class based on semantic style
  let nodeClass = $derived.by(() => {
    const classes = ['diagram-node'];
    if (node.semanticStyle) {
      classes.push(`node-${node.semanticStyle}`);
    }
    if (node.bindings && node.bindings.length > 0) {
      classes.push('node-clickable');
    }
    if (editable) {
      classes.push('node-editable');
    }
    return classes.join(' ');
  });
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<g
  class={nodeClass}
  transform="translate({node.x}, {node.y})"
  onmousedown={handleMouseDown}
  onclick={handleClick}
>
  <!-- Node background -->
  <rect width={node.width} height={node.height} rx="3" class="node-bg" />

  <!-- Node label with text wrapping -->
  <foreignObject x="4" y="4" width={node.width - 8} height={node.height - (node.kind ? 18 : 8)}>
    <div
      class="node-label-wrapper"
      style="
        max-width: {node.width - 8}px;
        max-height: {node.height - (node.kind ? 18 : 8)}px;
      "
    >
      {node.label}
    </div>
  </foreignObject>

  <!-- Kind indicator (if present) -->
  {#if node.kind}
    <text x={node.width / 2} y={node.height - 6} text-anchor="middle" class="node-kind">
      {node.kind}
    </text>
  {/if}
</g>

<style>
  :global(.diagram-node) {
    cursor: default;
    transition: all 0.2s ease;
  }

  :global(.diagram-node.node-editable) {
    cursor: move;
  }

  :global(.diagram-node.node-clickable) {
    cursor: pointer;
  }

  :global(.diagram-node:hover .node-bg) {
    filter: brightness(1.1);
  }

  :global(.node-bg) {
    fill: hsl(var(--card));
    stroke: hsl(var(--border));
    stroke-width: 1;
  }

  :global(.node-highlighted .node-bg) {
    stroke: hsl(var(--accent));
    stroke-width: 1.5;
  }

  :global(.node-muted .node-bg) {
    fill: hsl(var(--muted));
    opacity: 0.5;
  }

  :global(.node-danger .node-bg) {
    fill: hsl(var(--destructive) / 0.05);
    stroke: hsl(var(--destructive) / 0.5);
  }

  :global(.node-success .node-bg) {
    fill: hsl(142 76% 36% / 0.05);
    stroke: hsl(142 76% 36% / 0.5);
  }

  :global(.node-warning .node-bg) {
    fill: hsl(38 92% 50% / 0.05);
    stroke: hsl(38 92% 50% / 0.5);
  }

  :global(.node-inactive .node-bg) {
    fill: hsl(var(--muted));
    stroke: hsl(var(--muted-foreground) / 0.3);
    opacity: 0.3;
  }

  :global(.node-label) {
    fill: hsl(var(--foreground));
    font-size: 11px;
    font-weight: 500;
    pointer-events: none;
  }

  :global(.node-label-wrapper) {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: 100%;
    height: 100%;
    color: hsl(var(--foreground));
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.node-kind) {
    fill: hsl(var(--muted-foreground) / 0.6);
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    pointer-events: none;
  }
</style>
