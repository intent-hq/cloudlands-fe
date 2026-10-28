<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectWorkspaceById,
    selectWorkspaceItems,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectActiveWorkspaceIds } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { selectBrowserWorkspaceIds } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import RetainedWorkspaceSurfaces from './RetainedWorkspaceSurfaces.svelte';
  import WorkspaceSurface from './WorkspaceSurface.svelte';
  import { selectWorkspaceLoadState } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { createWorkspaceDeepLinkConsumer } from './workspace-deep-link';

  const workspaceId = $derived((page.params?.id as string | undefined) ?? '');
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const workspaceItems$ = selectWorkspaceItems();
  const openWorkspaceIds$ = selectActiveWorkspaceIds();
  const browserWorkspaceIds$ = selectBrowserWorkspaceIds();
  const workspaceLoadState$ = selectWorkspaceLoadState(workspaceIdStore);

  // `?note=<id>` / `?agent=<id>` open that note or agent chat once the
  // workspace is ready (cross-workspace note links and sandbox deep links).
  const consumeDeepLink = createWorkspaceDeepLinkConsumer({
    dispatch: (action) => appStore.dispatch(action),
    replaceUrl: (url) => replaceState(url, page.state),
  });
  $effect(() => {
    const url = page.url;
    const status = $workspaceLoadState$.status;
    const id = workspaceId;
    untrack(() => consumeDeepLink(id, url, status));
  });
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
  browserWorkspaceIds={$browserWorkspaceIds$}
  workspaceEntityIds={$workspaceItems$.map((workspace) => workspace.id)}
>
  {#snippet children(retainedWorkspaceId: string, active: boolean)}
    <WorkspaceSurface workspaceId={retainedWorkspaceId} {active} />
  {/snippet}
</RetainedWorkspaceSurfaces>
