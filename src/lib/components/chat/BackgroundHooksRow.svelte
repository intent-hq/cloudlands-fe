<script lang="ts">
  /**
   * BackgroundHooksRow Component
   *
   * Faint row above the chat input surfacing the active agent's background
   * hooks (PROTOCOL §5.40): one small chip per scheduled/running hook with a
   * shrinking time-to-next-run bar (pure CSS animation derived from
   * `nextRunAt` — no polling timers) and a spinner while a run is in flight.
   * Clicking a chip opens a popover offering "Run now" (`hook.runNow`),
   * "View script" (opens a workspace panel tab), and "Cancel" (`hook.cancel`);
   * the hover card offers the same "View script" affordance. Hidden entirely
   * when the agent has no active hooks.
   *
   * All wire traffic lives in the `backgroundHooks` slice + its companion
   * read middleware (`background-hooks-read-service`): this component only
   * dispatches the subscribe/unsubscribe + run/cancel triggers and renders
   * from the selector.
   */

  import Fa from 'svelte-fa';
  import {
    faBolt,
    faChevronDown,
    faCode,
    faPlay,
    faSpinner,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { safeSlide } from '$lib/utils/animations';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { m } from '$shared/paraglide/messages.js';
  import { formatCompactDuration, formatInteger } from '$lib/i18n/format';
  import type { BackgroundHook } from '$features/hooks/background-hooks-service';
  import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
  import {
    backgroundHooksSubscribeRequested,
    backgroundHooksUnsubscribeRequested,
    cancelBackgroundHookRequested,
    runBackgroundHookRequested,
  } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { store as appStore } from '$store/renderer/store';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import {
    safeSubscriptionSlide,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';

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

  // Capture the initial prop in a store; the effect below keeps later changes in sync.
  // svelte-ignore state_referenced_locally -- intentional initial snapshot for store construction.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const hooks$ = selectBackgroundHooks(workspaceIdStore);

  // Refcounted live subscription: the read middleware opens the `hook:*`
  // events.subscribe on the first subscriber and disposes on the last.
  $effect(() => {
    if (!workspaceId) return;
    const currentWorkspaceId = workspaceId;
    untrack(() => appStore.dispatch(backgroundHooksSubscribeRequested(currentWorkspaceId)));
    return () => {
      appStore.dispatch(backgroundHooksUnsubscribeRequested(currentWorkspaceId));
    };
  });

  // Only the active agent's live hooks get chips; terminal states
  // (dispatched/evicted/cancelled) are history the row never renders.
  const agentHooks = $derived(
    $hooks$.filter(
      (h) => h.agentId === agentId && (h.state === 'scheduled' || h.state === 'running'),
    ),
  );

  $effect(() => {
    visible = agentHooks.length > 0;
    count = agentHooks.length;
  });

  function handleRunNow(hook: BackgroundHook, close: () => void) {
    close();
    appStore.dispatch(runBackgroundHookRequested(hook.workspaceId, hook.hookId));
  }

  function handleCancel(hook: BackgroundHook, close: () => void) {
    close();
    appStore.dispatch(cancelBackgroundHookRequested(hook.workspaceId, hook.hookId));
  }

  let expandedHookId = $state<string | null>(null);

  function handleViewScript(hook: BackgroundHook, close?: () => void) {
    close?.();
    const panelLayoutManager = getPanelLayoutManager(hook.workspaceId);
    const sourcePanelId = panelLayoutManager
      .getPanelIds()
      .find((panelId) =>
        panelLayoutManager
          .getPanel(panelId)
          ?.tabs.some((tab) => tab.type === 'agent' && tab.agentId === agentId),
      );
    panelLayoutManager.openTabInAdjacentOrSplit(
      {
        type: 'hook-script',
        title: m.chat_backgroundHooks_modal_title({ name: hook.name }),
        workspaceId: hook.workspaceId,
        hookId: hook.hookId,
        closable: true,
      },
      sourcePanelId,
    );
  }

  function toggleHookDetails(hookId: string) {
    expandedHookId = expandedHookId === hookId ? null : hookId;
  }

  function stateLabel(hook: BackgroundHook): string {
    return hook.state === 'running'
      ? m.chat_backgroundHooks_running_label()
      : m.chat_backgroundHooks_state_scheduled_label();
  }

  /** Relative timing shown beside localized absolute timestamps in the inline details. */
  function nextRunIn(hook: BackgroundHook): string {
    return formatCompactDuration(new Date(hook.nextRunAt!).getTime() - Date.now());
  }

  function expiresIn(hook: BackgroundHook): string {
    return formatCompactDuration(new Date(hook.expiresAt!).getTime() - Date.now());
  }
</script>

{#if agentHooks.length > 0}
  <div
    class="w-full min-w-0 max-w-full"
    role="group"
    aria-label={m.chat_backgroundHooks_row_ariaLabel()}
    data-testid="background-hooks-row"
    transition:safeSlide={{ axis: 'y', duration: 200 }}
  >
    {#each agentHooks as hook (hook.hookId)}
      {@const detailsId = `background-hook-details-${hook.hookId}`}
      <div class="border-t border-border/40 first:border-t-0" data-hook-state={hook.state}>
        <div class="flex min-h-9 items-center gap-2 px-3 py-2 text-subtle">
          <Button
            variant="plain"
            type="button"
            class="h-auto min-h-0 w-auto min-w-0 flex-1 shrink whitespace-normal rounded border-0 text-left {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
            data-testid="background-hook-summary"
            data-subscription-row="event-subscription"
            aria-expanded={expandedHookId === hook.hookId}
            aria-controls={detailsId}
            onclick={() => toggleHookDetails(hook.hookId)}
          >
            <Fa
              icon={hook.state === 'running' ? faSpinner : faBolt}
              class="h-3.5 w-3.5 shrink-0 {SUBSCRIPTION_ICON_CLASS} {hook.state === 'running'
                ? 'animate-spin'
                : ''}"
            />
            <span class="min-w-0 flex-1 truncate">{hook.name}</span>
            <span class="shrink-0 text-ghost">{stateLabel(hook)}</span>
            {#if hook.nextRunAt}
              <span class="shrink-0 text-ghost">{nextRunIn(hook)}</span>
            {/if}
            <span class="shrink-0" data-testid="background-hook-chevron">
              <Fa
                icon={faChevronDown}
                class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expandedHookId ===
                hook.hookId
                  ? ''
                  : 'rotate-90'}"
              />
            </span>
          </Button>
          <DropdownMenu side="top" align="end">
            {#snippet trigger({ toggle }: { toggle: () => void })}
              <Button
                variant="plain"
                size="icon-xs"
                type="button"
                class="h-6 w-6 border-0 {SUBSCRIPTION_ICON_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
                data-testid="background-hook-chip"
                aria-label={m.chat_backgroundHooks_row_ariaLabel()}
                onclick={toggle}
              >
                <KebabIcon class="h-3 w-3" />
              </Button>
            {/snippet}
            {#snippet content({ close }: { close: () => void })}
              <div class="flex w-36 flex-col p-1">
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="justify-start"
                  disabled={hook.state === 'running'}
                  onclick={() => handleRunNow(hook, close)}
                >
                  <Fa icon={faPlay} class="h-2.5 w-2.5" />
                  {m.chat_backgroundHooks_runNow_label()}
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="justify-start"
                  data-testid="background-hook-view-script-item"
                  onclick={() => handleViewScript(hook, close)}
                >
                  <Fa icon={faCode} class="h-2.5 w-2.5" />
                  {m.chat_backgroundHooks_viewScript_label()}
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="justify-start"
                  onclick={() => handleCancel(hook, close)}
                >
                  <Fa icon={faXmark} class="h-2.5 w-2.5" />
                  {m.chat_backgroundHooks_cancel_label()}
                </Button>
              </div>
            {/snippet}
          </DropdownMenu>
        </div>
        {#if expandedHookId === hook.hookId}
          <div
            id={detailsId}
            class="grid gap-1.5 overflow-hidden px-9 pb-2 text-xs text-subtle"
            data-testid="background-hook-details"
            transition:safeSubscriptionSlide
          >
            <span
              >{m.chat_backgroundHooks_hover_delay_label({
                seconds: formatInteger(Math.round(hook.delayMs / 1000)),
              })}</span
            >
            {#if hook.nextRunAt}
              <span
                >{m.chat_backgroundHooks_hover_nextRunIn_label({ duration: nextRunIn(hook) })}</span
              >
            {/if}
            {#if hook.expiresAt}
              <span
                >{m.chat_backgroundHooks_hover_ttlExpiresIn_label({
                  duration: expiresIn(hook),
                })}</span
              >
            {/if}
            <span
              >{hook.runCount === 1
                ? m.chat_backgroundHooks_details_runCount_one({
                    count: formatInteger(hook.runCount),
                  })
                : m.chat_backgroundHooks_details_runCount_many({
                    count: formatInteger(hook.runCount),
                  })}</span
            >
            {#if hook.lastError}<span class="break-words text-destructive">{hook.lastError}</span
              >{/if}
            {#if hook.lastLogs}
              <div class="grid gap-1">
                <span class="font-medium text-muted-foreground"
                  >{m.chat_backgroundHooks_modal_logsTab_label()}</span
                >
                <pre
                  class="background-hook-logs max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug">{hook.lastLogs}</pre>
              </div>
            {/if}
            <Button
              variant="plain"
              type="button"
              class="h-auto min-h-0 w-fit shrink border-0 font-normal text-primary underline focus-visible:ring-1"
              data-testid="background-hook-view-script-link"
              onclick={() => handleViewScript(hook)}
              >{m.chat_backgroundHooks_viewScript_label()}</Button
            >
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .background-hook-logs {
    font-size: 11px;
  }
</style>
