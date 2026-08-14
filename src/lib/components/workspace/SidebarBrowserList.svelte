<script lang="ts">
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { getRunningScriptBrowserTarget } from '$features/scripts/utils/running-script-browser-target';
  import { selectPanels } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId, panelLayoutId }: { workspaceId: string; panelLayoutId: string } = $props();
  const workspaceIdStore = writable(workspaceId);
  const panelLayoutIdStore = writable(panelLayoutId);
  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
  const panels$ = selectPanels(panelLayoutIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const browserTarget = $derived(getRunningScriptBrowserTarget($scripts$));
  const browserTabs = $derived(
    Object.values($panels$).flatMap((panel) =>
      panel.tabs
        .filter((tab) => tab.type === 'browser')
        .map((tab) => ({ tab, panelId: panel.id, active: panel.activeTabId === tab.id })),
    ),
  );

  function openBrowserTab(tabId: string, panelId: string) {
    const manager = getPanelLayoutManager(panelLayoutId);
    manager.setActiveTab(tabId, panelId);
    manager.focusPanel(panelId);
  }

  function openRunningTarget() {
    if (browserTarget) getPanelLayoutManager(panelLayoutId).openBrowserPanel(browserTarget.url);
  }
</script>

<div class="flex min-w-0 flex-col gap-3 px-4" data-sidebar-browser-list>
  {#each browserTabs as { tab, panelId, active } (tab.id)}
    <Button
      variant="plain"
      class="flex h-auto w-full cursor-pointer items-start justify-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted"
      onclick={() => openBrowserTab(tab.id, panelId)}
      data-sidebar-browser-tab={tab.id}
      data-active={active || undefined}
    >
      <span
        class="mt-1.5 size-1.5 shrink-0 rounded-full {active
          ? 'bg-success'
          : 'bg-muted-foreground/40'}"
        aria-hidden="true"
      ></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-foreground" title={tab.title}
          >{tab.title}</span
        >
        <span class="block truncate text-xs text-muted-foreground" title={tab.browserUrl ?? ''}>
          {tab.browserUrl || m.browser_embedded_noUrl_label()}
        </span>
      </span>
    </Button>
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
  {#if browserTabs.length === 0 && !browserTarget}
    <p class="px-2 py-3 text-sm text-muted-foreground" data-sidebar-browser-empty>
      {m.browser_embedded_noUrl_description()}
    </p>
  {/if}
</div>
