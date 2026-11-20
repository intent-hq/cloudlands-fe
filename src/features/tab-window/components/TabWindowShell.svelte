<script lang="ts">
  /**
   * Tab window shell: a thin header (tab icon and title, "Move back to main
   * window", "Close tab") over the tab's normal component. No sidebar, rail
   * or tab bar. Cmd/Ctrl+Shift+Enter and Cmd/Ctrl+W move the tab back
   * (closing the window moves it back too); only "Close tab" closes it.
   */
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faRightToBracket, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import PanelContentRenderer from '$lib/components/layout/panel-system/PanelContentRenderer.svelte';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { setPanelContext } from '$lib/components/layout/panel-system/panel-context';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import { formatShortcut, isMacPlatform } from '$lib/utils/shortcuts';
  import { effectiveShortcutReadable, getEffectiveShortcut } from '$lib/utils/effective-shortcuts';
  import { matchesShortcut } from '$lib/utils/shortcut-bindings';
  import { selectPanels } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeTabWindowTabRequested,
    moveTabBackRequested,
  } from '$store/renderer/slices/tab-window/tab-window-slice';
  import { tabWindowLayoutId, type TabWindowRecord } from '$shared/types/tab-window';

  let { record }: { record: TabWindowRecord | null | undefined } = $props();

  /** The tab window's one panel (tab-window-saga). */
  const PANEL_ID = 'tab-window-panel';

  const layoutIdStore = writable('');
  $effect(() => layoutIdStore.set(record ? tabWindowLayoutId(record.tabWindowId) : ''));
  const panels$ = selectPanels(layoutIdStore);
  const tab = $derived(
    record ? ($panels$[PANEL_ID]?.tabs.find((t) => t.id === record.tab.id) ?? null) : null,
  );
  const icon = $derived(tab ? tabTypeRegistry.get(tab.type)?.icon : undefined);
  const title = $derived(tab?.title || (tab ? tabTypeRegistry.get(tab.type)?.defaultTitle : ''));

  const moveBackShortcut$ = effectiveShortcutReadable('panel.tab-window');
  const moveBackHint = $derived(formatShortcut($moveBackShortcut$));

  // macOS traffic lights sit over the header's start (hidden in full screen).
  const mac = isMacPlatform();

  createPanelHeaderContext();
  setPanelContext(PANEL_ID);

  function moveBack() {
    appStore.dispatch(moveTabBackRequested());
  }

  function closeTab() {
    appStore.dispatch(closeTabWindowTabRequested());
  }

  onMount(() => {
    const onKeydown = (event: KeyboardEvent) => {
      const closeKey =
        (mac ? event.metaKey : event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'w';
      if (closeKey || matchesShortcut(event, getEffectiveShortcut('panel.tab-window'), mac)) {
        event.preventDefault();
        event.stopPropagation();
        moveBack();
      }
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  });
</script>

<svelte:head>
  <title>{title || 'Intent'}</title>
</svelte:head>

<div class="tab-window-shell" data-testid="tab-window-shell">
  {#if record === undefined}
    <div class="tab-window-message" role="status">{m.tabWindow_loading_label()}</div>
  {:else if record === null}
    <div class="tab-window-message" role="status">{m.tabWindow_missing_label()}</div>
  {:else}
    <header class="tab-window-header app-drag-region" class:mac>
      <div class="tab-window-title">
        {#if tab?.faviconUrl}
          <img class="tab-window-favicon" src={tab.faviconUrl} alt="" />
        {:else if icon}
          <Fa {icon} size="sm" />
        {/if}
        <span class="truncate" data-testid="tab-window-title">{title}</span>
      </div>
      <div class="tab-window-actions">
        <Button
          variant="ghost"
          size="sm"
          title={moveBackHint
            ? `${m.tabWindow_moveBack_label()} (${moveBackHint})`
            : m.tabWindow_moveBack_label()}
          data-testid="tab-window-move-back"
          onclick={moveBack}
        >
          <Fa icon={faRightToBracket} size="sm" />
          {m.tabWindow_moveBack_label()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={m.tabWindow_closeTab_label()}
          title={m.tabWindow_closeTab_label()}
          data-testid="tab-window-close-tab"
          onclick={closeTab}
        >
          <Fa icon={faXmark} size="sm" />
        </Button>
      </div>
    </header>
    <main class="tab-window-content">
      {#if tab}
        <PanelContentRenderer
          {tab}
          workspaceId={record.workspaceId}
          layoutId={tabWindowLayoutId(record.tabWindowId)}
          isActive
          isPanelFocused
        />
      {/if}
    </main>
  {/if}
</div>

<style>
  .tab-window-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    overflow: hidden;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  .tab-window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 36px;
    flex-shrink: 0;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid hsl(var(--border));
    -webkit-app-region: drag;
  }
  .tab-window-header.mac {
    padding-left: 80px;
  }
  .tab-window-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
  }
  .tab-window-favicon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .tab-window-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
  }
  .tab-window-content {
    flex: 1;
    min-height: 0;
  }
  .tab-window-message {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
  }
</style>
