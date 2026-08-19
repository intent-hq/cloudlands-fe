<script lang="ts">
  import { faGlobe, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { getRunningScriptBrowserTarget } from '$features/scripts/utils/running-script-browser-target';
  import { Button } from '$lib/components/ui/button';
  import { resolveBrowserLinkForOpen } from '$lib/utils/browser-link-open';
  import { selectAllTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';

  let {
    workspaceId,
    panelLayoutId = workspaceId,
    onExpand,
    expanded = false,
  }: {
    workspaceId: string;
    panelLayoutId?: string;
    onExpand?: () => void;
    expanded?: boolean;
  } = $props();

  const workspaceIdStore = writable(workspaceId);
  const panelLayoutIdStore = writable(panelLayoutId);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const allTabs$ = selectAllTabs(panelLayoutIdStore);
  const browserTarget = $derived(getRunningScriptBrowserTarget($scripts$));
  const hasOpenBrowserTab = $derived($allTabs$.some((tab) => tab.type === 'browser'));

  function openBrowser() {
    if (onExpand) {
      onExpand();
      return;
    }
    getPanelLayoutManager(panelLayoutId).openBrowserPanel();
  }

  function openRunningScriptUrl(event: MouseEvent) {
    event.stopPropagation();
    if (!browserTarget) return;
    // Resolve (rewrite → probe → tunnel) BEFORE the tab opens — the embedded
    // browser loads exactly the URL it is given (intent-hq/monorepo#2404).
    // eslint-disable-next-line intent/no-component-async-data-fetch -- click-time URL resolution IPC, not domain data fetching
    void resolveBrowserLinkForOpen(browserTarget.url).then((resolved) => {
      getPanelLayoutManager(panelLayoutId).openBrowserPanel(
        resolved.url,
        undefined,
        undefined,
        resolved.requestedUrl,
      );
    });
  }

  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => panelLayoutIdStore.set(panelLayoutId));
</script>

<div
  class="group/launcher relative flex h-11 min-w-0 w-full cursor-pointer items-center overflow-hidden rounded-lg border border-border bg-sidebar px-3 text-foreground transition-colors"
  data-sidebar-launcher="browser"
  data-sidebar-card-surface
>
  <Button
    variant="plain"
    class="absolute inset-0 z-0 h-auto cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    onclick={openBrowser}
    aria-label={m.workspace_browserLauncher_openBrowser_ariaLabel()}
    aria-expanded={onExpand ? expanded : undefined}
  ></Button>
  <div
    class="pointer-events-none relative z-10 flex h-7 min-w-0 flex-1 items-center gap-2.5"
    data-sidebar-launcher-row
  >
    <span class="cursor-pointer truncate text-sm font-semibold flex-1" data-sidebar-launcher-label
      >{m.workspace_multiSelectSidebar_browser_label()}</span
    >
    {#if browserTarget && !hasOpenBrowserTab}
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        class="pointer-events-auto relative z-20 rounded text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:bg-background/70"
        onclick={openRunningScriptUrl}
        tooltip={m.workspace_browserLauncher_openAt_tooltip({
          name: browserTarget.name,
          url: browserTarget.url,
        })}
        aria-label={m.workspace_browserLauncher_openAtInBrowser_ariaLabel({
          name: browserTarget.name,
          url: browserTarget.url,
        })}
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
