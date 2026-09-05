<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';

  let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<div
  data-slot="form-row"
  class={cn('grid min-w-0 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]', className)}
>
  {@render children()}
</div>
