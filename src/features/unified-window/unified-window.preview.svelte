<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store } from '$store/renderer/configured-store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
  import { setLabsTabGroupsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    connectionStatusChanged,
    systemStatusSuccess,
  } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { setupPaletteNoteSearch } from '../../test/fixtures/command-palette-note-search-fixture';
  import {
    BUILD_BOX,
    GUEST,
    GUEST_SESSION,
    LOCAL,
    SAVED_CONNECTIONS,
    STUDIO,
    WORKSPACES,
    tabKey,
    toWorkspace,
  } from './unified-window.preview-fixtures';

  type Scene =
    | 'machines-menu'
    | 'title-bar'
    | 'machine-dropdown'
    | 'command-palette'
    | 'offline-tab'
    | 'home'
    | 'labs-setting';

  interface UnifiedWindowPreviewProps {
    scene: Scene;
    /** Machines menu: show the Labs "Unified window" item. */
    flag?: boolean;
    /** Title bar: tab keys in strip order, the selected tab, pins and groups. */
    tabs?: string[];
    activeTab?: string;
    groups?: WorkspaceTabGroup[];
    openGroupId?: string | null;
    /** Machine ids treated as offline in this scene. */
    offline?: string[];
  }

  const local = (id: string) => tabKey(LOCAL, id);
  const studio = (id: string) => tabKey(STUDIO, id);
  const guest = (id: string) => tabKey(GUEST, id);
  const buildBox = (id: string) => tabKey(BUILD_BOX, id);

  const MIXED_TABS = [
    studio('deploy'),
    local('onboarding'),
    studio('gpu'),
    guest('tokens'),
    buildBox('nightly'),
  ];
  const PINNED_TABS = [studio('deploy')];
  const releaseGroup: WorkspaceTabGroup = {
    id: 'release',
    name: 'Release',
    color: 'blue',
    workspaceIds: [local('onboarding'), studio('deploy')],
  };
  const GROUPED_TABS = [
    local('onboarding'),
    studio('deploy'),
    studio('gpu'),
    guest('tokens'),
    buildBox('nightly'),
  ];

  function seedWorkspaces() {
    for (const workspace of WORKSPACES) store.dispatch(setWorkspaceEntity(toWorkspace(workspace)));
  }

  function seedTabs(
    tabs: string[],
    activeTab: string,
    groups: WorkspaceTabGroup[] = [],
    openGroupId: string | null = null,
  ) {
    return () => {
      seedHealth();
      seedWorkspaces();
      store.dispatch(setLabsTabGroupsEnabled(groups.length > 0));
      store.dispatch(
        loadWorkspaceTabsState({
          openTabs: tabs,
          currentTabId: activeTab,
          pinnedTabs: PINNED_TABS.filter((tab) => tabs.includes(tab)),
          unsavedTabs: [],
          optimisticTabs: [],
          tabOrder: tabs,
          tabGroups: groups,
          openTabGroupId: openGroupId,
        }),
      );
    };
  }

  function seedMachinesMenu() {
    seedHealth();
    seedConnections();
  }

  function seedHealth() {
    store.dispatch(
      connectionStatusChanged('connected', {
        mode: 'sidecar-uds',
        target: '/tmp/unified-window-preview.sock',
        pinnedVersion: '0.9.1',
      }),
    );
    store.dispatch(
      systemStatusSuccess(
        {
          running: true,
          listenMode: 'uds',
          transports: ['uds'],
          port: null,
          clients: 2,
          agents: 1,
          maxAgents: 8,
          version: '0.9.1',
          uptimeSeconds: 5400,
          cpuPercent: 3.2,
          memoryBytes: 157286400,
          fingerprint: null,
          protocolVersion: '2.5',
          host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
        },
        new Date().toISOString(),
        selectDaemonConnectionGeneration.select(store.state),
      ),
    );
  }

  function seedConnections() {
    store.dispatch(
      connectionsListReceived({
        connections: SAVED_CONNECTIONS,
        activeId: 'local',
        windowBackendId: 'local',
        connectedIds: ['local', 'studio'],
      }),
    );
    store.dispatch(
      guestSessionsListReceived({
        sessions: [GUEST_SESSION],
        openIds: [GUEST_SESSION.id],
        connectedIds: [GUEST_SESSION.id],
      }),
    );
  }

  function seedPalette() {
    seedWorkspaces();
    return setupPaletteNoteSearch();
  }

  const titleBar = (props: Partial<UnifiedWindowPreviewProps>) => ({
    scene: 'title-bar' as const,
    tabs: MIXED_TABS,
    activeTab: local('onboarding'),
    ...props,
  });

  export const preview = definePreview<UnifiedWindowPreviewProps>({
    id: 'unified-window',
    title: 'Unified window (Labs)',
    defaultState: 'title-bar',
    states: {
      'machines-menu': {
        props: { scene: 'machines-menu', flag: true },
        setup: seedMachinesMenu,
      },
      'machines-menu-flag-off': {
        props: { scene: 'machines-menu', flag: false },
        setup: seedMachinesMenu,
      },
      'title-bar': {
        props: titleBar({ offline: [BUILD_BOX.id] }),
        setup: seedTabs(MIXED_TABS, local('onboarding')),
      },
      'machine-dropdown': {
        props: titleBar({ scene: 'machine-dropdown', offline: [BUILD_BOX.id] }),
        setup: seedTabs(MIXED_TABS, local('onboarding')),
      },
      'tab-group-open': {
        props: titleBar({
          tabs: GROUPED_TABS,
          groups: [releaseGroup],
          openGroupId: releaseGroup.id,
          offline: [BUILD_BOX.id],
        }),
        setup: seedTabs(GROUPED_TABS, local('onboarding'), [releaseGroup], releaseGroup.id),
      },
      'tab-group-collapsed': {
        props: titleBar({
          tabs: GROUPED_TABS,
          activeTab: guest('tokens'),
          groups: [releaseGroup],
          offline: [BUILD_BOX.id],
        }),
        setup: seedTabs(GROUPED_TABS, guest('tokens'), [releaseGroup]),
      },
      'command-palette': {
        props: { scene: 'command-palette', offline: [BUILD_BOX.id] },
        setup: seedPalette,
      },
      'offline-tab': {
        props: titleBar({
          scene: 'offline-tab',
          activeTab: studio('gpu'),
          offline: [STUDIO.id, BUILD_BOX.id],
        }),
        setup: seedTabs(MIXED_TABS, studio('gpu')),
      },
      home: {
        props: { scene: 'home', offline: [BUILD_BOX.id] },
        setup: seedWorkspaces,
      },
      'labs-setting': { props: { scene: 'labs-setting' } },
    },
  });
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import DaemonStatusIndicator from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import HomeWorkspaceControls from '$features/home/HomeWorkspaceControls.svelte';
  import HomeWorkspaceList from '$features/home/HomeWorkspaceList.svelte';
  import HomeFilterSelect from '$features/home/HomeFilterSelect.svelte';
  import '$features/home/home.css';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import UnifiedMachineSwitcher from './components/UnifiedMachineSwitcher.svelte';
  import UnifiedOfflineTab from './components/UnifiedOfflineTab.svelte';
  import UnifiedWindowLabSettings from './components/UnifiedWindowLabSettings.svelte';
  import { MACHINES, machineForKey } from './unified-window.preview-fixtures';

  let { scene, flag = false, activeTab, offline = [] }: UnifiedWindowPreviewProps = $props();

  const machines = $derived(
    MACHINES.map((machine) => ({ ...machine, online: !offline.includes(machine.id) })),
  );
  let selectedMachineId = $state(LOCAL.id);
  let paletteOpen = $state(true);
  let labEnabled = $state(false);
  let machineFilter = $state('all');
  let root = $state<HTMLElement | null>(null);

  const tabMachine = (key: string) => machineForKey(key, offline);
  const activeMachine = $derived(activeTab ? tabMachine(activeTab) : null);

  // Open the machines menu the way a user would, so the capture shows it.
  $effect(() => {
    if (scene !== 'machines-menu' || !root) return;
    const element = root;
    void tick().then(() => {
      element
        .querySelector<HTMLElement>('button')
        ?.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        );
    });
  });

  const homeWorkspaces = $derived(WORKSPACES.map(toWorkspace));
  const machineOfWorkspace = (workspace: Workspace) => tabMachine(workspace.id);
  const visibleWorkspaces = $derived(
    homeWorkspaces.filter(
      (workspace) => machineFilter === 'all' || machineOfWorkspace(workspace)?.id === machineFilter,
    ),
  );
  const homeGroups = $derived.by(() => {
    const online = visibleWorkspaces.filter((workspace) => machineOfWorkspace(workspace)?.online);
    const repositories = [...new Set(online.map((workspace) => workspace.repositoryName ?? ''))];
    const offlineMachines = machines.filter((machine) => !machine.online);
    return [
      ...repositories.map((repository) => ({
        id: `repo:${repository}`,
        label: `acme/${repository}`,
        items: online.filter((workspace) => workspace.repositoryName === repository),
        expanded: true,
      })),
      ...offlineMachines
        .map((machine) => ({
          id: `offline:${machine.id}`,
          label: machine.label,
          detail: m.unifiedWindow_home_offlineGroup_detail(),
          items: visibleWorkspaces.filter(
            (workspace) => machineOfWorkspace(workspace)?.id === machine.id,
          ),
          expanded: true,
        }))
        .filter((group) => group.items.length > 0),
    ];
  });
