<script lang="ts">
  import { page } from '$app/state';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import WorkspaceSurface from './WorkspaceSurface.svelte';

  const workspaceId = $derived((page.params?.id as string | undefined) ?? '');
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const workspace$ = selectWorkspaceById(workspaceIdStore);
</script>

<svelte:head>
  <title
    >{workspaceId === 'new'
      ? m.workspace_page_newSpace_title()
      : $workspace$?.title || m.workspace_page_space_title()}</title
  >
</svelte:head>

<WorkspaceSurface {workspaceId} />
