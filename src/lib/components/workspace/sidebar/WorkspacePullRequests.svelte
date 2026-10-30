<script lang="ts">
  import { ensureWorkspacePullRequestPool } from '$features/workspace/workspace-detail-hydration';
  import { handleLink } from '$features/navigation/link-handler';
  import { Button } from '$lib/components/ui/button';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarPrList from './SidebarPrList.svelte';
  import TimelineSection from './TimelineSection.svelte';
  import type { WorkspacePRPresentationRow } from './workspace-pr-presentation';

  let {
    workspaceId,
    rows,
    truncated = false,
    active = true,
  }: {
    workspaceId: string;
    rows: WorkspacePRPresentationRow[];
    truncated?: boolean;
    active?: boolean;
  } = $props();

  let refreshing = $state(false);
  let failed = $state(false);
  let retry = $state(0);

  $effect(() => {
    const target = workspaceId;
    void retry;
    failed = false;
    refreshing = false;
    if (!active || !truncated) return;
    let cancelled = false;
    refreshing = true;
    void ensureWorkspacePullRequestPool(target)
      .then((workspace) => {
        if (!cancelled)
          failed =
            !workspace ||
            (workspace.pullRequestsTotal ?? 0) > (workspace.pullRequests?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) failed = true;
      })
      .finally(() => {
        if (!cancelled) refreshing = false;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if rows.length || truncated}
  <section data-workspace-pull-requests aria-label={m.workspace_prSection_pullRequests_label()}>
    <TimelineSection title={m.workspace_prSection_pullRequests_label()}>
      <SidebarPrList
        {rows}
        inline
        onSelect={(pr) => handleLink(pr.url, { workspaceId: WorkspaceId(workspaceId) })}
      />
      {#if refreshing}
        <div role="status" class="px-2 py-1 type-caption text-muted-foreground">
          {m.workspace_sidebarPrDropdown_refreshing_label()}
        </div>
      {:else if failed}
        <div role="status" class="px-2 py-1 type-caption text-muted-foreground">
          {m.workspace_sidebarPrDropdown_refreshFailed_error()}
        </div>
        <Button variant="ghost" size="compact" onclick={() => retry++}>
          {m.workspace_repoSelector_retrySuggestions_label()}
        </Button>
      {/if}
    </TimelineSection>
  </section>
{/if}
