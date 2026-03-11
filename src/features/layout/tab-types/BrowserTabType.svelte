<script lang="ts">
  /**
   * Browser Tab Type Component
   *
   * Renders an embedded browser for web content.
   */

  import type { TabTypeComponentProps } from './registry';
  import EmbeddedBrowser from '$lib/components/browser/EmbeddedBrowser.svelte';
  import { getPanelLayoutManager } from '../panel-layout-manager.svelte';
  import { contextStore } from '$features/context/context.store.svelte';

  let { tab, workspaceId, isActive, isPanelFocused, onFocus }: TabTypeComponentProps = $props();

  const layoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Browser URL from tab data
  const browserUrl = $derived(tab.browserUrl ?? 'https://google.com');
</script>

{#if browserUrl}
  <EmbeddedBrowser
    url={browserUrl}
    {workspaceId}
    tabId={tab.id}
    focusUrlBarOnMount={isActive}
    isFocused={isPanelFocused}
    onNavigate={(newUrl: string) => {
      // Update the tab's browserUrl so it stays in sync with actual location
      layoutManager.updateTabBrowserUrl(tab.id, newUrl);
      // Update context store item if this tab is linked to one
      if (tab.contextItemId) {
        contextStore.updateItem(tab.contextItemId, { url: newUrl });
      }
    }}
    onTitleChange={(title: string) => {
      // Update the tab title in the panel layout
      layoutManager.updateTabTitle(tab.id, title);
      // Update context store item title if this tab is linked to one
      if (tab.contextItemId) {
        contextStore.updateItem(tab.contextItemId, { title });
      }
    }}
    onFaviconChange={(faviconUrl: string) => {
      // Update the tab's favicon URL in the panel layout
      layoutManager.updateTabFavicon(tab.id, faviconUrl);
    }}
    {onFocus}
  />
{/if}
