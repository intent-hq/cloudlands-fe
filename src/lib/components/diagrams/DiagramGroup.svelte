<script lang="ts">
  /**
   * Diagram Group Component
   */
  import type { ComputedGroup } from './types';

  interface Props {
    group: ComputedGroup;
    dimmed?: boolean;
    onHover?: (groupId: string | null) => void;
  }

  let { group, dimmed = false, onHover }: Props = $props();

  // Get group class based on semantic style
  let groupClass = $derived.by(() => {
    const classes = ['diagram-group'];
    if (group.semanticStyle) {
      classes.push(`group-${group.semanticStyle}`);
    }
    if (dimmed) {
      classes.push('group-dimmed');
    }
    return classes.join(' ');
  });

  function handleMouseEnter() {
    onHover?.(group.id);
  }

  function handleMouseLeave() {
    onHover?.(null);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<g
  class={groupClass}
  transform="translate({group.x}, {group.y})"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Group background -->
  <rect width={group.width} height={group.height} rx="6" class="group-bg" />

  <!-- Group label -->
  <text x="12" y="20" class="group-label">
    {group.label}
  </text>
</g>

<style>
  :global(.diagram-group) {
    /* cursor: pointer; */
    transition: all 0.2s ease;
  }

  :global(.group-bg) {
    fill: hsl(var(--muted) / 0.08);
    stroke: hsl(var(--border) / 1);
    stroke-width: 0.5px;
    stroke-dasharray: 9 3;
    vector-effect: non-scaling-stroke;
    transition: all 0.2s ease;
  }

  :global(.diagram-group:hover .group-bg) {
    fill: hsl(var(--muted) / 0.12);
    stroke: hsl(var(--border) / 1);
  }

  :global(.group-highlighted .group-bg) {
    fill: hsl(var(--accent) / 0.05);
    stroke: hsl(var(--accent) / 0.6);
  }

  :global(.group-muted .group-bg) {
    opacity: 0.4;
  }

  :global(.group-dimmed .group-bg) {
    opacity: 0.2;
    transition: opacity 0.2s ease;
  }

  :global(.group-dimmed .group-label) {
    opacity: 0.3;
    transition: opacity 0.2s ease;
  }

  :global(.group-label) {
    fill: hsl(var(--muted-foreground) / 0.8);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    pointer-events: none;
  }
</style>
