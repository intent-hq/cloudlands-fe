<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    kind?: 'agent' | 'note' | 'browser' | 'terminal' | 'file' | 'diff' | 'changes' | 'empty';
    stacked?: boolean;
    atLimit?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'panel-header-actions',
    title: 'Panel header actions',
    defaultState: 'agent',
    states: {
      agent: { props: { stacked: true } },
      note: { props: { kind: 'note', stacked: true } },
      browser: { props: { kind: 'browser' } },
      terminal: { props: { kind: 'terminal' } },
      file: { props: { kind: 'file' } },
      diff: { props: { kind: 'diff' } },
      changes: { props: { kind: 'changes' } },
      empty: { props: { kind: 'empty' } },
      disabled: { props: { atLimit: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus } from '$shared/types/agent.types';
  import { desktopEntryPatched } from '$store/renderer/slices/desktop-control/desktop-control-slice';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { PREVIEW_FIXTURE_IDS } from '$lib/component-catalog/preview-fixtures';
  import * as Menu from '$lib/components/ui/menu';
  import {
    faCopy,
    faArrowDown,
    faTrash,
    faRobot,
    faRightLeft,
    faBell,
    faBoxArchive,
  } from '$lib/icons/phosphor-icons';
  import TaskProgressControl from '$lib/components/chat/TaskProgressControl.svelte';
  import BrowserTabsMenu from '$lib/components/chat/BrowserTabsMenu.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import AgentViewSettingsDropdown from '$features/layout/tab-types/AgentViewSettingsDropdown.svelte';
  import NoteViewSettingsDropdown from '$features/layout/tab-types/NoteViewSettingsDropdown.svelte';
  import ViewSettingsDropdown from '$features/layout/components/ViewSettingsDropdown.svelte';
  import PanelTabBar from './PanelTabBar.svelte';

  let { kind = 'agent', stacked = false, atLimit = false }: Props = $props();
  const workspaceId = PREVIEW_FIXTURE_IDS.workspace;
  const agentId = 'panel-header-general-ui';
  const agents = [
    { id: agentId, title: 'General UI', status: AgentStatus.Active },
    { id: 'panel-header-backend', title: 'Backend', status: AgentStatus.Idle },
    { id: 'panel-header-bug-killer', title: 'Bug Killer', status: AgentStatus.Active },
    { id: 'panel-header-apis', title: 'APIs', status: AgentStatus.Idle },
  ];
  let reorderedTabs = $state<PanelTab[] | null>(null);
  const panelId = 'panel-header-actions-preview';
  const columnCount$ = selectPanelColumnCount(workspaceId);
  let lastAction = $state('');
  let selectedTab = $state('header-current');
  let atBottom = $state(false);
  let notifications = $state(true);
  let markdownPreview = $state(false);
  let wrapLines = $state(false);
  let diffIndicators = $state(true);
  let foldUnchanged = $state(true);
  let splitView = $state(false);
  let allExpanded = $state(false);
  const harnessVersion = '3.8';
  const tabs = $derived<PanelTab[]>(
    reorderedTabs ??
      (kind === 'empty'
        ? []
        : [
            {
              id: 'header-current',
              type: kind,
              title:
                kind === 'agent'
                  ? 'General UI'
                  : kind === 'file'
                    ? 'README.md'
                    : kind === 'diff'
                      ? 'PanelTabBar.svelte'
                      : kind === 'changes'
                        ? 'Changes'
                        : 'Implementation plan',
              agentId: kind === 'agent' ? agentId : undefined,
              browserUrl: kind === 'browser' ? 'https://example.com' : undefined,
              closable: true,
            },
            ...(stacked
              ? kind === 'agent'
                ? agents.slice(1).map((agent) => ({
                    id: agent.id,
                    agentId: agent.id,
                    type: 'agent' as const,
                    title: agent.title,
                    closable: true,
                  }))
                : [
                    {
                      id: 'header-other',
                      type: 'note' as const,
                      title: 'Review notes',
                      closable: true,
                    },
                  ]
              : []),
          ]),
  );

  onMount(() => {
    const desktopGeneration = store.state.desktopControl.generation;
    if (kind === 'agent') {
      store.dispatch(
        desktopEntryPatched(workspaceId, agentId, desktopGeneration, {
          permission: {
            computerId: 'preview-computer',
            computerName: 'Preview computer',
            allowed: false,
          },
          loading: false,
        }),
      );
    }
    const restoreWorkspaceLookup = overrideMockIpcHandler('workspace:get', (payload) => {
      const id = (payload as { id?: string } | undefined)?.id;
      return id === workspaceId
        ? { success: true, data: { id: workspaceId, path: '/workspace/preview', status: 'active' } }
        : { success: false, error: 'Workspace not found in panel header preview' };
    });
    store.dispatch(
      bulkUpsertSessions(
        agents.map((agent) => ({
          id: AgentId(agent.id),
          workspaceId: WorkspaceId(workspaceId),
          backendSessionId: null,
          name: agent.title,
          status: agent.status,
          turnInFlight: agent.status === AgentStatus.Active,
          isResponding: agent.status === AgentStatus.Active,
          messages: [],
          createdAt: '2026-09-25T00:00:00.000Z',
          updatedAt: '2026-09-25T00:00:00.000Z',
        })),
      ),
    );
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId },
        panels: { [panelId]: { id: panelId, tabs, activeTabId: tabs[0]?.id ?? null } },
        focusedPanelId: panelId,
        columnCount: atLimit ? 4 : 1,
      }),
    );
    return () => {
      if (kind === 'agent')
        store.dispatch(
          desktopEntryPatched(workspaceId, agentId, desktopGeneration, {
            permission: undefined,
            loading: false,
          }),
        );
      restoreWorkspaceLookup();
      store.dispatch(clearPanelLayout(workspaceId));
    };
  });