</script>

{#snippet switcher()}
  <UnifiedMachineSwitcher
    {machines}
    selectedId={selectedMachineId}
    onselect={(id) => (selectedMachineId = id)}
    open={scene === 'machine-dropdown'}
  />
{/snippet}

{#snippet windowChrome(content?: Snippet)}
  <div class="flex w-[1200px] flex-col bg-background" data-unified-window-preview={scene}>
    <WindowTitleBar machineSwitcher={switcher} {tabMachine} activeTabId={activeTab ?? null} />
    <div class="relative h-[360px] border-t border-border bg-sidebar p-2">
      {@render content?.()}
    </div>
  </div>
{/snippet}

{#if scene === 'machines-menu'}
  <div class="flex h-[520px] w-[420px] justify-end p-3" bind:this={root}>
    {#if flag}
      <DaemonStatusIndicator onOpenUnifiedWindow={() => {}} />
    {:else}
      <DaemonStatusIndicator />
    {/if}
  </div>
{:else if scene === 'title-bar' || scene === 'machine-dropdown'}
  {@render windowChrome()}
{:else if scene === 'offline-tab'}
  {#snippet offlineContent()}
    <div class="h-full rounded-lg bg-background shadow-sm">
      {#if activeMachine}<UnifiedOfflineTab machine={activeMachine} />{/if}
    </div>
  {/snippet}
  {@render windowChrome(offlineContent)}
{:else if scene === 'command-palette'}
  <div class="min-h-[560px] w-[900px]" data-unified-window-preview={scene}>
    <CommandPalette
      bind:isOpen={paletteOpen}
      initialQuery="deploy"
      workspaceMachine={tabMachine}
      onClose={() => (paletteOpen = true)}
    />
  </div>
{:else if scene === 'home'}
  <div class="w-[1100px] bg-sidebar p-3" data-unified-window-preview={scene}>
    <section
      class="workspace-list home-panel flex min-h-[640px] flex-col overflow-hidden bg-background"
    >
      {#snippet noSettings()}{/snippet}
      {#snippet machineSelect()}
        <div class="shrink-0">
          <HomeFilterSelect
            value={machineFilter}
            label={m.unifiedWindow_home_machineFilter_label()}
            options={[
              { value: 'all', label: m.unifiedWindow_home_machineFilter_all() },
              ...machines.map((machine) => ({ value: machine.id, label: machine.label })),
            ]}
            onchange={(value) => (machineFilter = value)}
          />
        </div>
      {/snippet}
      <div class="flex shrink-0 flex-nowrap items-center gap-3 overflow-x-auto px-6 py-4">
        <HomeWorkspaceControls
          query=""
          filter="all"
          view="list"
          filters={[
            { id: 'all', label: m.home_filter_all(), count: visibleWorkspaces.length },
            { id: 'attention', label: m.home_filter_attention(), count: 1 },
            { id: 'running', label: m.home_filter_running(), count: 1 },
          ]}
          onquery={() => {}}
          onfilter={() => {}}
          onview={() => {}}
          settings={noSettings}
          machineFilter={machineSelect}
        />
      </div>
      <HomeWorkspaceList
        workspaces={visibleWorkspaces}
        groups={homeGroups}
        aside={[]}
        asideExpanded={false}
        pinnedIds={[]}
        selectedId={null}
        showRepository={false}
        showRepositoryOwner={false}
        menu={() => []}
        onopen={() => {}}
        onmenu={() => {}}
        onselect={() => {}}
        ongroupexpanded={() => {}}
        onasideexpanded={() => {}}
        ontoggleaside={() => {}}
        machineOf={machineOfWorkspace}
      />
    </section>
  </div>
{:else if scene === 'labs-setting'}
  <div class="w-[720px] bg-sidebar p-4" data-unified-window-preview={scene}>
    <div class="rounded-lg bg-background shadow-sm">
      <UnifiedWindowLabSettings enabled={labEnabled} onchange={(value) => (labEnabled = value)} />
    </div>
  </div>
{/if}
