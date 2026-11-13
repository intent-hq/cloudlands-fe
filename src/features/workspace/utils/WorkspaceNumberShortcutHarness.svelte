<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';
  import MachineRail from '$features/machine-rail/MachineRail.svelte';
  import { isTerminalPassthroughChord } from '$features/terminal/terminal-app-chords';
  import { disposeXtermAfterViewportSync } from '$features/terminal/utils/xterm-lifecycle';
  import { KeyboardShortcutManager } from '$lib/utils/keyboardShortcuts';
  import { createAppShortcutRegistrar } from '$lib/utils/app-shortcut-registrar';
  import { getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { machineRailStateReceived } from '$store/renderer/slices/machine-rail/machine-rail-slice';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { setShortcutOverride } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { GuestSessionRecord } from '$shared/types/guest-sessions';
  import { registerWorkspaceTabShortcuts } from './workspace-tab-navigation';

  let {
    isMac = false,
    tabBinding,
    settingsBinding,
  }: {
    isMac?: boolean;
    tabBinding?: string;
    settingsBinding?: string;
  } = $props();
  let path = $state('/workspace/beta');
  let requests = $state<string[]>([]);
  let settingsOpened = $state(0);
  let terminalInput = $state('');
  let terminalContainer: HTMLDivElement;
  let machineRail: { getMachineIds(): string[] };
  const disposeStore = appStore.init();
  const currentTab$ = selectCurrentWorkspaceTabId();

  function toggleRail() {
    appStore.dispatch(
      machineRailStateReceived({
        ...appStore.state.machineRail,
        enabled: !appStore.state.machineRail.enabled,
      }),
    );
  }

  function reorder() {
    appStore.dispatch(
      machineRailStateReceived({
        ...appStore.state.machineRail,
        machineIds: ['local', 'guest', 'second', 'build'],
      }),
    );
  }

  function clearDevices() {
    appStore.dispatch(machineRailStateReceived({ ...appStore.state.machineRail, machineIds: [] }));
  }

  onMount(() => {
    appStore.dispatch(
      connectionsListReceived({
        activeId: 'local',
        windowBackendId: 'local',
        connections: ['local', 'build', 'second'].map((id) => ({
          id,
          label: id,
          host: id === 'local' ? null : '10.0.0.1',
          port: id === 'local' ? null : 5181,
          fingerprint: null,
          isLocal: id === 'local',
          status: id === 'build' ? 'disconnected' : 'connected',
        })),
      }),
    );
    appStore.dispatch(
      guestSessionsListReceived({
        sessions: [{ id: 'guest', label: 'Guest host', hostname: 'guest' } as GuestSessionRecord],
        openIds: ['guest'],
        connectedIds: ['guest'],
      }),
    );
    appStore.dispatch(
      machineRailStateReceived({
        enabled: true,
        homeId: 'local',
        machineIds: ['local', 'guest', 'build'],
        selectedId: 'local',
        shownId: 'local',
        pendingId: '',
        degradedIds: [],
      }),
    );
    appStore.dispatch(
      loadWorkspaceTabsState({
        openTabs: ['alpha', 'beta', 'gamma'],
        currentTabId: 'beta',
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: ['alpha', 'beta', 'gamma'],
        workspaceStacks: [['alpha'], ['beta'], ['gamma']],
      }),
    );
    if (tabBinding) appStore.dispatch(setShortcutOverride('navigation.go-to-tab', tabBinding));
    if (settingsBinding) appStore.dispatch(setShortcutOverride('global.settings', settingsBinding));
    const manager = new KeyboardShortcutManager();
    const register = createAppShortcutRegistrar(manager, getEffectiveShortcut);
    register({
      key: ',',
      shortcutId: 'global.settings',
      description: 'Settings',
      action: () => settingsOpened++,
    });
    registerWorkspaceTabShortcuts({
      isMac,
      register,
      store: {
        get state() {
          return appStore.state;
        },
        dispatch(action) {
          if (action.type === 'machineRail/selectRequested' && Array.isArray(action.payload))
            requests = [...requests, String(action.payload[0])];
          appStore.dispatch(action);
        },
      },
      getCurrentPath: () => path,
      navigate: (next) => (path = next),
      openNewWorkspace: () => undefined,
      getRailMachineIds: () => machineRail?.getMachineIds() ?? [],
      resolveBinding: getEffectiveShortcut,
    });
    manager.attach();
    const terminal = new Terminal({ cols: 60, rows: 5 });
    terminal.attachCustomKeyEventHandler(
      (event) =>
        !isTerminalPassthroughChord(
          event,
          appStore.state.userPreferences.shortcutOverrides,
          isMac,
          appStore.state.machineRail.enabled,
        ),
    );
    const onData = terminal.onData((data) => (terminalInput += data));
    terminal.open(terminalContainer);
    return () => {
      manager.destroy();
      onData.dispose();
      disposeXtermAfterViewportSync(terminal);
      disposeStore();
    };
  });
</script>

<div class="flex min-h-80 bg-background text-foreground">
  <MachineRail bind:this={machineRail} />
  <div class="flex flex-col gap-4 p-6">
    <input aria-label="Draft" value="Keep this draft" />
    <div contenteditable="true" role="textbox" aria-label="Editor" tabindex="0">Keep this note</div>
    <button onclick={toggleRail}>Toggle rail</button>
    <button onclick={reorder}>Reorder devices</button>
    <button onclick={clearDevices}>Clear devices</button>
    <div bind:this={terminalContainer} data-testid="terminal"></div>
    <output
      data-testid="result"
      data-path={path}
      data-workspace={$currentTab$}
      data-requests={JSON.stringify(requests)}
      data-settings={settingsOpened}
      data-terminal-input={JSON.stringify(terminalInput)}>{path}</output
    >
  </div>
</div>
