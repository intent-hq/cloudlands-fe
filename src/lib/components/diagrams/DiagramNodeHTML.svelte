<script lang="ts">
  /**
   * Diagram Node Component (HTML-based)
   */
  import type { ComputedNode, NodeStyleConfig } from './types';
  import { DEFAULT_NODE_STYLE } from './types';

  interface Props {
    node: ComputedNode;
    editable?: boolean;
    dimmed?: boolean;
    styleConfig?: NodeStyleConfig;
    onMove?: (x: number, y: number) => void;
    onHover?: (nodeId: string | null) => void;
    onBindingClick?: (e: MouseEvent, binding: { type: string; target: string }) => void;
  }

  let {
    node,
    editable = false,
    dimmed = false,
    styleConfig = DEFAULT_NODE_STYLE,
    onMove,
    onHover,
    onBindingClick,
  }: Props = $props();

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

  // Check if node has any binding (singular or plural)
  function getBinding(): { type: string; target: string } | null {
    // Check singular binding first
    if (node.binding) {
      return node.binding;
    }
    // Then check bindings array
    if (node.bindings && node.bindings.length > 0) {
      return node.bindings[0];
    }
    return null;
  }

  let hasBinding = $derived(!!getBinding());

  // Handle binding click
  function handleClick(e: MouseEvent) {
    const binding = getBinding();
    if (binding && onBindingClick) {
      onBindingClick(e, binding);
    }
  }

  // Get node class based on semantic style and kind
  let nodeClass = $derived.by(() => {
    const classes = ['diagram-node-html'];
    if (node.semanticStyle) {
      classes.push(`node-${node.semanticStyle}`);
    }
    if (node.kind) {
      classes.push(`node-kind-${node.kind}`);
    }
    if (hasBinding) {
      classes.push('node-clickable');
    }
    if (editable) {
      classes.push('node-editable');
    }
    if (dimmed) {
      classes.push('node-dimmed');
    }
    return classes.join(' ');
  });
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class={nodeClass}
  style="
    --label-font-size: {styleConfig.labelFontSize}px;
    --label-line-height: {styleConfig.labelLineHeight};
    --kind-font-size: {styleConfig.kindFontSize}px;
    --kind-line-height: {styleConfig.kindLineHeight};
    --padding-x: {styleConfig.paddingX}px;
    --padding-y: {styleConfig.paddingY}px;
    --gap: {styleConfig.gap}px;
    --max-lines: {styleConfig.maxLines};
  "
  onmousedown={handleMouseDown}
  onclick={handleClick}
  onmouseenter={() => onHover?.(node.id)}
  onmouseleave={() => onHover?.(null)}
  title={node.label.length > 50 ? node.label : ''}
>
  <div class="node-content">
    <div class="node-label">{node.label}</div>
    {#if node.kind}
      <div class="node-kind-label">{node.kind}</div>
    {/if}
  </div>
</div>

<style>
  .diagram-node-html {
    width: 100%;
    height: 100%;
    border: 1px solid hsl(var(--border));
    /* border-radius: 3px; */
    background: hsl(var(--card));
    transition: all 0.2s ease;
    cursor: default;
    box-sizing: border-box;
    /* Ensure crisp 1px borders */
    transform: translateZ(0);
    -webkit-font-smoothing: antialiased;
  }

  .diagram-node-html.node-editable {
    cursor: move;
  }

  .diagram-node-html.node-clickable {
    cursor: pointer;
  }

  /* Hover effect intentionally removed for cleaner appearance */

  .node-dimmed {
    opacity: 0.3;
    transition: opacity 0.2s ease;
  }

  /* Semantic styles */
  .node-highlighted {
    border-color: hsl(var(--accent));
    background: hsl(var(--accent));
    border-width: 1px;
    color: var(--color-white);
  }

  .node-muted {
    background: hsl(var(--muted));
    color: var(--color-text-muted);
    /* opacity: 0.5; */
  }

  .node-danger {
    /* background: hsl(var(--destructive) / 0.05); */
    background: hsl(var(--destructive) / 1);
    color: var(--color-white);
    border-color: hsl(var(--destructive) / 1);
  }

  .node-success {
    /* background: hsl(142 76% 36% / 0.05); */
    background: hsl(162 76% 36% / 1);
    color: var(--color-white);
    border-color: hsl(162 76% 36% / 1);
  }

  .node-warning {
    /* background: hsl(38 92% 50% / 0.05); */
    background: hsl(31.8deg, 100%, 60.7%, 1);
    color: var(--color-white);
    border-color: hsl(31.8deg, 100%, 60.7%, 1);
  }

  .node-inactive {
    /* background: hsl(var(--muted)); */
    background: hsl(var(--muted-foreground) / 1);
    color: var(--color-white);
    border-color: hsl(var(--muted-foreground) / 1);
    opacity: 0.3;
  }

  /* Node content */
  .node-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--padding-y) var(--padding-x);
    box-sizing: border-box;
    gap: var(--gap);
  }

  .node-label {
    flex: 1;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--max-lines);
    line-clamp: var(--max-lines);
    /* overflow: hidden; */
    text-overflow: ellipsis;
    text-align: center;
    width: 100%;
    /* color: hsl(var(--foreground)); */
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    font-size: var(--label-font-size);
    font-weight: 500;
    line-height: var(--label-line-height);
    letter-spacing: -0.01em;
    word-break: break-word;
  }

  .node-kind-label {
    /* color: hsl(var(--muted-foreground) / 0.6); */
    opacity: 0.5;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    font-size: var(--kind-font-size);
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: var(--kind-line-height);
  }
</style>
