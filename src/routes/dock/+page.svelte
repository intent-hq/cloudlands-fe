<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    selectConnections,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { DOCK_BACKEND_SWITCH_FAILED_QUERY } from '$shared/dock-connection';
  import { formatConnectionLabel } from '$lib/utils/connection-label';
  import { m } from '$shared/paraglide/messages.js';
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
    selectDockMachineSwitch,
    selectDockPlacement,
    selectDockFocusRequest,
    selectDockPlacementError,
    selectDockDragStartResult,
    selectDockResizeStartResult,
  } from '$store/renderer/slices/hud/hud-selectors';
  import {
    dockActivated,
    dockMachineSwitchRequested,
    dockMachineSwitchRestored,
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
  const connections$ = selectConnections();
  const currentConnectionId$ = selectCurrentConnectionId();
  const machineSwitch$ = selectDockMachineSwitch();
  const machines = $derived(
    $connections$.map((connection) => ({
      id: connection.id,
      label: connection.isLocal
        ? m.layout_daemonStatus_localConnection_label()
        : formatConnectionLabel(connection),
    })),
  );
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
    const url = new URL(window.location.href);
    if (url.searchParams.has(DOCK_BACKEND_SWITCH_FAILED_QUERY)) {
      appStore.dispatch(dockMachineSwitchRestored());
      url.searchParams.delete(DOCK_BACKEND_SWITCH_FAILED_QUERY);
      window.history.replaceState(window.history.state, '', url);
    }
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
      {machines}
      machineId={$currentConnectionId$}
      machineSwitching={$machineSwitch$.pending}
      machineError={$machineSwitch$.error}
      onMachine={(id) => appStore.dispatch(dockMachineSwitchRequested(id))}
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
