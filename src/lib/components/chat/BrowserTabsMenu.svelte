<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faWindowMaximize, faXmark } from '@fortawesome/free-solid-svg-icons';
  import * as Dialog from '$lib/components/ui/dialog';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import * as Menu from '$lib/components/ui/menu';
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
  let menuOpen = $state(false);
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
  <Menu.Root bind:open={menuOpen}>
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
          onkeydown={(event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              event.currentTarget
                .querySelector<HTMLButtonElement>('[data-testid="browser-tab-close"]')
                ?.focus();
            }
          }}
          onSelect={() => handleTabClick(entry)}
        >
          {@render favicon(entry)}
          <span class="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
          <Button
            variant="plain"
            size="icon-xs"
            type="button"
            class="size-6 shrink-0 focus-visible:ring-1"
            data-testid="browser-tab-close"
            data-browser-tab-id={entry.tab.id}
            aria-label={m.chat_browserTabs_closeTab_ariaLabel({ title: label })}
            title={m.chat_browserTabs_closeTab_ariaLabel({ title: label })}
            onkeydown={(event) => {
              event.stopPropagation();
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                event.currentTarget
                  .closest<HTMLElement>('[data-testid="browser-tabs-menu-item"]')
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
        </Menu.Item>
      {/each}
      {#if hiddenCount > 0}
        <Menu.Separator />
        <Menu.Item
          data-testid="browser-tabs-close-hidden"
          onSelect={() => requestClose({ kind: 'hidden' })}
        >
          <Fa icon={faXmark} class="size-3" />
          {m.chat_browserTabs_closeHidden_label({ count: formatInteger(hiddenCount) })}
        </Menu.Item>
      {/if}
    </Menu.Content>
  </Menu.Root>
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
