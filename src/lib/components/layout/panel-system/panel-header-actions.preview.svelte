<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    kind?: 'agent' | 'note' | 'browser' | 'terminal' | 'file' | 'empty';
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
      empty: { props: { kind: 'empty' } },
      disabled: { props: { atLimit: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus } from '$shared/types/agent.types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { PREVIEW_FIXTURE_IDS } from '$lib/component-catalog/preview-fixtures';
  import * as Menu from '$lib/components/ui/menu';
  import { faCopy, faArrowDown, faTrash, faRobot } from '$lib/icons/phosphor-icons';
  import TaskProgressControl from '$lib/components/chat/TaskProgressControl.svelte';
  import BrowserTabsMenu from '$lib/components/chat/BrowserTabsMenu.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import AgentViewSettingsDropdown from '$features/layout/tab-types/AgentViewSettingsDropdown.svelte';
  import PanelTabBar from './PanelTabBar.svelte';

  let { kind = 'agent', stacked = false, atLimit = false }: Props = $props();
  const workspaceId = PREVIEW_FIXTURE_IDS.workspace;
  const agentId = 'panel-header-general-ui';
  const panelId = 'panel-header-actions-preview';
  const columnCount$ = selectPanelColumnCount(workspaceId);
  let lastAction = $state('');
  let selectedTab = $state('header-current');
  let atBottom = $state(false);
  const tabs = $derived<PanelTab[]>(
    kind === 'empty'
      ? []
      : [
          {
            id: 'header-current',
            type: kind,
            title: kind === 'agent' ? 'General UI' : 'Implementation plan',
            agentId: kind === 'agent' ? agentId : undefined,
            browserUrl: kind === 'browser' ? 'https://example.com' : undefined,
            closable: true,
          },
          ...(stacked
            ? [{ id: 'header-other', type: 'note' as const, title: 'Review notes', closable: true }]
            : []),
        ],
  );

  onMount(() => {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: AgentId(agentId),
          workspaceId: WorkspaceId(workspaceId),
          backendSessionId: null,
          name: 'General UI',
          status: AgentStatus.Active,
          turnInFlight: true,
          isResponding: true,
          messages: [],
          createdAt: '2026-09-25T00:00:00.000Z',
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
      ]),
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
  {#if kind === 'agent'}<AgentViewSettingsDropdown embedded />{/if}
{/snippet}

{#snippet contentActions()}
  {@render primaryActions()}
  <Menu.CommandItem icon={faCopy} label="Copy content" onclick={() => (lastAction = 'copy')} />
  <Menu.CommandItem icon={faTrash} label="Delete content" destructive disabled />
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
      display: kind === 'agent' ? displayActions : undefined,
      actions: contentActions,
    }}
    onCreateAgent={() => (lastAction = 'new-agent')}
    onCreateNote={() => (lastAction = 'new-note')}
    onCreateTerminal={() => (lastAction = 'new-terminal')}
    onOpenBrowser={() => (lastAction = 'new-browser')}
    onTabRename={(_, name) => (lastAction = `rename:${name}`)}
    onTabClick={(id) => (selectedTab = id)}
    onZoomToggle={() => (lastAction = 'zoom')}
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
