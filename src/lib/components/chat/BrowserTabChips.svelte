<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import {
    selectHiddenTabs,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import { formatInteger } from '$lib/i18n/format';
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
  const heading = $derived(
    entries.length === 1
      ? m.chat_browserTabs_heading_one({ count: formatInteger(entries.length) })
      : m.chat_browserTabs_heading_many({ count: formatInteger(entries.length) }),
  );

  let rootElement: HTMLDivElement | null = $state(null);
  let narrow = $state(false);
  $effect(() => {
    if (!rootElement || typeof ResizeObserver === 'undefined') return;
    const header = rootElement.closest<HTMLElement>('[data-panel-content-header]') ?? rootElement;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) narrow = entry.contentRect.width < 400;
    });
    observer.observe(header);
    return () => observer.disconnect();
  });

  const directEntries = $derived(narrow ? [] : entries.slice(0, 3));
  const showOverflow = $derived(narrow || entries.length > 3);
  const overflowCount = $derived(narrow ? entries.length : entries.length - directEntries.length);

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

{#snippet chip(entry: BrowserTabEntry)}
  {@const label = tabLabel(entry)}
  <button
    type="button"
    class="type-caption inline-flex min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-md bg-muted/60 px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring {entry.hidden
      ? 'opacity-60'
      : ''}"
    title={m.chat_browserTabChips_tab_tooltip({ title: label })}
    data-testid="browser-tab-chip"
    data-browser-tab-id={entry.tab.id}
    data-hidden={entry.hidden || undefined}
    onclick={() => handleTabClick(entry)}
  >
    {@render favicon(entry)}
    <span class="browser-tab-label truncate">{label}</span>
  </button>
{/snippet}

{#if entries.length > 0}
  <div
    bind:this={rootElement}
    class="browser-tab-chips flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden"
    role="group"
    aria-label={heading}
    data-testid="browser-tab-chips"
    data-narrow={narrow || undefined}
  >
    {#each directEntries as entry (entry.tab.id)}
      {@render chip(entry)}
    {/each}

    {#if showOverflow}
      <DropdownMenu align="end" side="bottom" contentClass="min-w-52 max-w-80">
        {#snippet trigger({ props })}
          <button
            {...props}
            type="button"
            class="type-caption inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-muted/60 px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={m.chat_browserTabChips_overflow_tooltip({
              count: formatInteger(entries.length),
            })}
            data-testid="browser-tab-chips-overflow"
          >
            {#if narrow}
              <Fa icon={faWindowMaximize} size={12} class="size-3! opacity-30" />
            {/if}
            {m.chat_browserTabChips_overflow_label({ count: formatInteger(overflowCount) })}
          </button>
        {/snippet}
        {#snippet content({ close })}
          {#each entries as entry (entry.tab.id)}
            {@const label = tabLabel(entry)}
            <Menu.Item
              class="min-w-0 {entry.hidden ? 'opacity-60' : ''}"
              data-testid="browser-tab-chips-menu-item"
              data-browser-tab-id={entry.tab.id}
              onclick={() => {
                handleTabClick(entry);
                close();
              }}
            >
              {@render favicon(entry)}
              <span class="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
            </Menu.Item>
          {/each}
        {/snippet}
      </DropdownMenu>
    {/if}
  </div>
{/if}

<style>
  .browser-tab-label {
    max-width: 10rem;
  }

  @container panel (max-width: 32.5rem) {
    .browser-tab-label {
      max-width: 6.25rem;
    }
  }
</style>
