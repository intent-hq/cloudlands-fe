<script lang="ts">
  import RetainedWorkspaceSurfaces from './RetainedWorkspaceSurfaces.svelte';

  let {
    activeWorkspaceId,
    openWorkspaceIds,
    workspaceEntityIds,
  }: {
    activeWorkspaceId: string;
    openWorkspaceIds: string[];
    workspaceEntityIds: string[];
  } = $props();
</script>

<RetainedWorkspaceSurfaces {activeWorkspaceId} {openWorkspaceIds} {workspaceEntityIds}>
  {#snippet children(workspaceId: string, active: boolean)}
    <button
      type="button"
      data-workspace-content={workspaceId}
      data-workspace-content-active={active}
    >
      {workspaceId}
    </button>
  {/snippet}
</RetainedWorkspaceSurfaces>
