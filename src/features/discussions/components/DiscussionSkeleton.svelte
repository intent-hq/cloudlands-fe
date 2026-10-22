<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { m } from '$shared/paraglide/messages.js';
  const rows = [
    { label: 60, width: 300, height: 54 },
    { label: 48, width: 260, height: 34 },
    { label: 72, width: 310, height: 74 },
    { label: 54, width: 240, height: 34 },
  ];
</script>

<div
  class="flex flex-col gap-[18px]"
  role="status"
  aria-label={m.workspace_discussion_loading_label()}
  data-discussion-skeleton
>
  {#each rows as row}
    <div class="flex min-w-0 items-start gap-3" aria-hidden="true">
      <Skeleton class="size-8 shrink-0 rounded-full" />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton class="h-2.5 rounded" style={`width:${row.label}px;max-width:100%`} />
        <Skeleton
          class="rounded-lg"
          style={`height:${row.height}px;width:${row.width}px;max-width:100%`}
        />
      </div>
    </div>
  {/each}
</div>
