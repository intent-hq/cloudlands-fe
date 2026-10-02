<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';
  import { watchReducedMotion } from '$lib/utils/reduced-motion.svelte';

  const motion = watchReducedMotion();
  onDestroy(motion.cleanup);

  let {
    detail = false,
    count = 5,
    view = 'list',
    grouped = false,
    rows = 'workspace',
  }: {
    detail?: boolean;
    count?: number;
    view?: 'list' | 'board';
    grouped?: boolean;
    rows?: 'workspace' | 'integration' | 'compact';
  } = $props();
</script>

<div
  role="status"
  aria-label={m.home_integrations_loading()}
  class="min-h-0 min-w-0 flex-1 overflow-hidden"
  data-home-loading
  data-reduced={motion.current}
>
  <div aria-hidden="true" class={detail ? 'space-y-6 py-3' : rows === 'compact' ? '' : 'px-5 pb-4'}>
    {#if detail}
      <div class="space-y-3">
        <Skeleton class="h-6 w-4/5" />
        <Skeleton class="h-4 w-1/2" />
      </div>
      {#each [0, 1] as section (section)}
        <div class="space-y-3">
          <Skeleton class="h-3 w-full" />
          <Skeleton class="h-3 w-5/6" />
        </div>
      {/each}
    {:else if view === 'board'}
      <div class="grid grid-cols-[repeat(3,minmax(15rem,1fr))] gap-4 px-1">
        {#each [0, 1, 2] as column (column)}
          <div class="min-w-0 space-y-3">
            <div class="flex h-10 items-center px-2"><Skeleton class="h-3 w-20" /></div>
            {#each [0, 1, 2] as row (row)}
              <div class="space-y-3 rounded-xl border border-border/60 p-4 shadow-xs">
                <div class="flex items-center gap-3">
                  <Skeleton class="h-4 flex-1" /><Skeleton class="size-3 rounded-full" />
                </div>
                <Skeleton class="h-3 w-full" />
                <div class="flex items-center justify-between pt-1">
                  <Skeleton class="size-4 rounded-sm" /><Skeleton class="h-3 w-6" />
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {:else}
      {#if grouped}<div class="flex h-10 items-center px-3"><Skeleton class="h-3 w-20" /></div>{/if}
      {#each Array.from({ length: count }, (_, index) => index) as index (index)}
        <div
          class={rows === 'compact'
            ? 'flex min-h-6 items-center gap-2 py-1'
            : `flex h-12 items-center gap-3 border-b border-border/50 ${rows === 'integration' ? 'px-2' : 'px-3'}`}
        >
          <Skeleton class="size-4 shrink-0 rounded-sm" />
          <Skeleton class="h-4 min-w-0 flex-1" />
          {#if rows === 'workspace'}
            <Skeleton class="size-3 shrink-0 rounded-full" />
          {:else if rows === 'integration'}
            <Skeleton class="size-5 shrink-0 rounded-full" />
          {/if}
          {#if rows !== 'compact'}
            <Skeleton class="h-3 w-6 shrink-0" />
          {/if}
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
