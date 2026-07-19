<script lang="ts">
  /**
   * WorkspaceCardSkeleton - Indeterminate loading placeholder for workspace cards.
   *
   * Mimics the compact WorkspaceCard footprint with pulse-animated skeleton
   * elements styled with existing Tailwind conventions. Used in AllWorkspacesCard
   * and ActiveWorkspacesCard while workspace list is loading.
   */
</script>

<div class="workspace-card-skeleton px-3 py-1.5 flex items-center gap-2 min-w-0" data-testid="workspace-card-skeleton">
  <!-- Avatar skeleton (circle) -->
  <div class="size-6 rounded-full bg-muted/20 shrink-0 animate-pulse"></div>

  <!-- Title and metadata skeleton -->
  <div class="flex-1 min-w-0 flex flex-col gap-1">
    <!-- Title bar -->
    <div class="h-3.5 bg-muted/20 rounded animate-pulse" style="width: 70%;"></div>
    <!-- Metadata/subtitle bar (shorter) -->
    <div class="h-2.5 bg-muted/15 rounded animate-pulse" style="width: 50%;"></div>
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
