<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    menuIcons?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'agent-header-icons',
    title: 'Panel header action icons',
    defaultState: 'default',
    states: {
      default: { props: {} },
      menu: { props: { menuIcons: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelColumnCount } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import AgentViewSettingsDropdown from '$features/layout/tab-types/AgentViewSettingsDropdown.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { faCopy, faTrash, faCircleInfo } from '$lib/icons/phosphor-icons';
  import PanelTabBar from './PanelTabBar.svelte';

  let { menuIcons = false }: Props = $props();
  let closeCount = $state(0);
  let lastMenuAction = $state('');
  const workspaceId = 'agent-header-icons-preview';
  const agentId = 'agent-header-icons-agent';
  const columnCount$ = selectPanelColumnCount(workspaceId);
  const tab: PanelTab = {
    id: 'header-agent',
    type: 'agent',
    title: 'Builder',
    agentId,
    closable: true,
  };

  onMount(() => {
    const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'header-panel' },
        panels: { 'header-panel': { id: 'header-panel', tabs: [tab], activeTabId: tab.id } },
        focusedPanelId: 'header-panel',
        columnCount: 1,
      }),
    );
    return () => {
      store.dispatch(clearPanelLayout(workspaceId));
      dispose();
    };
  });
</script>

{#snippet displayActions()}
  <AgentViewSettingsDropdown embedded />
{/snippet}

{#snippet menuActions()}
  <!-- Representative agent commands exercise the real menu primitive; AgentTabType tests own routing. -->
  <Menu.CommandItem
    icon={faCopy}
    iconWeight="regular"
    label="Copy conversation"
    onclick={() => (lastMenuAction = 'copy')}
  />
  <Menu.CommandItem
    icon={faTrash}
    iconWeight="regular"
    label="Delete agent"
    destructive
    onclick={() => (lastMenuAction = 'delete')}
  />
  <Menu.CommandItem icon={faCircleInfo} iconWeight="regular" label="Agent information" disabled />
{/snippet}

<section
  class="w-full bg-card text-card-foreground"
  data-testid="agent-header-icons-preview"
  data-panel-id="header-panel"
  data-close-count={closeCount}
  data-column-count={$columnCount$}
  data-menu-action={lastMenuAction}
>
  <PanelTabBar
    tabs={[tab]}
    activeTabId={tab.id}
    panelId="header-panel"
    {workspaceId}
    contentActions={{
      display: menuIcons ? displayActions : undefined,
      actions: menuIcons ? menuActions : undefined,
    }}
    onZoomToggle={menuIcons ? () => (lastMenuAction = 'zoom') : undefined}
    onSplitHorizontal={menuIcons ? () => (lastMenuAction = 'split') : undefined}
    onMoveLeft={menuIcons ? () => (lastMenuAction = 'move-left') : undefined}
    onMoveRight={menuIcons ? () => (lastMenuAction = 'move-right') : undefined}
    onTabClose={() => (closeCount += 1)}
    isFocused
  />
</section>
