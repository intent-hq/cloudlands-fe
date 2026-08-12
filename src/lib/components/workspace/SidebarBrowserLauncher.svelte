<script lang="ts">
  import { faGlobe, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { getRunningScriptBrowserTarget } from '$features/scripts/utils/running-script-browser-target';
  import { Button } from '$lib/components/ui/button';
  import { selectAllTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';

  let {
    workspaceId,
    panelLayoutId = workspaceId,
  }: { workspaceId: string; panelLayoutId?: string } = $props();

  const workspaceIdStore = writable(workspaceId);
  const panelLayoutIdStore = writable(panelLayoutId);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const allTabs$ = selectAllTabs(panelLayoutIdStore);
  const browserTarget = $derived(getRunningScriptBrowserTarget($scripts$));
  const hasOpenBrowserTab = $derived($allTabs$.some((tab) => tab.type === 'browser'));

  function openBrowser() {
    getPanelLayoutManager(panelLayoutId).openBrowserPanel();
  }

  function openRunningScriptUrl(event: MouseEvent) {
    event.stopPropagation();
    if (!browserTarget) return;
    getPanelLayoutManager(panelLayoutId).openBrowserPanel(browserTarget.url);
  }

  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
</script>

<div
  class="group/launcher relative flex min-w-0 w-full cursor-pointer items-center overflow-hidden rounded-lg border border-border bg-card px-4 py-2 text-foreground transition-colors"
  data-sidebar-launcher="browser"
>
  <Button
    variant="plain"
    class="absolute inset-0 z-0 h-auto cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    onclick={openBrowser}
    aria-label="Open Browser"
  ></Button>
  <div class="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2.5">
    <span class="truncate text-sm font-medium flex-1">Browser</span>
    {#if browserTarget && !hasOpenBrowserTab}
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        class="pointer-events-auto relative z-20 rounded text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:bg-background/70"
        onclick={openRunningScriptUrl}
        tooltip={`Open ${browserTarget.name} at ${browserTarget.url}`}
        aria-label={`Open ${browserTarget.name} at ${browserTarget.url} in Browser`}
        data-sidebar-running-url={browserTarget.url}
      >
        <Fa icon={faWindowMaximize} class="size-3" />
      </Button>
    {/if}
    {#if hasOpenBrowserTab}
      <Fa icon={faGlobe} class="size-3 shrink-0 text-muted-foreground" />
    {/if}
  </div>
</div>
