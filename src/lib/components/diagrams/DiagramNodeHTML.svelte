<script lang="ts">
  /**
   * Diagram Node Component (HTML-based)
   */
  import type { ComputedNode, NodeStyleConfig } from './types';
  import { DEFAULT_NODE_STYLE } from './types';
  import { getDiagramNodeIcon } from './diagram-node-icons';
  import { semanticFilenameUnits, splitSemanticLabel } from './diagram-label-wrap';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    node: ComputedNode;
    editable?: boolean;
    dimmed?: boolean;
    highlighted?: boolean;
    styleConfig?: NodeStyleConfig;
    onMove?: (x: number, y: number) => void;
    onHover?: (nodeId: string | null) => void;
    onBindingClick?: (e: MouseEvent, binding: { type: string; target: string }) => void;
  }

  let {
    node,
    editable = false,
    dimmed = false,
    highlighted = false,
    styleConfig = DEFAULT_NODE_STYLE,
    onMove,
    onHover,
    onBindingClick,
  }: Props = $props();

  let isDragging = $state(false);
  let dragOffsetX = $state(0);
  let dragOffsetY = $state(0);
  let nodeEl: HTMLButtonElement | HTMLDivElement | undefined = $state();

  // Convert client (screen) coordinates to SVG coordinate space
  function clientToSVG(clientX: number, clientY: number): { x: number; y: number } {
    const svg = nodeEl?.closest('svg') as SVGSVGElement | null;
    if (svg) {
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const inverse = ctm.inverse();
        return {
          x: inverse.a * clientX + inverse.c * clientY + inverse.e,
          y: inverse.b * clientX + inverse.d * clientY + inverse.f,
        };
      }
    }
    // Fallback: return raw client coords
    return { x: clientX, y: clientY };
  }

  function handleMouseDown(e: MouseEvent) {
    if (!editable) return;
    isDragging = true;
    const svgPoint = clientToSVG(e.clientX, e.clientY);
    dragOffsetX = svgPoint.x - node.x;
    dragOffsetY = svgPoint.y - node.y;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !editable) return;
    const svgPoint = clientToSVG(e.clientX, e.clientY);
    const newX = svgPoint.x - dragOffsetX;
    const newY = svgPoint.y - dragOffsetY;
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
  let usesDefaultStyle = $derived(styleConfig === DEFAULT_NODE_STYLE);
  let nodeIcon = $derived(getDiagramNodeIcon(node.kind));
  let NodeIcon = $derived(nodeIcon.component);
  let nodePaddingX = $derived(usesDefaultStyle ? 10 : styleConfig.paddingX);
  let nodePaddingY = $derived(usesDefaultStyle ? 7 : styleConfig.paddingY);
  let nodeContentGap = $derived(usesDefaultStyle ? 2 : styleConfig.gap);
  let nodeKindFontSize = $derived(usesDefaultStyle ? 11 : styleConfig.kindFontSize);
  let isStoreNode = $derived(['db', 'store', 'data_store'].includes(node.kind ?? ''));
  let filenameUnits = $derived(semanticFilenameUnits(node.label));
  let bindingLabel = $derived.by(() => {
    const binding = getBinding();
    if (!binding) return undefined;
    return m.diagram_node_openBinding_ariaLabel({ label: node.label, type: binding.type });
  });

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
    if (highlighted) {
      classes.push('node-state-highlighted');
    }
    return classes.join(' ');
  });
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<svelte:element
  this={hasBinding ? 'button' : 'div'}
  bind:this={nodeEl}
  type={hasBinding ? 'button' : undefined}
  role={hasBinding ? 'button' : undefined}
  class={nodeClass}
  data-semantic-style={node.semanticStyle ?? 'default'}
  data-default-style={usesDefaultStyle}
  data-state-highlighted={highlighted}
  data-dimmed={dimmed}
  data-store-node={isStoreNode}
  aria-label={bindingLabel}
  style="
    --label-font-size: {styleConfig.labelFontSize}px;
    --label-line-height: {styleConfig.labelLineHeight};
    --kind-font-size: {nodeKindFontSize}px;
    --kind-line-height: {styleConfig.kindLineHeight};
    --padding-x: {nodePaddingX}px;
    --padding-y: {nodePaddingY}px;
    --gap: {nodeContentGap}px;
  "
  onmousedown={handleMouseDown}
  onclick={handleClick}
  onmouseenter={() => onHover?.(node.id)}
  onmouseleave={() => onHover?.(null)}
  onfocus={() => onHover?.(node.id)}
  onblur={() => onHover?.(null)}
  title={node.label.length > 50 ? node.label : undefined}
