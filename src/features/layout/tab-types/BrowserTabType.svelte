<script lang="ts">
  /**
   * Browser Tab Type Component
   *
   * Renders an embedded browser for web content.
   */

  import type { TabTypeComponentProps } from './registry';
  import { writable } from 'svelte/store';
  import EmbeddedBrowser from '$lib/components/browser/EmbeddedBrowser.svelte';
  import {
    BROWSER_VIEWPORT_CHANGE_EVENT,
    browserViewportAction,
  } from '$lib/components/browser/browser-viewport-action';
  import { resolveOwnerName } from '$lib/components/workspace/sidebar-browser-groups';
  import {
    updateTabBrowserUrl,
    updateTabTitle,
    updateTabFavicon,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { updateContextItem } from '$store/renderer/slices/context/context-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store as appStore } from '$store/renderer/store';

  let { tab, workspaceId, layoutId, isActive, isPanelFocused, onFocus }: TabTypeComponentProps =
    $props();

  // Browser URL from tab data
  const browserUrl = $derived(tab.browserUrl ?? 'about:blank');
  const panelLayoutId = $derived(layoutId ?? workspaceId);

  // Owner agent display name for the toolbar chip (monorepo#2857).
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const agents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const ownerAgentName = $derived(
    tab.ownerAgentId ? resolveOwnerName(tab.ownerAgentId, $agents$, tab.ownerAgentName) : undefined,
  );
  let viewportActionNode: HTMLDivElement | null = $state(null);
</script>

{#if browserUrl}
  <div
    bind:this={viewportActionNode}
    class="h-full"
    use:browserViewportAction={{ layoutId: panelLayoutId, tabId: tab.id }}
  >
    <EmbeddedBrowser
      url={browserUrl}
      {workspaceId}
      tabId={tab.id}
      {isActive}
      focusUrlBarOnMount={isActive && isPanelFocused}
      isFocused={isPanelFocused}
      ownerAgentId={tab.ownerAgentId}
      {ownerAgentName}
      viewport={tab.viewport ?? { mode: 'fit' }}
      onViewportChange={(viewport) => {
        viewportActionNode?.dispatchEvent(
          new CustomEvent(BROWSER_VIEWPORT_CHANGE_EVENT, { detail: viewport }),
        );
      }}
      onNavigate={(newUrl: string) => {
        // Update the tab's browserUrl so it stays in sync with actual location
        appStore.dispatch(updateTabBrowserUrl(panelLayoutId, tab.id, newUrl));
        // Update context store item if this tab is linked to one
        if (tab.contextItemId) {
          appStore.dispatch(updateContextItem(workspaceId, tab.contextItemId, { url: newUrl }));
        }
      }}
      onTitleChange={(title: string) => {
        // Update the tab title in the panel layout
        appStore.dispatch(updateTabTitle(panelLayoutId, tab.id, title));
        // Update context store item title if this tab is linked to one
        if (tab.contextItemId) {
          appStore.dispatch(updateContextItem(workspaceId, tab.contextItemId, { title }));
        }
      }}
      onFaviconChange={(faviconUrl: string) => {
        // Update the tab's favicon URL in the panel layout
        appStore.dispatch(updateTabFavicon(panelLayoutId, tab.id, faviconUrl));
      }}
      {onFocus}
    />
  </div>
{/if}
