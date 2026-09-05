<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { useSize } from '$lib/components/ui/size-context';
  import { cn } from '$lib/utils.js';

  let {
    destructive,
    secondary,
    primary,
    hint,
    class: className,
  }: {
    destructive?: Snippet;
    secondary?: Snippet;
    primary: Snippet;
    hint?: string;
    class?: string;
  } = $props();

  const size = useSize();
</script>

<div
  data-slot="form-actions"
  data-size={size}
  class={cn('flex items-center justify-between', size === 'compact' ? 'gap-2' : 'gap-3', className)}
>
  <div data-slot="form-actions-destructive" class="flex items-center">
    {@render destructive?.()}
  </div>
  <div data-slot="form-actions-end" class="ml-auto flex items-center gap-2">
    {#if hint}
      <ShortcutChip>{hint}</ShortcutChip>
    {/if}
    {@render secondary?.()}
    {@render primary()}
  </div>
</div>