</script>

{#snippet primaryActions()}
  {#if kind === 'agent'}
    <TaskProgressControl
      embedded
      presentation="checklist"
      tasks={[
        { id: 'plan', title: 'Plan the header changes', status: 'completed' },
        { id: 'review', title: 'Review keyboard and pointer interactions', status: 'running' },
        { id: 'capture', title: 'Capture the final layout', status: 'pending' },
      ]}
    />
    <BrowserTabsMenu
      embedded
      {workspaceId}
      {agentId}
      entries={[
        {
          tab: { id: 'browser', type: 'browser', title: 'Preview documentation', closable: true },
          panelId,
          active: true,
          hidden: false,
        },
      ]}
    />
    <ChatMessageNavigator
      embedded
      messages={[
        { id: 'first', text: 'Make the panel actions consistent' },
        { id: 'last', text: 'Review the narrow layout and keyboard focus' },
      ]}
      isAtBottom={atBottom}
      onSelectMessage={(id) => {
        lastAction = id;
        return true;
      }}
      onScrollToBottom={() => (atBottom = true)}
    />
  {:else if kind === 'browser'}
    <Menu.CommandItem
      icon={faRobot}
      label="Open owning agent Preview owner"
      onclick={() => (lastAction = 'open-owner')}
    />
  {:else if kind === 'terminal'}
    <Menu.CommandItem
      icon={faArrowDown}
      label="Show in bottom bar"
      onclick={() => (lastAction = 'bottom-bar')}
    />
  {/if}
{/snippet}

{#snippet displayActions()}
  {#if kind === 'agent'}
    <AgentViewSettingsDropdown embedded {workspaceId} {agentId} />
    <Menu.CheckboxItem indicator="switch" icon={faBell} bind:checked={notifications}>
      Notifications
    </Menu.CheckboxItem>
  {:else if kind === 'note'}
    <NoteViewSettingsDropdown embedded {workspaceId} noteId="panel-header-note" />
  {:else if kind === 'file'}
    <ViewSettingsDropdown
      embedded
      showFold={false}
      showSplit={false}
      showPreview
      previewEnabled={markdownPreview}
      onTogglePreview={() => (markdownPreview = !markdownPreview)}
      showWrap={!markdownPreview}
      wrapEnabled={wrapLines}
      onToggleWrap={() => (wrapLines = !wrapLines)}
      showDiff={!markdownPreview}
      diffEnabled={diffIndicators}
      onToggleDiff={() => (diffIndicators = !diffIndicators)}
    />
  {:else if kind === 'diff' || kind === 'changes'}
    <ViewSettingsDropdown
      embedded
      showExpand={kind === 'changes'}
      expanded={allExpanded}
      onToggleExpand={() => (allExpanded = !allExpanded)}
      foldEnabled={foldUnchanged}
      onToggleFold={() => (foldUnchanged = !foldUnchanged)}
      wrapEnabled={wrapLines}
      onToggleWrap={() => (wrapLines = !wrapLines)}
      splitEnabled={splitView}
      onToggleSplit={() => (splitView = !splitView)}
    />
  {/if}
{/snippet}

{#snippet conversationActions()}
  <Menu.CommandItem icon={faCopy} label="Copy conversation" onclick={() => (lastAction = 'copy')} />
  {@render primaryActions()}
{/snippet}

{#snippet lifecycleActions()}
  <Menu.CommandItem
    icon={faRightLeft}
    label="Replace agent…"
    onclick={() => (lastAction = 'replace')}
  />
  <Menu.CommandItem
    icon={faBoxArchive}
    label="Retire agent"
    onclick={() => (lastAction = 'retire')}
  />
  <Menu.CommandItem
    icon={faTrash}
    label="Delete agent…"
    destructive
    onclick={() => (lastAction = 'delete')}
  />
{/snippet}

{#snippet metadata()}
  <Menu.Footer>
    <Menu.CommandItem
      class="min-h-0 px-0 py-0"
      label={`Lead specialist · Harness v${harnessVersion}`}
      onclick={() => (lastAction = 'harness')}
    />
  </Menu.Footer>
{/snippet}

{#snippet contentActions()}
  <Menu.CommandItem icon={faCopy} label="Copy conversation" onclick={() => (lastAction = 'copy')} />
  <Menu.CommandItem
    icon={faRightLeft}
    label="Replace agent"
    onclick={() => (lastAction = 'replace')}
  />
  <Menu.CommandItem
    icon={faTrash}
    label="Delete agent"
    destructive
    onclick={() => (lastAction = 'delete')}
  />
{/snippet}

<section
  class="flex min-h-[420px] w-full flex-col bg-card text-card-foreground"
  data-testid="panel-header-actions-preview"
  data-panel-id={panelId}
  data-last-action={lastAction}
  data-column-count={$columnCount$}
>
  <PanelTabBar
    {tabs}
    activeTabId={tabs.length ? selectedTab : null}
    {panelId}
    {workspaceId}
    contentActions={{
      display:
        kind === 'agent' ||
        kind === 'note' ||
        kind === 'file' ||
        kind === 'diff' ||
        kind === 'changes'
          ? displayActions
          : undefined,
      conversation: kind === 'agent' ? conversationActions : undefined,
      lifecycle: kind === 'agent' ? lifecycleActions : undefined,
      footer: kind === 'agent' ? metadata : undefined,
      actions: kind === 'agent' ? undefined : contentActions,
      additional: kind === 'browser' || kind === 'terminal' ? primaryActions : undefined,
    }}
    onCreateAgent={() => (lastAction = 'new-agent')}
    onCreateNote={() => (lastAction = 'new-note')}
    onCreateTerminal={() => (lastAction = 'new-terminal')}
    onOpenBrowser={() => (lastAction = 'new-browser')}
    onTabRename={(_, name) => (lastAction = `rename:${name}`)}
    onTabReorder={(from, to) => {
      const next = [...tabs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      reorderedTabs = next;
      lastAction = `move:${from}:${to}`;
    }}
    onTabClick={(id) => (selectedTab = id)}
    onZoomToggle={() => (lastAction = 'zoom')}
    onMovePaneLeft={stacked ? () => (lastAction = 'move-left') : undefined}
    onMovePaneRight={atLimit || !tabs.length ? undefined : () => (lastAction = 'move-right')}
    onTabClose={() => (lastAction = 'close')}
    onClosePanel={() => (lastAction = 'close')}
    isFocused
  />
  <div class="flex-1 space-y-3 p-6" aria-hidden="true">
    <div class="h-2 w-2/3 rounded-full bg-muted"></div>
    <div class="h-2 w-1/2 rounded-full bg-muted"></div>
    <div class="h-2 w-3/4 rounded-full bg-muted"></div>
  </div>
</section>
