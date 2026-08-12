<script lang="ts">
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div
  class="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground"
  data-workspace-sidebar-skeleton
>
  <div class="flex-none space-y-4 px-6 pb-2 pt-5" data-loading-workspace-header>
    <Skeleton class="h-5 w-3/4 rounded-full bg-sidebar-foreground/10" />
    <div class="flex gap-3">
      <Skeleton class="h-3 w-2/5 rounded-full bg-sidebar-foreground/10" />
      <Skeleton class="h-3 w-1/3 rounded-full bg-sidebar-foreground/10" />
    </div>
    <Skeleton class="h-10 w-full rounded-md bg-sidebar-foreground/10" />
  </div>

  <div class="min-h-0 flex-1 space-y-4 overflow-hidden px-6 py-5" data-loading-workspace-activity>
    <Skeleton class="h-3 w-4/5 rounded-full bg-sidebar-foreground/10" />
    <Skeleton class="h-3 w-3/5 rounded-full bg-sidebar-foreground/10" />
    <div class="space-y-4 pt-4">
      {#each ['78%', '64%', '72%'] as width (width)}
        <div class="flex items-center gap-3">
          <Skeleton class="size-3 shrink-0 rounded-full bg-sidebar-foreground/10" />
          <Skeleton
            class="h-3 flex-1 rounded-full bg-sidebar-foreground/10"
            style="max-width: {width};"
          />
        </div>
      {/each}
    </div>
  </div>

  <div class="flex-none space-y-3 px-6 pb-3" data-loading-sidebar-launchers>
    <div class="grid h-56 grid-cols-2 gap-3">
      {#each Array(4) as _, index (index)}
        <div
          class="flex min-h-0 flex-col justify-between rounded-lg border border-border bg-card p-3"
          data-loading-sidebar-card
        >
          <Skeleton class="size-4 rounded-full bg-sidebar-foreground/10" />
          <Skeleton class="h-3 w-3/5 rounded-full bg-sidebar-foreground/10" />
        </div>
      {/each}
    </div>
    <div class="grid h-20 grid-cols-2 gap-3">
      {#each Array(2) as _, index (index)}
        <div
          class="flex items-center justify-between rounded-lg border border-border bg-card p-3"
          data-loading-sidebar-card
        >
          <Skeleton class="h-3 w-2/5 rounded-full bg-sidebar-foreground/10" />
          <Skeleton class="size-3 rounded-full bg-sidebar-foreground/10" />
        </div>
      {/each}
    </div>
  </div>
</div>
