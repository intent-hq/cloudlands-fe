<script lang="ts">
  import { page } from '$app/state';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectWorkspaceById,
    selectWorkspaceItems,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectActiveWorkspaceIds } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import RetainedWorkspaceSurfaces from './RetainedWorkspaceSurfaces.svelte';
  import WorkspaceSurface from './WorkspaceSurface.svelte';

  const workspaceId = $derived((page.params?.id as string | undefined) ?? '');
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const workspaceItems$ = selectWorkspaceItems();
  const openWorkspaceIds$ = selectActiveWorkspaceIds();
</script>

<svelte:head>
  <title
    >{workspaceId === 'new' || workspaceId.startsWith('optimistic-')
      ? m.workspace_page_newSpace_title()
      : $workspace$?.title || m.workspace_page_space_title()}</title
  >
</svelte:head>

<RetainedWorkspaceSurfaces
  activeWorkspaceId={workspaceId}
  openWorkspaceIds={$openWorkspaceIds$}
  workspaceEntityIds={$workspaceItems$.map((workspace) => workspace.id)}
>
  {#snippet children(retainedWorkspaceId: string, active: boolean)}
    <WorkspaceSurface workspaceId={retainedWorkspaceId} {active} />
  {/snippet}
</RetainedWorkspaceSurfaces>
