<script lang="ts">
  import { Skeleton } from '$lib/components/ui/skeleton';

  /**
   * WorkspaceCardSkeleton - Indeterminate loading placeholder for workspace cards.
   *
   * Mimics the compact WorkspaceCard footprint with pulse-animated skeleton
   * elements styled with existing Tailwind conventions. Used in AllWorkspacesCard
   * and ActiveWorkspacesCard while workspace list is loading.
   */
</script>

<div class="workspace-card-skeleton px-3 py-1.5 flex items-center gap-2 min-w-0" data-testid="workspace-card-skeleton" aria-hidden="true">
  <!-- Avatar skeleton (circle) -->
  <Skeleton class="size-6 rounded-full shrink-0" />

  <!-- Title and metadata skeleton -->
  <div class="flex-1 min-w-0 flex flex-col gap-1">
    <!-- Title bar -->
    <Skeleton class="h-3.5" style="width: 70%;" />
    <!-- Metadata/subtitle bar (shorter) -->
    <Skeleton class="h-2.5" style="width: 50%;" />
  </div>
</div>

<style>
  @container (max-width: 160px) {
    .workspace-card-skeleton {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
  }
</style>
