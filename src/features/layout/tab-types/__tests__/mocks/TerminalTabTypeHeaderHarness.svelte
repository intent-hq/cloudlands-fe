<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import * as Menu from '$lib/components/ui/menu';
  import TerminalTabType from '../../TerminalTabType.svelte';

  let {
    activeTabId,
    firstMounted = true,
    secondMounted = true,
  }: {
    activeTabId: string;
    firstMounted?: boolean;
    secondMounted?: boolean;
  } = $props();

  const firstTab: PanelTab = {
    id: 'terminal-tab-1',
    type: 'terminal',
    title: 'Terminal 1',
    closable: true,
    terminalId: 'terminal-session-1',
  };
  const secondTab: PanelTab = {
    id: 'terminal-tab-2',
    type: 'terminal',
    title: 'Terminal 2',
    closable: true,
    terminalId: 'terminal-session-2',
  };
  const header = createPanelHeaderContext();
</script>

{#if firstMounted}
  <TerminalTabType
    tab={firstTab}
    workspaceId="workspace-1"
    layoutId="layout-1"
    isActive={activeTabId === firstTab.id}
    isPanelFocused={activeTabId === firstTab.id}
  />
{/if}
{#if secondMounted}
  <TerminalTabType
    tab={secondTab}
    workspaceId="workspace-1"
    layoutId="layout-1"
    isActive={activeTabId === secondTab.id}
    isPanelFocused={activeTabId === secondTab.id}
  />
{/if}
<div data-testid="browser-tab" data-active={activeTabId === 'browser-tab'}></div>

<!-- The production header keeps its menu mounted while content registrations change. -->
<Menu.Root>
  <Menu.Trigger aria-label="Panel actions">Panel actions</Menu.Trigger>
  <Menu.Content portal={false}>
    {@render header.actions.current?.actions?.()}
  </Menu.Content>
</Menu.Root>
