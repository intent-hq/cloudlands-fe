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
  data-group-id={group.id}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  <!-- Group background -->
  <rect x={group.x} y={group.y} width={group.width} height={group.height} class="group-bg" />

  <!-- Group label -->
  <text
    x={group.x + group.width / 2}
    y={group.y + 17}
    text-anchor="middle"
    dominant-baseline="middle"
    class="group-label"
  >
    {group.label}
  </text>
</g>

<style>
  :global(.diagram-group) {
    transition: opacity var(--motion-standard) var(--ease-standard);
  }

  :global(.group-bg) {
    fill: var(--diagram-canvas);
    stroke: var(--diagram-group-outline);
    stroke-width: 1px;
    rx: var(--diagram-group-radius);
    ry: var(--diagram-group-radius);
    vector-effect: non-scaling-stroke;
    transition:
      width var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      height var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      x var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      y var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      fill var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard),
      stroke var(--diagram-move-exit-duration, var(--motion-standard)) var(--ease-standard),
      opacity var(--motion-standard) var(--ease-standard);
  }

  :global(.diagram-group:hover .group-bg) {
    fill: var(--diagram-canvas);
    stroke: hsl(var(--muted-foreground) / 0.48);
  }

  :global(.group-highlighted .group-bg) {
    fill: var(--diagram-canvas);
    stroke: color-mix(in srgb, var(--diagram-accent) 62%, var(--diagram-group-outline));
  }

  :global(.group-muted .group-bg) {
    opacity: 0.55;
  }

  :global(.group-dimmed .group-bg) {
    opacity: 0.5;
  }

  :global(.group-dimmed .group-label) {
    opacity: 0.68;
    transition: opacity var(--motion-standard) var(--ease-standard);
  }

  :global(.group-label) {
    fill: var(--diagram-metadata);
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    font-weight: 500;
    letter-spacing: var(--text-caption-tracking);
    pointer-events: none;
    transition:
      x var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      y var(--diagram-move-exit-duration, 220ms) cubic-bezier(0.16, 1, 0.3, 1),
      opacity var(--motion-standard) var(--ease-standard);
  }

  :global(.catalog-reduced-motion .diagram-group),
  :global(.catalog-reduced-motion .group-bg),
  :global(.catalog-reduced-motion .group-label) {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html:not(.catalog-full-motion) .diagram-group),
    :global(html:not(.catalog-full-motion) .group-bg),
    :global(html:not(.catalog-full-motion) .group-label) {
      transition: none;
    }
  }
</style>
