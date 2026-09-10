<script lang="ts">
  /**
   * BrowserTabsRow Component
   *
   * Collapsible "Browser tabs (N)" section in the agent conversation footer
   * listing the active agent's owned browser tabs — visible panel tabs plus
   * hidden (user-closed, monorepo#2857) ones. Clicking a visible tab
   * activates it and focuses its panel (same path as the sidebar browser
   * list); clicking a hidden tab restores it into a panel OTHER than the one
   * hosting this conversation (splitting when it is the only panel) and
   * activates it there WITHOUT stealing focus from the conversation.
   * Hidden entirely when the agent owns no browser tabs.
   *
   * Each row also carries a permanent Close action, and a "Close hidden
   * tabs" bulk action follows the list when hidden tabs exist (intent#4762).
   * Both DESTROY the owned tab(s) through the authoritative destroy lifecycle
   * (closeTab destroy / destroyHiddenTabsByOwnerAgent, monorepo#2857) — the
   * tab-bar close stays hide-on-close. A tab the registry homes on another
   * client (a mirror, REV-2 §5.45) is closed through `browser.closeTab`
   * instead — the host destroys it and the local mirror follows the
   * `browser:tab-closed` echo — forced while that host is offline. When the
   * owning agent is running the action is gated behind a confirmation dialog.
   */

  import Fa from 'svelte-fa';
  import { faChevronDown, faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import {
    selectHiddenTabs,
    selectPanels,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    closeTab,
    destroyHiddenTabsByOwnerAgent,
    revealHiddenTabAvoidingPanel,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { selectAgentIsRunning } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
    selectBrowserTabHost,
    selectOwnClientId,
  } from '$store/renderer/slices/browser-clients/browser-clients-selectors';
  import { closeBrowserTabRequested } from '$store/renderer/slices/browser-clients/browser-clients-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ACTION_ICON_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
  } from './subscription-disclosure';
  import { getBrowserTabsExpanded, setBrowserTabsExpanded } from './agent-subscriptions-view-state';

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

  interface BrowserTabEntry {
    tab: PanelTab;
    /** Panel hosting the tab; undefined for hidden (user-closed) tabs. */
    panelId?: string;
    active: boolean;
    hidden: boolean;
  }

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
  const entries = $derived<BrowserTabEntry[]>([
    ...Object.values($panels$).flatMap((panel) =>
      panel.tabs
        .filter((tab) => tab.type === 'browser' && tab.ownerAgentId === agentId)
        .map((tab) => ({
          tab,
          panelId: panel.id,
          active: panel.activeTabId === tab.id,
          hidden: false,
        })),
    ),
    ...$hiddenTabs$
      .filter((tab) => tab.type === 'browser' && tab.ownerAgentId === agentId)
      .map((tab) => ({ tab, active: false, hidden: true })),
  ]);

  $effect(() => {
    visible = entries.length > 0;
    count = entries.length;
  });

  const heading = $derived(m.chat_browserTabs_heading({ count: formatInteger(entries.length) }));
  const hiddenCount = $derived(entries.filter((entry) => entry.hidden).length);

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

  type PendingClose = { kind: 'tab'; entry: BrowserTabEntry } | { kind: 'hidden' };

  // Close request awaiting confirmation (owner agent running); null otherwise.
  let pendingClose = $state<PendingClose | null>(null);
  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function isHostedHere(tab: PanelTab, ownClientId: string | null): boolean {
    return tab.hostClientId === undefined || tab.hostClientId === ownClientId;
  }

  // A mirror is closed on its host; `force` tombstones the daemon row when
  // that host is offline (same as the viewer's "Close anyway").
  function closeMirror(tab: PanelTab) {
    const host = selectBrowserTabHost.select(appStore.state, tab.hostClientId ?? '');
    appStore.dispatch(closeBrowserTabRequested(tab.id, !host.connected));
  }

  function performClose(action: PendingClose) {
    const ownClientId = selectOwnClientId.select(appStore.state);
    if (action.kind === 'tab') {
      const { tab, panelId } = action.entry;
      if (isHostedHere(tab, ownClientId)) {
        appStore.dispatch(closeTab(workspaceId, tab.id, panelId, undefined, { destroy: true }));
      } else {
        closeMirror(tab);
      }
      return;
    }
    const hiddenMirrors = entries
      .filter((entry) => entry.hidden && !isHostedHere(entry.tab, ownClientId))
      .map((entry) => entry.tab);
    if (hiddenMirrors.length < hiddenCount) {
      appStore.dispatch(destroyHiddenTabsByOwnerAgent(workspaceId, agentId, ownClientId));
    }
    for (const tab of hiddenMirrors) closeMirror(tab);
  }

  function requestClose(action: PendingClose) {
    if (selectAgentIsRunning.select(appStore.state, agentId)) {
      pendingClose = action;
      return;
    }
    performClose(action);
  }

  function confirmPendingClose() {
    const action = pendingClose;
    pendingClose = null;
    if (action) performClose(action);
  }

  function cancelPendingClose() {
    pendingClose = null;
  }

  function handleDialogOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

