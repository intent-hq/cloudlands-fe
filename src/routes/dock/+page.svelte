<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import '$store/renderer/seeders';
  import DockRail from '$features/hud/components/DockRail.svelte';
  import DockConversation from '$features/hud/components/DockConversation.svelte';
  import { openDockConversation } from '$features/hud/dock-navigation';
  import { selectDockConversationWorkspaceId } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    openDockConversationRequested,
    closeDockConversationRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';
  import {
    selectDockWorkspaces,
    selectDockPlacement,
    selectDockFocusRequest,
    selectDockPlacementError,
    selectDockDragStartResult,
    selectDockResizeStartResult,
  } from '$store/renderer/slices/hud/hud-selectors';
  import {
    dockActivated,
    hudDeactivated,
    dockPlacementCommandRequested,
  } from '$store/renderer/slices/hud/hud-slice';
  import { loadWorkspacesRequested } from '$store/renderer/slices/workspace/workspace-slice';
  import { store as appStore } from '$store/renderer/store';

  const disposeAppStore = startAppStoreLifecycle(appStore, import.meta.hot?.data);
  onDestroy(() => {
    appStore.dispatch(closeDockConversationRequested());
    disposeAppStore();
  });
  const dockWorkspaces$ = selectDockWorkspaces();
  const placement$ = selectDockPlacement();
  const focusRequest$ = selectDockFocusRequest();
  const placementError$ = selectDockPlacementError();
  const dragStartResult$ = selectDockDragStartResult();
  const resizeStartResult$ = selectDockResizeStartResult();
  const conversationWorkspaceId$ = selectDockConversationWorkspaceId();

  onMount(() => {
    document.documentElement.classList.add('dock-route-active');
    document.getElementById('dock-bootstrap-bar')?.remove();
    document.getElementById('splash')?.remove();
    document.getElementById('app-drag-region')?.remove();
    appStore.dispatch(loadWorkspacesRequested());
    appStore.dispatch(dockActivated());
    return () => {
      document.documentElement.classList.remove('dock-route-active');
      appStore.dispatch(hudDeactivated());
    };
  });
</script>

{#snippet conversation()}
  <DockConversation onOpenWorkspace={openDockConversation} />
{/snippet}

<Screen class="fixed inset-0 overflow-clip bg-transparent" data-testid="dock-route">
  {#if $placement$}
    <DockRail
      workspaces={$dockWorkspaces$}
      placement={$placement$}
      focusRequest={$focusRequest$}
      placementError={$placementError$}
      dragStartResult={$dragStartResult$}
      resizeStartResult={$resizeStartResult$}
      conversationWorkspaceId={$conversationWorkspaceId$}
      {conversation}
      onOpenConversation={(workspaceId) =>
        appStore.dispatch(openDockConversationRequested(workspaceId))}
      onCloseConversation={() => appStore.dispatch(closeDockConversationRequested())}
      onPlacementCommand={(command) => appStore.dispatch(dockPlacementCommandRequested(command))}
    />
  {/if}
</Screen>

<style>
  :global(html.dock-route-active),
  :global(html.dock-route-active body),
  :global(html.dock-route-active #app) {
    width: 100%;
    height: 100%;
    overflow: clip;
    background: transparent !important;
  }
</style>
