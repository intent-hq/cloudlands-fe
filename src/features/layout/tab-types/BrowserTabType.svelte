<script lang="ts">
  /**
   * Browser Tab Type Component
   *
   * Renders an embedded browser for web content.
   */

  import type { TabTypeComponentProps } from './registry';
  import EmbeddedBrowser from '$lib/components/browser/EmbeddedBrowser.svelte';
  import {
  updateTabBrowserUrl,
  updateTabTitle,
  updateTabFavicon,
} from '$lib/store/slices/panel-layout/panel-layout-slice';


  import { updateContextItem } from '$lib/store/slices/context/context-slice';
  import { store as appStore } from '$lib/store/store';

  let { tab, workspaceId, isActive, isPanelFocused, onFocus }: TabTypeComponentProps = $props();


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
      appStore.dispatch(updateTabBrowserUrl(workspaceId, tab.id, newUrl));
      // Update context store item if this tab is linked to one
      if (tab.contextItemId) {
        appStore.dispatch(updateContextItem(workspaceId, tab.contextItemId, { url: newUrl }));
      }
    }}
    onTitleChange={(title: string) => {
      // Update the tab title in the panel layout
      appStore.dispatch(updateTabTitle(workspaceId, tab.id, title));
      // Update context store item title if this tab is linked to one
      if (tab.contextItemId) {
        appStore.dispatch(updateContextItem(workspaceId, tab.contextItemId, { title }));
      }
    }}
    onFaviconChange={(faviconUrl: string) => {
      // Update the tab's favicon URL in the panel layout
      appStore.dispatch(updateTabFavicon(workspaceId, tab.id, faviconUrl));
    }}
    {onFocus}
  />
{/if}
