<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import BrowserIcon from 'phosphor-svelte/lib/BrowserIcon';
  import { CHAT_ICON_SIZE } from './chat-icon-size';
  import { faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import * as Popover from '$lib/components/ui/popover';
  import { menuItem } from '$lib/components/ui/menu';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
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
    menuOpen = false;
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
      navigated = true;
      manager.focusPanel(entry.panelId);
    }
  }
  let menuOpen = $state(false);
  let contentElement = $state<HTMLUListElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let navigated = false;

  function handleCloseAutoFocus(event: Event) {
    if (!navigated && !pendingClose) return;
    event.preventDefault();
    navigated = false;
  }

  function handleTabKeydown(event: KeyboardEvent, index: number) {
    const rows = contentElement?.querySelectorAll<HTMLElement>(
      '[data-testid="browser-tabs-menu-item"]',
    );
    if (!rows?.length) return;
    let next: number;
    if (event.key === 'ArrowDown') next = (index + 1) % rows.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + rows.length) % rows.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowRight') {
      event.preventDefault();
      (event.currentTarget as HTMLElement)
        .closest('li')
        ?.querySelector<HTMLButtonElement>('[data-testid="browser-tab-close"]')
        ?.focus();
      return;
    } else return;
    event.preventDefault();
    rows[next].focus();
  }
  const hiddenCount = $derived(entries.filter((entry) => entry.hidden).length);
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
    if (previewEntries) return;
    menuOpen = false;
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
  <Popover.Root bind:open={menuOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          bind:ref={triggerElement}
          variant="ghost-light"
          size="icon-sm"
          aria-label={triggerLabel}
          tooltip={triggerLabel}
          tooltipSide="bottom"
          tooltipDelayDuration={300}
          data-testid="browser-tabs-trigger"
        >
          <BrowserIcon
            size={CHAT_ICON_SIZE.compact}
            weight="regular"
            aria-hidden="true"
            class="size-4!"
          />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content
      trapFocus={false}
      align="end"
      side="bottom"
      sideOffset={4}
      class="min-w-52 max-w-80 max-h-[min(var(--bits-popover-content-available-height,calc(100dvh-1rem)),calc(100dvh-1rem))] overflow-y-auto p-1"
      aria-label={triggerLabel}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        contentElement
          ?.querySelector<HTMLElement>('[data-testid="browser-tabs-menu-item"]')
          ?.focus();
      }}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <ul bind:this={contentElement} class="m-0 list-none p-0">
        {#each entries as entry, index (entry.tab.id)}
          {@const label = tabLabel(entry)}
          <li class="flex min-w-0 items-center gap-1">
            <Button
              variant="plain"
              wrapContent={false}
              class="{menuItem()} min-w-0 flex-1 {entry.hidden ? 'opacity-60' : ''}"
              data-testid="browser-tabs-menu-item"
              data-browser-tab-id={entry.tab.id}
              data-hidden={entry.hidden || undefined}
              onkeydown={(event) => handleTabKeydown(event, index)}
              onclick={() => handleTabClick(entry)}
            >
              {@render favicon(entry)}
              <span class="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
            </Button>
            <Button
              variant="plain"
              size="icon-compact"
              type="button"
              class="size-6 shrink-0 focus-visible:ring-1"
              data-testid="browser-tab-close"
              data-browser-tab-id={entry.tab.id}
              aria-label={m.chat_browserTabs_closeTab_ariaLabel({ title: label })}
              title={m.chat_browserTabs_closeTab_ariaLabel({ title: label })}
              onkeydown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  event.currentTarget
                    .closest('li')
                    ?.querySelector<HTMLElement>('[data-testid="browser-tabs-menu-item"]')
                    ?.focus();
                }
              }}
              onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestClose({ kind: 'tab', entry });
              }}
            >
              <Fa icon={faXmark} class="size-3" />
            </Button>
          </li>
        {/each}
      </ul>
      {#if hiddenCount > 0}
        <div class="my-1 border-t border-border"></div>
        <Button
          variant="plain"
          class={menuItem()}
          data-testid="browser-tabs-close-hidden"
          onclick={() => requestClose({ kind: 'hidden' })}
        >
          <Fa icon={faXmark} class="size-3" />
          {m.chat_browserTabs_closeHidden_label({ count: formatInteger(hiddenCount) })}
        </Button>
      {/if}
    </Popover.Content>
  </Popover.Root>
{/if}

<Dialog.Root
  open={pendingClose !== null}
  onOpenChange={(nextOpen) => !nextOpen && cancelPendingClose()}
>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.chat_browserTabs_closeDialog_close_ariaLabel()}
    onOpenAutoFocus={handleDialogOpenAutoFocus}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      triggerElement?.focus();
    }}
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
