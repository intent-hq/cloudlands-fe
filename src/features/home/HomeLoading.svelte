<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';
  import { watchReducedMotion } from '$lib/utils/reduced-motion.svelte';

  const motion = watchReducedMotion();
  onDestroy(motion.cleanup);

  let { detail = false, count = 5 }: { detail?: boolean; count?: number } = $props();
</script>

<div
  role="status"
  aria-label={m.home_integrations_loading()}
  class="min-w-0"
  data-home-loading
  data-reduced={motion.current}
>
  <div aria-hidden="true" class={detail ? 'space-y-6 py-3' : 'px-7'}>
    {#if detail}
      <div class="space-y-3">
        <Skeleton class="h-6 w-4/5" />
        <Skeleton class="h-4 w-1/2" />
      </div>
      {#each [0, 1, 2] as section (section)}
        <div class="space-y-3">
          <Skeleton class="h-3 w-1/4" />
          <Skeleton class="h-3 w-full" />
          <Skeleton class="h-3 w-5/6" />
        </div>
      {/each}
    {:else}
      {#each Array.from({ length: count }, (_, index) => index) as index (index)}
        <div class="flex h-20 items-center gap-4 border-b border-border/50">
          <Skeleton class="size-2.5 shrink-0 rounded-full" />
          <div class="min-w-0 flex-1 space-y-3">
            <Skeleton class={index % 2 ? 'h-4 w-1/2' : 'h-4 w-2/3'} />
            <Skeleton class="h-3 w-1/3" />
          </div>
          <Skeleton class="h-3 w-6" />
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  [data-home-loading][data-reduced='true'] :global([data-slot='skeleton']) {
    animation: none;
    background-image: none;
  }
</style>
