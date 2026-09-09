<script lang="ts">
  /**
   * Browser Tab Type Component
   *
   * Renders an embedded browser for web content. A tab the daemon registry
   * homes on another client renders as a viewer (mirror) instead — REV-2
   * Model 3 — and flips live ↔ mirror as `hostClientId` changes.
   */

  import type { TabTypeComponentProps } from './registry';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import EmbeddedBrowser from '$lib/components/browser/EmbeddedBrowser.svelte';
  import BrowserViewerTab from '$lib/components/browser/BrowserViewerTab.svelte';
  import InlineAgentAvatar from '$lib/components/chat/InlineAgentAvatar.svelte';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { navigateToAgent } from '$lib/utils/workspace-navigation';
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
  import { selectPendingPanelReveal } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    selectBrowserTabHost,
    selectOwnClientId,
  } from '$store/renderer/slices/browser-clients/browser-clients-selectors';
  import {
    closeBrowserTabRequested,
    navigateBrowserTabRequested,
  } from '$store/renderer/slices/browser-clients/browser-clients-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store as appStore } from '$store/renderer/store';

  let { tab, workspaceId, layoutId, isActive, isPanelFocused, onFocus }: TabTypeComponentProps =
    $props();

  // Browser URL from tab data
  const browserUrl = $derived(tab.browserUrl ?? 'about:blank');
  const panelLayoutId = $derived(layoutId ?? workspaceId);

  // A focus-preserving reveal (agent openTab { visible: true }, monorepo#3045)
  // activates this tab in an already-focused panel; it must not autofocus the
  // URL bar on mount, or it steals DOM focus from wherever the user is typing.
  const panelLayoutIdStore = writable(untrack(() => panelLayoutId));
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const pendingPanelReveal$ = selectPendingPanelReveal(panelLayoutIdStore);
  const isFocusPreservingReveal = $derived(
    $pendingPanelReveal$?.tabId === tab.id && $pendingPanelReveal$.preserveFocus === true,
  );

  // Owner agent display name for the panel header chip.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const agents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const ownerAgentName = $derived(
    tab.ownerAgentId ? resolveOwnerName(tab.ownerAgentId, $agents$, tab.ownerAgentName) : undefined,
  );
  const headerContext = getPanelHeaderContext();
  $effect(() => {
    if (!headerContext || !isActive || !tab.ownerAgentId) return;
    return headerContext.registerActions({ primary: connectedAgent });
  });
  let viewportActionNode: HTMLDivElement | null = $state(null);

  // The live webview mounts only on the tab's host (REV-2 §5.45). A tab the
  // registry homes on another client is a mirror here: its own webview
  // follows the canonical URL and forwards navigation to the host; no
  // navigation/title reports.
  const ownClientId$ = selectOwnClientId();
  const isHostedHere = $derived(
    tab.hostClientId === undefined || tab.hostClientId === $ownClientId$,
  );
  const hostClientIdStore = writable(untrack(() => tab.hostClientId ?? ''));
  $effect(() => hostClientIdStore.set(tab.hostClientId ?? ''));
  const tabHost$ = selectBrowserTabHost(hostClientIdStore);
</script>

{#snippet connectedAgent()}
  {#if tab.ownerAgentId}
    {#key tab.ownerAgentId}
      <span data-browser-owner-chip={tab.ownerAgentId} class="flex shrink-0 items-center">
        <InlineAgentAvatar
          agentId={tab.ownerAgentId}
          agentName={ownerAgentName}
          onclick={() => void navigateToAgent(tab.ownerAgentId!)}
        />
      </span>
    {/key}
  {/if}
{/snippet}

{#if !isHostedHere}
  <div class="h-full" data-browser-tab-mirror={tab.hostClientId}>
    <BrowserViewerTab
      url={browserUrl}
      title={tab.title}
      host={$tabHost$}
      {isActive}
      onNavigate={(newUrl: string) => {
        const action = navigateBrowserTabRequested(tab.id, newUrl);
        appStore.dispatch(action);
        return action.promise;
      }}
      onClose={({ force }) => {
        appStore.dispatch(closeBrowserTabRequested(tab.id, force));
      }}
      onFaviconChange={(faviconUrl: string) => {
        appStore.dispatch(updateTabFavicon(panelLayoutId, tab.id, faviconUrl));
      }}
      {onFocus}
    />
  </div>
{:else if browserUrl}
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
      focusUrlBarOnMount={isActive && isPanelFocused && !isFocusPreservingReveal}
      isFocused={isPanelFocused}
      ownerAgentId={tab.ownerAgentId}
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
