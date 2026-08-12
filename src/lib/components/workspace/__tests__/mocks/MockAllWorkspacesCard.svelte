<script lang="ts">
  let {
    recentsOnly = false,
    recentLimit,
    searchRecents = false,
    expandableRecents = false,
    excludedWorkspaceIds = [],
    showLoadingText = true,
  }: {
    recentsOnly?: boolean;
    recentLimit?: number;
    searchRecents?: boolean;
    expandableRecents?: boolean;
    excludedWorkspaceIds?: readonly string[];
    showLoadingText?: boolean;
  } = $props();
</script>

<div
  data-testid="mock-all-workspaces-card"
  data-recents-only={recentsOnly}
  data-recent-limit={recentLimit}
  data-search-recents={searchRecents}
  data-expandable-recents={expandableRecents}
  data-excluded-workspace-ids={excludedWorkspaceIds.join(',')}
  data-show-loading-text={showLoadingText}
></div>
