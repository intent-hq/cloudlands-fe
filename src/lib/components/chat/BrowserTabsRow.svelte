<script lang="ts">
  /**
   * BrowserTabsRow Component
   *
   * Browser-tab section in the agent conversation footer, rendered inline for
   * one tab and as a collapsible list for multiple tabs. It lists the active
   * agent's owned browser tabs — visible panel tabs plus
   * hidden (user-closed, monorepo#2857) ones. Clicking a visible tab
   * activates it and focuses its panel (same path as the sidebar browser
   * list); clicking a hidden tab restores it into a panel OTHER than the one
   * hosting this conversation (splitting when it is the only panel) and
   * activates it there WITHOUT stealing focus from the conversation.
   * Hidden entirely when the agent owns no browser tabs.
   */

  import Fa from 'svelte-fa';
  import { faChevronDown, faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
    selectHiddenTabs,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { revealHiddenTabAvoidingPanel } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
    SUBSCRIPTION_TRAILING_CONTROLS_CLASS,
  } from './subscription-disclosure';
  import { getBrowserTabsExpanded, setBrowserTabsExpanded } from './agent-subscriptions-view-state';
  import { getBrowserTabEntries, type BrowserTabEntry } from './browser-tab-entries';

  interface Props {
    workspaceId: string;
    agentId: string;
    embedded?: boolean;
    visible?: boolean;
    count?: number;
  }

  let {
    workspaceId,
    agentId,
    embedded: _embedded = false,
    visible = $bindable(false),
    count = $bindable(0),
  }: Props = $props();

  // Writable stores mirror the props so the Redux selectors re-evaluate when
  // they change (selector readables are init-time only).
  // svelte-ignore state_referenced_locally -- intentional initial snapshot for store construction.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const panels$ = selectPanels(workspaceIdStore);
  const hiddenTabs$ = selectHiddenTabs(workspaceIdStore);

  // Visible tabs keep their panel/tab-list order; hidden tabs follow them
  // (same ordering as the sidebar browser list, monorepo#2857).
  const entries = $derived(getBrowserTabEntries($panels$, $hiddenTabs$, agentId));

  $effect(() => {
    visible = entries.length > 0;
    count = entries.length;
  });

  const heading = $derived(
    entries.length === 1
      ? m.chat_browserTabs_heading_one({ count: formatInteger(entries.length) })
      : m.chat_browserTabs_heading_many({ count: formatInteger(entries.length) }),
  );

  let expanded = $state(false);
  let disclosureKey = $state('');
  $effect(() => {
    const nextKey = `${workspaceId}:${agentId}`;
    if (nextKey === disclosureKey) return;
    disclosureKey = nextKey;
    expanded = getBrowserTabsExpanded(workspaceId, agentId);
  });

  function toggleExpanded() {
    expanded = !expanded;
    setBrowserTabsExpanded(workspaceId, agentId, expanded);
  }

  const componentId = $props.id();
  const listId = `browser-tabs-list-${componentId}`;

  function handleTabClick(entry: BrowserTabEntry) {
    if (entry.hidden) {
      // Restore into a panel other than the one hosting this conversation
      // (the reducer splits when it is the only panel), so the reveal never
      // moves keyboard focus off the chat and only displaces its active tab
      // in one case: pin mode with the conversation panel as the sole
      // (reusable) panel, where a split would be collapsed by the
      // reusable-panel invariant and re-hide the tab (monorepo#3121). The
      // footer click has already focused the conversation panel by
      // pointerdown, so the conversation panel is the one hosting this
      // agent's tab.
      const panels = selectPanels.select(appStore.state, workspaceId);
      const conversationPanel = Object.values(panels).find((panel) =>
        panel.tabs.some((tab) => tab.type === 'agent' && tab.agentId === agentId),
      );
      appStore.dispatch(
        revealHiddenTabAvoidingPanel(workspaceId, entry.tab.id, conversationPanel?.id ?? null),
      );
    } else if (entry.panelId) {
      // Already-visible tab: activate and focus, same as the sidebar list.
      const manager = getPanelLayoutManager(workspaceId);
      manager.setActiveTab(entry.tab.id, entry.panelId);
      manager.focusPanel(entry.panelId);
    }
  }
</script>

{#snippet tabItem(entry: BrowserTabEntry)}
  <Button
    variant="plain"
    type="button"
    class="justify-start! rounded-none text-left {SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1 focus-visible:ring-inset"
    data-testid="browser-tab-item"
    data-browser-tab-id={entry.tab.id}
    data-hidden={entry.hidden || undefined}
    data-active={entry.active || undefined}
    onclick={() => handleTabClick(entry)}
  >
    <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
      <span
        class="size-1.5 shrink-0 rounded-full {entry.hidden
          ? 'bg-muted-foreground/20'
          : entry.active
            ? 'bg-success'
            : 'bg-muted-foreground/40'}"
      ></span>
    </span>
    <span class="inline-flex min-w-0 flex-1 items-baseline gap-2 whitespace-nowrap">
      <span class="max-w-full shrink-0 truncate" title={entry.tab.title}>{entry.tab.title}</span>
      <span
        class="min-w-0 flex-1 truncate text-muted-foreground"
        title={entry.tab.browserUrl ?? ''}
      >
        {entry.tab.browserUrl || m.browser_embedded_noUrl_label()}
      </span>
    </span>
  </Button>
{/snippet}

{#if entries.length > 0}
  <div
    class="w-full min-w-0 max-w-full"
    role="group"
    aria-label={heading}
    data-testid="browser-tabs-row"
  >
    {#if entries.length === 1}
      {@render tabItem(entries[0])}
    {:else}
      <Button
        variant="plain"
        type="button"
        class="shrink whitespace-normal rounded-none border-0 text-left {SUBSCRIPTION_DISCLOSURE_ROW_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1 focus-visible:ring-inset"
        data-testid="browser-tabs-summary"
        data-subscription-row="browser-tabs"
        aria-expanded={expanded}
        aria-controls={listId}
        onclick={toggleExpanded}
      >
        <span class="w-max shrink-0 {SUBSCRIPTION_LEADING_CONTENT_CLASS}">
          <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
            <Fa
              icon={faWindowMaximize}
              size={14}
              class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
            />
          </span>
          <span
            class="whitespace-nowrap text-muted-foreground"
            data-testid="browser-tabs-summary-title"
          >
            {heading}
          </span>
        </span>
        <span class="min-w-0 flex-1" aria-hidden="true"></span>
        <span
          class="h-6 w-6 justify-center {SUBSCRIPTION_TRAILING_CONTROLS_CLASS}"
          data-testid="browser-tabs-chevron"
        >
          <Fa
            icon={faChevronDown}
            size={16}
            class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded
              ? ''
              : 'rotate-90'}"
          />
        </span>
      </Button>
      {#if expanded}
        <div
          id={listId}
          class="flex w-full min-w-0 max-w-full flex-col overflow-hidden {SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS}"
          data-testid="browser-tabs-list"
          transition:safeSubscriptionSlide
        >
          {#each entries as entry (entry.tab.id)}
            <div
              class="overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
              data-subscription-motion-row="browser-tab"
              transition:safeSubscriptionRowTransition
            >
              {@render tabItem(entry)}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
{/if}
