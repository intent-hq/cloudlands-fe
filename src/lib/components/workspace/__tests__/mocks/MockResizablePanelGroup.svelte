<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    panels = [],
    orientation = 'vertical',
    storageKey,
    children,
  }: {
    panels?: Array<{ id: string }>;
    orientation?: 'horizontal' | 'vertical';
    storageKey?: string;
    children?: Snippet<[panel: { id: string }, index: number, isCollapsed: boolean]>;
  } = $props();
</script>

<div
  data-testid="mock-resizable-panel-group"
  data-orientation={orientation}
  data-storage-key={storageKey}
>
  {#each panels as panel, index (panel.id)}
    {@render children?.(panel, index, false)}
    {#if index < panels.length - 1}
      <button
        class="app-resize-handle"
        data-resize-axis={orientation === 'vertical' ? 'y' : 'x'}
        aria-label="Resize panels"
      ></button>
    {/if}
  {/each}
</div>
