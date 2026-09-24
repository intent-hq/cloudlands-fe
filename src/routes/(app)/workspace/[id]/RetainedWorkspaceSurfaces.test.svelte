<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import RetainedWorkspaceSurfaces from './RetainedWorkspaceSurfaces.svelte';

  let {
    activeWorkspaceId,
    openWorkspaceIds,
    workspaceEntityIds,
    browserWorkspaceIds = [],
  }: {
    activeWorkspaceId: string;
    openWorkspaceIds: string[];
    workspaceEntityIds: string[];
    browserWorkspaceIds?: string[];
  } = $props();
</script>

<RetainedWorkspaceSurfaces
  {activeWorkspaceId}
  {openWorkspaceIds}
  {workspaceEntityIds}
  {browserWorkspaceIds}
>
  {#snippet children(workspaceId: string, active: boolean)}
    <Button data-workspace-content={workspaceId} data-workspace-content-active={active}>
      {workspaceId}
    </Button>
  {/snippet}
</RetainedWorkspaceSurfaces>