{#if entries.length > 0}
  <div
    class="w-full min-w-0 max-w-full"
    role="group"
    aria-label={heading}
    data-testid="browser-tabs-row"
  >
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
        class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
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
          {@const tabTitle = entry.tab.title || m.layout_panelLayout_browser_fallback()}
          <div
            class="flex min-w-0 items-center overflow-hidden pr-2 {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
            data-subscription-motion-row="browser-tab"
            transition:safeSubscriptionRowTransition
          >
            <Button
              variant="plain"
              type="button"
              class="min-w-0 flex-1 shrink whitespace-normal rounded-none border-0 text-left {SUBSCRIPTION_DISCLOSURE_ROW_CLASS} {SUBSCRIPTION_LEADING_CONTENT_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1 focus-visible:ring-inset"
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
              <span class="min-w-0 flex-1 {entry.hidden ? 'opacity-60' : ''}">
                <span class="block truncate" title={tabTitle}>{tabTitle}</span>
                <span class="block truncate text-xs text-subtle" title={entry.tab.browserUrl ?? ''}>
                  {entry.tab.browserUrl || m.browser_embedded_noUrl_label()}
                </span>
              </span>
            </Button>
            <Button
              variant="plain"
              size="icon-xs"
              type="button"
              class="h-6 w-6 shrink-0 border-0 {SUBSCRIPTION_ACTION_ICON_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
              data-testid="browser-tab-close"
              data-browser-tab-id={entry.tab.id}
              aria-label={m.chat_browserTabs_closeTab_ariaLabel({ title: tabTitle })}
              title={m.chat_browserTabs_closeTab_ariaLabel({ title: tabTitle })}
              onclick={(event) => {
                event.stopPropagation();
                requestClose({ kind: 'tab', entry });
              }}
            >
              <Fa icon={faXmark} class="h-3 w-3" />
            </Button>
          </div>
        {/each}
        {#if hiddenCount > 0}
          <div
            class="flex min-w-0 items-center justify-end px-2 py-1 {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
            data-subscription-motion-row="browser-tabs-close-hidden"
            transition:safeSubscriptionRowTransition
          >
            <Button
              variant="ghost-light"
              size="xs"
              type="button"
              data-testid="browser-tabs-close-hidden"
              onclick={() => requestClose({ kind: 'hidden' })}
            >
              <Fa icon={faXmark} class="h-2.5 w-2.5" />
              {m.chat_browserTabs_closeHidden_label({ count: formatInteger(hiddenCount) })}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<Dialog.Root
  open={pendingClose !== null}
  onOpenChange={(nextOpen) => !nextOpen && cancelPendingClose()}
>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.chat_browserTabs_closeDialog_close_ariaLabel()}
    onOpenAutoFocus={handleDialogOpenAutoFocus}
  >
    <div class="p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>
          {pendingClose?.kind === 'hidden'
            ? m.chat_browserTabs_closeHiddenDialog_title()
            : m.chat_browserTabs_closeDialog_title()}
        </Dialog.Title>
        <Dialog.Description class="leading-5">
          {pendingClose?.kind === 'hidden'
            ? m.chat_browserTabs_closeHiddenDialog_description()
            : m.chat_browserTabs_closeDialog_description()}
        </Dialog.Description>
      </Dialog.Header>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button
        variant="ghost-light"
        data-testid="browser-tabs-close-dialog-cancel"
        onclick={cancelPendingClose}
      >
        {m.chat_browserTabs_closeDialog_cancel_label()}
      </Button>
      <Button
        variant="destructive"
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-2' : undefined}
        data-testid="browser-tabs-close-dialog-confirm"
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={confirmPendingClose}
      >
        {pendingClose?.kind === 'hidden'
          ? m.chat_browserTabs_closeHiddenDialog_confirm_label()
          : m.chat_browserTabs_closeDialog_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
