<script lang="ts">
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { getRunningScriptBrowserTarget } from '$features/scripts/utils/running-script-browser-target';
  import {
    selectFocusedPanelId,
    selectHiddenTabs,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectPanelOpenMode } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import SidebarBrowserGroup from './SidebarBrowserGroup.svelte';
  import { groupBrowserTabsByOwner } from './sidebar-browser-groups';

  let { workspaceId, panelLayoutId }: { workspaceId: string; panelLayoutId: string } = $props();
  const workspaceIdStore = writable(workspaceId);
  const panelLayoutIdStore = writable(panelLayoutId);
  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const panels$ = selectPanels(panelLayoutIdStore);
  const hiddenTabs$ = selectHiddenTabs(panelLayoutIdStore);
  const agents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const browserTarget = $derived(getRunningScriptBrowserTarget($scripts$));
  const browserTabs = $derived(
    Object.values($panels$).flatMap((panel) =>
      panel.tabs
        .filter((tab) => tab.type === 'browser')
        .map((tab) => ({ tab, panelId: panel.id, active: panel.activeTabId === tab.id })),
    ),
  );
  // Tabs grouped by owner agent, with hidden (user-closed) owned tabs
  // listed in their owner's group; "Unclaimed" renders last (monorepo#2857).
  const groups = $derived(groupBrowserTabsByOwner(browserTabs, $hiddenTabs$, $agents$));
  // Derived from groups so the count matches what actually renders (the
  // grouping skips malformed hidden entries).
  const tabCount = $derived(groups.reduce((sum, group) => sum + group.entries.length, 0));

  function openBrowserTab(tabId: string, panelId: string) {
    const manager = getPanelLayoutManager(panelLayoutId);
    manager.setActiveTab(tabId, panelId);
    manager.focusPanel(panelId);
  }

  function restoreTab(tabId: string) {
    // Reveal into a panel other than the one hosting the currently-viewed
    // conversation (the reducer splits when it is the only panel), so the
    // sidebar reveal never moves keyboard focus off the chat (monorepo#3113)
    // and only displaces its active tab in one case: pin mode with the
    // conversation panel as the sole (reusable) panel, where a split would
    // be collapsed by the reusable-panel invariant and re-hide the tab
    // (monorepo#3121). Unlike the conversation-footer path, the sidebar has
    // no agent context, so the conversation panel is derived from the focused
    // panel when it is actively showing a conversation, falling back to any
    // panel whose active tab is one.
    const panels = selectPanels.select(appStore.state, panelLayoutId);
    const focusedPanelId = selectFocusedPanelId.select(appStore.state, panelLayoutId);
    const showsConversation = (panel: PanelState) =>
      panel.tabs.some((tab) => tab.id === panel.activeTabId && tab.type === 'agent');
    const focusedPanel = focusedPanelId ? panels[focusedPanelId] : undefined;
    const conversationPanel =
      focusedPanel && showsConversation(focusedPanel)
        ? focusedPanel
        : Object.values(panels).find(showsConversation);
    appStore.dispatch(
      revealHiddenTabAvoidingPanel(
        panelLayoutId,
        tabId,
        conversationPanel?.id ?? null,
        undefined,
        selectPanelOpenMode.select(appStore.state),
      ),
    );
  }

  function openRunningTarget() {
    if (browserTarget) getPanelLayoutManager(panelLayoutId).openBrowserPanel(browserTarget.url);
  }
</script>

<div class="flex min-w-0 flex-col gap-3 px-4" data-sidebar-browser-list>
  {#each groups as group (group.ownerAgentId ?? 'unclaimed')}
    <SidebarBrowserGroup {group} onOpenTab={openBrowserTab} onRestoreTab={restoreTab} />
  {/each}
  {#if browserTarget}
    <Button
      variant="plain"
      class="flex h-auto w-full cursor-pointer items-start justify-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted"
      onclick={openRunningTarget}
      data-browser-running-url={browserTarget.url}
    >
      <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-foreground">{browserTarget.name}</span>
        <span class="block truncate text-xs text-muted-foreground" title={browserTarget.url}
          >{browserTarget.url}</span
        >
      </span>
    </Button>
  {/if}
  {#if tabCount === 0 && !browserTarget}
    <p class="px-2 py-3 text-sm text-muted-foreground" data-sidebar-browser-empty>
      {m.browser_embedded_noUrl_description()}
    </p>
  {/if}
</div>
