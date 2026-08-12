<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';

  const TITLE_WIDTHS = ['68%', '54%', '72%', '61%', '47%'] as const;

  let { index = 0 }: { index?: number } = $props();
  const titleWidth = $derived(TITLE_WIDTHS[index % TITLE_WIDTHS.length]);

  /**
   * WorkspaceCardSkeleton - Indeterminate loading placeholder for workspace cards.
   *
   * Mimics the compact WorkspaceCard footprint with pulse-animated skeleton
   * elements styled with existing Tailwind conventions. Used in AllWorkspacesCard
   * and ActiveWorkspacesCard while workspace list is loading.
   */
</script>

<div
  class="workspace-card-skeleton flex min-w-0 items-center gap-2.5 px-3 py-2"
  data-testid="workspace-card-skeleton"
  aria-hidden="true"
>
  <!-- Phase indicator skeleton (circle) -->
  <Skeleton class="size-2.5 shrink-0 rounded-full bg-sidebar-foreground/10" />

  <!-- Title skeleton (single line) -->
  <Skeleton
    class="h-2.5 flex-1 rounded-full bg-sidebar-foreground/10"
    style="max-width: {titleWidth};"
    data-workspace-skeleton-title
  />
</div>

<style>
  @container (max-width: 160px) {
    .workspace-card-skeleton {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
