<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import type { PaneInsertionTarget } from './panel-drag';

  let {
    targets,
    activeIndex = null,
  }: {
    targets: readonly PaneInsertionTarget[];
    activeIndex?: number | null;
  } = $props();
</script>

<div
  class="pointer-events-none absolute inset-0 z-50"
  data-pane-insertion-targets
  aria-hidden="true"
>
  {#each targets as target (target.index)}
    {@const active = activeIndex === target.index}
    <div
      class={cn(
        'absolute inset-y-0 flex items-center justify-center border-x border-primary/30 bg-primary/5',
        'motion-safe:transition-colors motion-safe:duration-150 motion-reduce:transition-none',
        active && 'border-primary bg-primary/20',
      )}
      style:left={`${target.left}px`}
      style:width={`${target.width}px`}
      data-pane-insertion-target={target.index}
      data-active={active ? 'true' : undefined}
    >
      {#if active}
        <span
          class="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-background/95 px-2 py-1 text-xs font-medium text-primary shadow-sm"
        >
          {m.layout_panelDropZones_newColumn_label()}
        </span>
      {/if}
    </div>
  {/each}
</div>
