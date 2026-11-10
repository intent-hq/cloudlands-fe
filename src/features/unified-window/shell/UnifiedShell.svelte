<script lang="ts">
  /**
   * The Unified window shell (Labs). It owns everything that spans machines — the
   * title bar, the machine dropdown, the mixed tab strip, groups, the palette, tab
   * shortcuts and the restore record — and asks main to show the right machine view
   * under its title bar. It talks to no daemon itself: workspace rows come from the
   * main-process cross-machine feed.
   */
  import { onDestroy, onMount } from 'svelte';
  import { unifiedInvoke as invoke } from '$lib/unified-ipc';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import { setUnifiedShellOpener } from '$lib/utils/show-workspace';
  import { userPreferencesPersistenceSaga } from '$store/renderer/slices/user-preferences/sagas/user-preferences-persistence-saga';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    selectConnectedIds,
    selectConnections,
  } from '$store/renderer/slices/connections/connections-selectors';
  import {
    selectGuestSessions,
    selectGuestSessionsConnectedIds,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    closeWorkspaceTab,
    loadWorkspaceTabsState,
    openWorkspaceTab,
    reopenLastClosedWorkspaceTab,
    switchToNextWorkspaceTab,
    switchToPreviousWorkspaceTab,
    switchToWorkspaceTabByIndex,
    workspaceTabsHydrated,
  } from '$store/renderer/slices/tab-state/tab-state-slice';
  import {
    selectCurrentWorkspaceTabId,
    selectPersistedWorkspaceTabsState,
    selectWorkspaceTabOrder,
  } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import {
    removeWorkspaceEntity,
    setWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import type { ConnectionsListResult } from '$shared/types/connections';
  import type { GuestSessionsListResult } from '$shared/types/guest-sessions';
  import UnifiedMachineSwitcher from '../components/UnifiedMachineSwitcher.svelte';
  import UnifiedOfflineTab from '../components/UnifiedOfflineTab.svelte';
  import type { UnifiedMachineFeed } from '../unified-feed-types';
  import type { UnifiedMachine } from '../unified-machines';
  import type { UnifiedShortcut } from '../unified-shortcuts';
  import {
    parseUnifiedTabKey,
    unifiedTabKey,
    type UnifiedWindowState,
  } from '../unified-window-state';
  import {
    buildUnifiedMachines,
    feedEntities,
    recordFromTabState,
    shellSelection,
    tabsByMachine,
    tabStateFromRecord,
    tabsToCloseForDeletedWorkspaces,
  } from './unified-shell-model';

  const UNIFIED = IPC_CHANNELS.UNIFIED;

  const connections$ = selectConnections();
  const connectedIds$ = selectConnectedIds();
  const guestSessions$ = selectGuestSessions();
  const guestConnectedIds$ = selectGuestSessionsConnectedIds();
  const currentTabId$ = selectCurrentWorkspaceTabId();
  const tabOrder$ = selectWorkspaceTabOrder();

  let feeds = $state<UnifiedMachineFeed[]>([]);
  let dropdownMachineId = $state('local');
  let page = $state<'tab' | 'home' | 'settings'>('home');
  let paletteOpen = $state(false);
  let hydrated = $state(false);
  let contentElement = $state<HTMLElement | null>(null);
  /** A route to show once for a tab (a link that targets a note in the workspace). */
  const pendingRoutes = new Map<string, string>();
  let entityIds = new Set<string>();

  const machines = $derived(
    buildUnifiedMachines({
      connections: $connections$,
      connectedIds: $connectedIds$,
      guestSessions: $guestSessions$,
      guestConnectedIds: $guestConnectedIds$,
      localLabel: m.layout_daemonStatus_localConnection_label(),
    }),
  );
  const machineById = $derived(new Map(machines.map((machine) => [machine.id, machine])));
  const activeTabKey = $derived(page === 'tab' ? $currentTabId$ : null);

  function tabMachine(key: string): UnifiedMachine | null {
    const ref = parseUnifiedTabKey(key);
    return ref ? (machineById.get(ref.machineId) ?? null) : null;
  }

  const selection = $derived(
    shellSelection(activeTabKey, page === 'settings' ? 'settings' : 'home', dropdownMachineId, machines),
  );

  const windowTitle = $derived.by(() => {
    if (!activeTabKey) return m.home_page_title();
    const ref = parseUnifiedTabKey(activeTabKey);
    const title =
      feeds
        .find((feed) => feed.machineId === ref?.machineId)
        ?.rows.find((row) => row.id === ref?.workspaceId)?.title || '';
    const machine = tabMachine(activeTabKey);
    return machine && machine.kind !== 'local' ? `${title} — ${machine.label}` : title;
  });

  // ── Store bootstrap: preferences only; the shell has no backend sagas. ──
  const stopPreferences = appStore.runSaga(userPreferencesPersistenceSaga);
  onDestroy(stopPreferences);

  async function loadMachines() {
    const [connections, guests] = await Promise.all([
      invoke<ConnectionsListResult>(IPC_CHANNELS.CONNECTIONS.LIST, {}).catch(() => null),
      invoke<GuestSessionsListResult>(IPC_CHANNELS.GUEST_SESSIONS.LIST, {}).catch(() => null),
    ]);
    if (connections) appStore.dispatch(connectionsListReceived(connections));
    if (guests) appStore.dispatch(guestSessionsListReceived(guests));
  }

  function applyFeeds(next: UnifiedMachineFeed[]) {
    feeds = next;
    const entities = feedEntities(next);
    const ids = new Set<string>(entities.map((entity) => entity.id));
    for (const entity of entities) appStore.dispatch(setWorkspaceEntity(entity));
    for (const id of entityIds) if (!ids.has(id)) appStore.dispatch(removeWorkspaceEntity(id));
    entityIds = ids;
    for (const key of tabsToCloseForDeletedWorkspaces($tabOrder$, next))
      appStore.dispatch(closeWorkspaceTab(key));
  }

  function openTab(key: string, route?: string) {
    if (!parseUnifiedTabKey(key)) return;
    if (route) pendingRoutes.set(key, route);
    appStore.dispatch(openWorkspaceTab(key));
    page = 'tab';
  }

  function selectTab(key: string | null) {
    page = key ? 'tab' : 'home';
  }

  function runShortcut(shortcut: UnifiedShortcut) {
    switch (shortcut.command) {
      case 'palette':
        paletteOpen = true;
        return;
      case 'select-index':
        appStore.dispatch(switchToWorkspaceTabByIndex(shortcut.index));
        break;
      case 'select-last':
        appStore.dispatch(switchToWorkspaceTabByIndex($tabOrder$.length - 1));
        break;
      case 'next-tab':
        appStore.dispatch(switchToNextWorkspaceTab());
        break;
      case 'previous-tab':
        appStore.dispatch(switchToPreviousWorkspaceTab());
        break;
      case 'close-tab':
        if (page === 'tab' && $currentTabId$) appStore.dispatch(closeWorkspaceTab($currentTabId$));
        break;
      case 'reopen-tab':
        appStore.dispatch(reopenLastClosedWorkspaceTab());
        break;
    }
    page = selectCurrentWorkspaceTabId.select(appStore.state) ? 'tab' : 'home';
  }

  // ── Show the selection in its machine view (or the offline message). ──
  let shownKey = '';
  $effect(() => {
    if (!hydrated) return;
    const current = selection;
    if (current.kind === 'offline') {
      if (shownKey !== `offline:${current.machine.id}`) {
        shownKey = `offline:${current.machine.id}`;
        void invoke(UNIFIED.HIDE_VIEWS, {}).catch(() => {});
      }
      return;
    }
    const pending = activeTabKey ? pendingRoutes.get(activeTabKey) : undefined;
    const route = pending ?? current.route;
    if (activeTabKey) pendingRoutes.delete(activeTabKey);
    const key = `${current.machineId}:${route}`;
    if (key === shownKey) return;
    shownKey = key;
    void invoke(UNIFIED.SHOW, { machineId: current.machineId, route }).catch(() => {});
  });

  // ── Each machine view keeps its machine's open tabs as hidden tab state. ──
  $effect(() => {
    if (!hydrated) return;
    void invoke(UNIFIED.SET_TABS, { tabs: tabsByMachine($tabOrder$) }).catch(() => {});
  });

  // ── Persist the restore record (debounced). ──
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (!hydrated) return;
    $tabOrder$;
    $currentTabId$;
    const machine = dropdownMachineId;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const record = recordFromTabState(
        selectPersistedWorkspaceTabsState.select(appStore.state),
        machine,
      );
      void invoke(UNIFIED.SAVE_STATE, { state: record }).catch(() => {});
    }, 400);
  });
  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
  });

  // ── Views sit exactly under the title bar, in the content area. ──
  $effect(() => {
    const element = contentElement;
    if (!element) return;
    const report = () => {
      const rect = element.getBoundingClientRect();
      void invoke(UNIFIED.SET_CONTENT_BOUNDS, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }).catch(() => {});
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    report();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  });

  // ── Shell overlays (menus, dialogs, palette) must show above the machine view. ──
  // Views are native layers drawn over the shell, so while an overlay is open the
  // view hides and a snapshot of it is painted in its place.
  let overlaySnapshot = $state<string | null>(null);
  let overlayOpen = false;
  const OVERLAY_SELECTOR = '[role="menu"], [role="dialog"], [role="listbox"], [role="alertdialog"]';
  $effect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      const open = document.querySelector(OVERLAY_SELECTOR) !== null;
      if (open === overlayOpen) return;
      overlayOpen = open;
      if (!open) overlaySnapshot = null;
      void invoke<{ snapshot: string | null }>(UNIFIED.SET_OVERLAY, { open })
        .then((result) => {
          if (overlayOpen && open) overlaySnapshot = result?.snapshot ?? null;
        })
        .catch(() => {});
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(sync);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  });

  // The machines menu's status dot follows the dropdown machine (the shell itself
  // talks to no daemon).
  $effect(() => {
    const online = machineById.get(dropdownMachineId)?.online ?? false;
    appStore.dispatch(connectionStatusChanged(online ? 'connected' : 'disconnected'));
  });

  function chooseMachine(machineId: string) {
    dropdownMachineId = machineId;
    if (!machineById.get(machineId)?.online)
      void invoke(UNIFIED.CONNECT, { machineId }).catch(() => {});
    if (page === 'tab') page = 'home';
  }

  function handleKeydown(event: KeyboardEvent) {
    const mod = navigator.platform.toLowerCase().includes('mac') ? event.metaKey : event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      paletteOpen = true;
    }
  }

  interface BridgeLike {
    on(channel: string, handler: (payload: unknown) => void): string;
    offById(channel: string, listenerId: string): void;
  }
  const bridge = (globalThis as { electronAPI?: BridgeLike }).electronAPI ?? null;
  const listeners: Array<[string, string]> = [];
  // Main-process pushes go straight through the preload bridge (main owns this state).
  function listen(channel: string, handler: (payload: unknown) => void) {
    if (bridge) listeners.push([channel, bridge.on(channel, handler)]);
  }

  onMount(() => {
    setUnifiedShellOpener((key) => openTab(key));
    listen(UNIFIED.FEED_CHANGED, (payload) => applyFeeds(payload as UnifiedMachineFeed[]));
    listen(UNIFIED.OPEN_REQUEST, (payload) => {
      const request = payload as { machineId: string; workspaceId: string; route?: string };
      openTab(unifiedTabKey(request.machineId, request.workspaceId), request.route);
    });
    listen(UNIFIED.SHORTCUT, (payload) => runShortcut(payload as UnifiedShortcut));
    listen(IPC_CHANNELS.CONNECTIONS.CHANGED, (payload) =>
      appStore.dispatch(connectionsListReceived(payload as ConnectionsListResult)),
    );
    listen(IPC_CHANNELS.GUEST_SESSIONS.CHANGED, (payload) =>
      appStore.dispatch(guestSessionsListReceived(payload as GuestSessionsListResult)),
    );
    window.addEventListener('keydown', handleKeydown);

    void (async () => {
      await loadMachines();
      const [state, initialFeeds] = await Promise.all([
        invoke<UnifiedWindowState | null>(UNIFIED.GET_STATE, {}).catch(() => null),
        invoke<UnifiedMachineFeed[]>(UNIFIED.GET_FEED, {}).catch(() => []),
      ]);
      applyFeeds(initialFeeds ?? []);
      if (state) {
        dropdownMachineId = state.dropdownMachineId;
        appStore.dispatch(loadWorkspaceTabsState(tabStateFromRecord(state)));
        page = state.activeTabKey ? 'tab' : 'home';
      }
      appStore.dispatch(workspaceTabsHydrated('unified'));
      hydrated = true;
    })();
  });

  onDestroy(() => {
    setUnifiedShellOpener(null);
    for (const [channel, id] of listeners) bridge?.offById(channel, id);
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#snippet machineSwitcher()}
  <UnifiedMachineSwitcher {machines} selectedId={dropdownMachineId} onselect={chooseMachine} />
{/snippet}

<div class="flex h-screen w-screen flex-col overflow-hidden text-foreground" data-unified-shell>
  <WindowTitleBar
    {machineSwitcher}
    {tabMachine}
    activeTabId={activeTabKey}
    unifiedShell={{
      title: windowTitle,
      homeActive: page === 'home',
      settingsActive: page === 'settings',
      onHome: () => (page = 'home'),
      onSettings: () => (page = page === 'settings' ? 'home' : 'settings'),
      onNewWorkspace: () => {
        page = 'home';
        void invoke(UNIFIED.SHOW, { machineId: dropdownMachineId, route: '/workspace/new' });
        shownKey = `${dropdownMachineId}:/workspace/new`;
      },
      selectTab,
    }}
  />
  <div class="relative min-h-0 flex-1" bind:this={contentElement} data-unified-content>
    {#if overlaySnapshot && selection.kind !== 'offline'}
      <img
        src={overlaySnapshot}
        alt=""
        class="pointer-events-none absolute inset-0 h-full w-full select-none"
        draggable="false"
        data-unified-view-snapshot
      />
    {/if}
    {#if selection.kind === 'offline'}
      <div class="h-full p-2 pt-0">
        <div class="h-full rounded-lg bg-background">
          <UnifiedOfflineTab machine={selection.machine} />
        </div>
      </div>
    {/if}
  </div>
</div>

<CommandPalette
  bind:isOpen={paletteOpen}
  workspaceMachine={tabMachine}
  onClose={() => (paletteOpen = false)}
/>
