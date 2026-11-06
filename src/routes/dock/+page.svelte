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
  import { selectDockShortcut } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import DockConversation from '$features/hud/components/DockConversation.svelte';
  import { openDockConversation, choosePendingDockShortcut } from '$features/hud/dock-navigation';
  import { showDockContextMenu } from '$features/hud/dock-context-menu';
  import { wantsDockContextMenu } from '$features/hud/dock-context-target';
  import { initDockIntro } from '$features/hud/intro/dock-intro.svelte';
  import { selectDockConversationWorkspaceId } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    openDockConversationRequested,
    closeDockConversationRequested,
    dockEvidenceRecordToggleRequested,
    dockShortcutChanged,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { startAppStoreLifecycle } from '$store/renderer/app-store-lifecycle';
  import {
    selectDockWorkspaces,
    selectDockRecordingIndicator,
    selectDockMachineSwitch,
    selectDockPlacement,
    selectDockFocusRequest,
    selectDockCloseRequest,
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
  const recording$ = selectDockRecordingIndicator();
  let stoppingClipId = $state<string | null>(null);
  $effect(() => {
    if ($recording$?.clipId !== stoppingClipId) stoppingClipId = null;
  });
  function stopRecording() {
    const shown = $recording$,
      current = selectDockRecordingIndicator.select(appStore.state);
    if (
      !shown ||
      !current ||
      stoppingClipId ||
      shown.clipId !== current.clipId ||
      shown.workspaceId !== current.workspaceId ||
      shown.agentId !== current.agentId
    )
      return;
    stoppingClipId = current.clipId;
    appStore.dispatch(
      dockEvidenceRecordToggleRequested(current.workspaceId, current.agentId, current.clipId),
    );
  }
  const placement$ = selectDockPlacement();
  const focusRequest$ = selectDockFocusRequest();
  const closeRequest$ = selectDockCloseRequest();
  const placementError$ = selectDockPlacementError();
  const dragStartResult$ = selectDockDragStartResult();
  const resizeStartResult$ = selectDockResizeStartResult();
  const shortcut$ = selectDockShortcut();
  const conversationWorkspaceId$ = selectDockConversationWorkspaceId();
  const choosingWorkspace = $derived(
    !!$shortcut$ && !$shortcut$.destination && !$shortcut$.resolving,
  );
  function cancelPendingShortcut() {
    if ($shortcut$?.destination === null) appStore.dispatch(dockShortcutChanged(null));
  }
  function openHomeConversation(workspaceId: string) {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous intent selection and store dispatch only
    if (!choosePendingDockShortcut(workspaceId))
      appStore.dispatch(openDockConversationRequested(workspaceId));
  }

  onMount(() => {
    // First run: the notch opens with its "Meet the notch" card until dismissed.
    initDockIntro();
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

<!-- Right-click anywhere on the dock opens its native menu (move, hide); text fields
     and the open conversation keep their normal edit menu. -->
<svelte:window
  onblur={cancelPendingShortcut}
  oncontextmenu={(event) => {
    if (!$placement$ || !wantsDockContextMenu(event.target)) return;
    event.preventDefault();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget request for a main-owned native menu; nothing is loaded
    showDockContextMenu();
  }}
/>

<Screen class="fixed inset-0 overflow-clip bg-transparent" data-testid="dock-route">
  {#if $placement$}
    <DockRail
      recording={$recording$}
      recordingStopping={stoppingClipId !== null}
      onStopRecording={stopRecording}
      workspaces={$dockWorkspaces$}
      {machines}
      machineId={$currentConnectionId$}
      machineSwitching={$machineSwitch$.pending}
      machineError={$machineSwitch$.error}
      onMachine={(id) => appStore.dispatch(dockMachineSwitchRequested(id))}
      placement={$placement$}
      focusRequest={$focusRequest$}
      closeRequest={$closeRequest$}
      placementError={$placementError$}
      dragStartResult={$dragStartResult$}
      resizeStartResult={$resizeStartResult$}
      conversationWorkspaceId={choosingWorkspace ? null : $conversationWorkspaceId$}
      {conversation}
      onOpenConversation={openHomeConversation}
      onHomeDismiss={cancelPendingShortcut}
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