>
  <div class="node-content">
    <div class="node-row">
      <span class="node-icon" data-node-icon aria-hidden="true">
        <NodeIcon
          size={14}
          weight="regular"
          data-icon={nodeIcon.name}
          data-weight="regular"
          aria-hidden="true"
        />
      </span>
      <div class="node-copy">
        <div class="node-label">
          {#if filenameUnits}
            {#each filenameUnits as unit, index}
              <span class="semantic-filename-unit">{unit}</span
              ><!-- i18n-ignore: Svelte control flow, not user-facing text -->{#if index < filenameUnits.length - 1}<wbr
                />{/if}
            {/each}
          {:else}
            {#each splitSemanticLabel(node.label) as part}
              {part.text}{#if part.hardBreak}<br />{:else if part.breakAfter}<wbr />{/if}
            {/each}
          {/if}
        </div>
        {#if node.kind}
          <div class="node-kind-label">{node.kind}</div>
        {/if}
      </div>
    </div>
  </div>
</svelte:element>

<style>
  .diagram-node-html {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: var(--diagram-node-radius);
    background: var(--diagram-node-surface);
    color: var(--diagram-node-title);
    font-family: var(--font-ui);
    text-align: left;
    transition:
      background-color var(--diagram-move-exit-duration, var(--motion-standard))
        var(--ease-standard),
      color var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard),
      opacity var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard);
    cursor: default;
    appearance: none;
    padding: 0;
    box-sizing: border-box;
    transform: translateZ(0);
    -webkit-font-smoothing: antialiased;
  }

  .diagram-node-html.node-editable {
    cursor: move;
  }

  .diagram-node-html.node-clickable {
    cursor: pointer;
  }

  .diagram-node-html.node-clickable:hover {
    background: var(--diagram-node-hover-surface);
  }

  .diagram-node-html[data-store-node='true'] {
    --store-cap-top: 1px;
    --store-cap-height: 18px;
    --store-bottom-curve-depth: 10px;

    position: relative;
    isolation: isolate;
    overflow: hidden;
    border-radius: 50% / var(--store-bottom-curve-depth);
  }

  .diagram-node-html[data-store-node='true']::before {
    position: absolute;
    z-index: 0;
    top: var(--store-cap-top);
    left: 1px;
    width: calc(100% - 2px);
    height: var(--store-cap-height);
    border: 1px solid var(--diagram-canvas);
    border-radius: 50%;
    box-sizing: border-box;
    content: '';
    pointer-events: none;
  }

  .diagram-node-html.node-clickable:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
    box-shadow: none;
  }

  .node-dimmed {
    opacity: 0.72;
  }

  /* Semantic styles */
  .node-highlighted,
  .node-active {
    --node-semantic: var(--agent-avatar-surface-active);
  }

  .node-danger {
    --node-semantic: var(--destructive);
  }

  .node-success {
    --node-semantic: var(--success);
  }

  .node-warning {
    --node-semantic: var(--warning);
  }

  .node-highlighted,
  .node-active {
    background: var(--diagram-accent);
    color: var(--diagram-accent-foreground);
  }

  .node-danger,
  .node-success,
  .node-warning {
    background: color-mix(in srgb, hsl(var(--node-semantic)) 9%, var(--diagram-node-surface));
    color: var(--diagram-node-title);
  }

  .node-danger {
    color: hsl(var(--error-foreground));
  }

  .node-muted {
    background: color-mix(in srgb, hsl(var(--muted)) 68%, hsl(var(--card)));
    color: hsl(var(--muted-foreground));
  }

  .node-inactive {
    background: color-mix(in srgb, hsl(var(--muted)) 48%, hsl(var(--card)));
    color: hsl(var(--muted-foreground));
  }

  .diagram-node-html:is(
    .node-highlighted,
    .node-active,
    .node-danger,
    .node-success,
    .node-warning,
    .node-muted,
    .node-inactive
  ) {
    border-width: 0;
  }

  /* State-level highlighting (from DiagramState.highlightedNodes) */
  .diagram-node-html.node-state-highlighted {
    border: 0;
    background: color-mix(in srgb, var(--diagram-accent) 12%, var(--diagram-node-surface));
    color: var(--diagram-node-title);
    outline: none;
    box-shadow: none;
  }

  .diagram-node-html.node-state-highlighted.node-clickable:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  /* Node content */
  .node-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--padding-y) var(--padding-x);
    box-sizing: border-box;
  }

  .node-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
    gap: 8px;
  }

  .diagram-node-html[data-store-node='true'] .node-row {
    position: relative;
    z-index: 1;
    justify-content: center;
  }

  .diagram-node-html[data-store-node='true'] .node-content {
    padding-block-start: calc(var(--store-cap-top) + var(--store-cap-height));
    padding-block-end: var(--store-bottom-curve-depth);
  }

  .diagram-node-html[data-store-node='true'] .node-copy {
    flex: 0 1 auto;
  }

  .node-icon {
    display: inline-flex;
    flex: 0 0 14px;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: calc(var(--label-font-size) * var(--label-line-height));
    color: color-mix(in srgb, currentColor 76%, hsl(var(--muted-foreground)));
  }

  .node-copy {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--gap);
  }

  .node-label {
    flex: 0 1 auto;
    display: block;
    overflow: visible;
    text-align: left;
    width: 100%;
    white-space: pre-line;
    overflow-wrap: normal;
    font-family: var(--font-editorial);
    font-size: var(--label-font-size);
    font-weight: 600;
    line-height: var(--label-line-height);
    letter-spacing: -0.01em;
    word-break: normal;
  }

  .semantic-filename-unit {
    white-space: nowrap;
  }

  .node-kind-label {
    color: var(--diagram-metadata);
    opacity: 0.86;
    font-family: var(--font-ui);
    font-size: var(--kind-font-size);
    font-weight: 500;
    letter-spacing: 0.015em;
    line-height: var(--kind-line-height);
    white-space: pre-line;
  }

  .node-highlighted .node-icon,
  .node-active .node-icon,
  .node-danger .node-icon,
  .node-success .node-icon,
  .node-warning .node-icon {
    color: color-mix(in srgb, currentColor 68%, hsl(var(--node-semantic)));
  }

  .node-danger .node-icon {
    color: hsl(var(--error-foreground));
  }

  .node-danger .node-kind-label {
    color: currentColor;
  }

  .node-highlighted .node-kind-label,
  .node-active .node-kind-label {
    color: currentColor;
    opacity: 0.84;
  }

  :global(.catalog-reduced-motion) .diagram-node-html {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html:not(.catalog-full-motion)) .diagram-node-html {
      transition: none;
    }
  }
</style>
