<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import {
    selectHiddenTabs,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { getBrowserTabEntries, type BrowserTabEntry } from './browser-tab-entries';

  interface Props {
    workspaceId: string;
    agentId: string;
    entries?: BrowserTabEntry[];
  }

  let { workspaceId, agentId, entries: previewEntries }: Props = $props();

  // svelte-ignore state_referenced_locally -- intentional initial snapshot for store construction.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const panels$ = selectPanels(workspaceIdStore);
  const hiddenTabs$ = selectHiddenTabs(workspaceIdStore);
  const storeEntries = $derived(getBrowserTabEntries($panels$, $hiddenTabs$, agentId));
  const entries = $derived(previewEntries ?? storeEntries);
  const triggerLabel = $derived(
    entries.length === 1
      ? m.chat_browserTabs_trigger_tooltip_one({ count: formatInteger(entries.length) })
      : m.chat_browserTabs_trigger_tooltip_many({ count: formatInteger(entries.length) }),
  );

  function tabLabel(entry: BrowserTabEntry): string {
    const title = entry.tab.title.trim();
    if (title) return title;
    if (entry.tab.browserUrl) {
      try {
        return new URL(entry.tab.browserUrl).host || entry.tab.browserUrl;
      } catch {
        return entry.tab.browserUrl;
      }
    }
    return m.browser_embedded_noUrl_label();
  }

  function handleTabClick(entry: BrowserTabEntry) {
    if (previewEntries) return;
    if (entry.hidden) {
      const panels = selectPanels.select(appStore.state, workspaceId);
      const conversationPanel = Object.values(panels).find((panel) =>
        panel.tabs.some((tab) => tab.type === 'agent' && tab.agentId === agentId),
      );
      appStore.dispatch(
        revealHiddenTabAvoidingPanel(workspaceId, entry.tab.id, conversationPanel?.id ?? null),
      );
    } else if (entry.panelId) {
      const manager = getPanelLayoutManager(workspaceId);
      manager.setActiveTab(entry.tab.id, entry.panelId);
      manager.focusPanel(entry.panelId);
    }
  }
</script>

{#snippet favicon(entry: BrowserTabEntry)}
  <span
    class="relative inline-flex size-3.5 shrink-0 items-center justify-center"
    aria-hidden="true"
  >
    <Fa icon={faWindowMaximize} size={12} class="size-3! opacity-30" />
    {#if entry.tab.faviconUrl}
      <img
        src={entry.tab.faviconUrl}
        alt=""
        class="absolute inset-0 size-full rounded-sm object-contain"
        onerror={(event) => ((event.currentTarget as HTMLImageElement).style.display = 'none')}
      />
    {/if}
  </span>
{/snippet}

{#if entries.length > 0}
  <Menu.Root>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          aria-label={triggerLabel}
          tooltip={triggerLabel}
          tooltipSide="bottom"
          tooltipDelayDuration={300}
          data-testid="browser-tabs-trigger"
        >
          <Fa icon={faWindowMaximize} size={14} class="size-3.5!" />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" side="bottom" class="min-w-52 max-w-80">
      {#each entries as entry (entry.tab.id)}
        {@const label = tabLabel(entry)}
        <Menu.Item
          class="min-w-0 {entry.hidden ? 'opacity-60' : ''}"
          data-testid="browser-tabs-menu-item"
          data-browser-tab-id={entry.tab.id}
          data-hidden={entry.hidden || undefined}
          onSelect={() => handleTabClick(entry)}
        >
          {@render favicon(entry)}
          <span class="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        </Menu.Item>
      {/each}
    </Menu.Content>
  </Menu.Root>
{/if}
