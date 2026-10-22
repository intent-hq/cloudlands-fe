<script lang="ts">
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
</script>

<div
  class="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground"
  data-workspace-sidebar-skeleton
>
  <div class="shrink-0 space-y-3 px-5 pt-5 pb-4" data-loading-workspace-header>
    <Skeleton class="h-5 w-3/4 rounded-md bg-sidebar-foreground/10" />
    <div class="flex gap-3">
      <Skeleton class="h-3 w-2/5 rounded-md bg-sidebar-foreground/10" />
      <Skeleton class="h-3 w-1/3 rounded-md bg-sidebar-foreground/10" />
    </div>
  </div>
  <div class="flex shrink-0 justify-between px-5 py-2" data-loading-sidebar-navigation>
    {#each Array(6) as _, index (index)}
      <Skeleton class="size-5 rounded-md bg-sidebar-foreground/10" />
    {/each}
  </div>
  <div class="min-h-0 flex-1 space-y-4 overflow-hidden px-5 py-5" data-loading-workspace-activity>
    <Skeleton class="h-4 w-1/3 rounded-md bg-sidebar-foreground/10" />
    {#each ['78%', '64%', '72%', '58%'] as width (width)}
      <div class="flex items-center gap-3">
        <Skeleton class="size-5 shrink-0 rounded-full bg-sidebar-foreground/10" />
        <Skeleton
          class="h-3 flex-1 rounded-md bg-sidebar-foreground/10"
          style="max-width: {width};"
        />
      </div>
    {/each}
  </div>
</div>
