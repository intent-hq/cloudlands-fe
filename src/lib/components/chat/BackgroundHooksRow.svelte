<script lang="ts">
  /**
   * BackgroundHooksRow Component
   *
   * Row above the chat input surfacing the active agent's background hooks
   * (PROTOCOL §5.40): one responsive card per scheduled/running hook with a
   * live time-to-next-run countdown (a component-local 1s interval ticks a
   * reactive "now" while any rendered hook carries a `nextRunAt`/`expiresAt`)
   * and a static hourglass for both live states. Card details and the
   * overflow menu offer "Run now" (`hook.runNow`),
   * "View script" (opens a workspace panel tab), and "Cancel" (`hook.cancel`).
   * Hidden entirely when the agent has no active hooks.
   *
   * All wire traffic lives in the `backgroundHooks` slice + its companion
   * read middleware (`background-hooks-read-service`): this component only
   * dispatches the subscribe/unsubscribe + run/cancel triggers and renders
   * from the selector.
   */

  import Fa from 'svelte-fa';
  import {
    faChevronDown,
    faCode,
    faHourglass,
    faPlay,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { safeSlide } from '$lib/utils/animations';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { m } from '$shared/paraglide/messages.js';
  import { formatDateTime, formatInteger, formatSalientDuration } from '$lib/i18n/format';
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
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
    SUBSCRIPTION_TRAILING_CONTROLS_CLASS,
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
    embedded = false,
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

  function handleRunNow(hook: BackgroundHook, close?: () => void) {
    close?.();
    appStore.dispatch(runBackgroundHookRequested(hook.workspaceId, hook.hookId));
  }

  function handleCancel(hook: BackgroundHook, close?: () => void) {
    close?.();
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

  // Reactive clock driving the countdown readouts: ticks once per second, but
  // only while a rendered hook has a timed target. Ephemeral UI state — the
  // actual row removal/state change still comes from `hook:*` events.
  let now = $state(Date.now());
  const hasTimedHook = $derived(agentHooks.some((h) => h.nextRunAt || h.expiresAt));
  $effect(() => {
    if (!hasTimedHook) return;
    now = Date.now();
    const interval = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  /**
   * Relative timing shown beside localized absolute timestamps in the inline
   * details. `formatSalientDuration` clamps negative durations to "0s".
   */
  function nextRunIn(hook: BackgroundHook): string {
    return formatSalientDuration(new Date(hook.nextRunAt!).getTime() - now);
  }

  function expiresIn(hook: BackgroundHook): string {
    return formatSalientDuration(new Date(hook.expiresAt!).getTime() - now);
  }

  function summaryStatus(hook: BackgroundHook): string {
    // `lastRunAt` records completion; run-started events carry no start timestamp.
    if (hook.state === 'running') return m.chat_backgroundHooks_running_label();
    if (!hook.nextRunAt) return m.chat_backgroundHooks_state_scheduled_label();
    return m.chat_backgroundHooks_scheduledIn({ duration: nextRunIn(hook) });
  }

  /**
   * Cadence label + value for the details grid: cron hooks show the raw UTC
   * cron expression under "Schedule", runAt hooks a localized "once at
   * <time>", and delayMs hooks keep the compact interval (defensively "—"
   * when `delayMs` is absent/0 on an unknown schedule kind).
   */
  function scheduleLabel(hook: BackgroundHook): string {
    return hook.cron || hook.runAt
      ? m.chat_backgroundHooks_details_schedule_label()
      : m.chat_backgroundHooks_details_interval_label();
  }

  function scheduleValue(hook: BackgroundHook): string {
    if (hook.cron) return hook.cron;
    if (hook.runAt) {
      return m.chat_backgroundHooks_details_onceAt_value({ time: formatDateTime(hook.runAt) });
    }
    return hook.delayMs ? formatSalientDuration(hook.delayMs) : '—';
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
      {@const titleId = `background-hook-title-${hook.hookId}`}
      <section
        class="background-hook-card min-w-0 max-w-full overflow-hidden {embedded
          ? 'background-hook-card--embedded m-0 w-full rounded-none bg-transparent shadow-none'
          : 'mx-2 my-2 rounded-lg border border-border bg-card shadow-sm'}"
        data-hook-state={hook.state}
        data-testid="background-hook-card"
        data-subscription-motion-row="hook"
        aria-labelledby={titleId}
        transition:safeSubscriptionRowTransition
      >
        <div
          class="{SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
          data-testid="background-hook-summary-row"
        >
          <Button
            variant="plain"
            type="button"
            class="h-auto min-h-0 w-auto min-w-0 max-w-full flex-1 shrink justify-start overflow-hidden whitespace-nowrap rounded border-0 p-0! text-left {SUBSCRIPTION_LEADING_CONTENT_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
            data-testid="background-hook-summary"
            data-subscription-row="event-subscription"
            aria-expanded={expandedHookId === hook.hookId}
            aria-controls={detailsId}
            onclick={() => toggleHookDetails(hook.hookId)}
          >
            <span
              class="{SUBSCRIPTION_LEADING_COLUMN_CLASS} {SUBSCRIPTION_ICON_CLASS}"
              data-testid="background-hook-icon"
              aria-hidden="true"
            >
              <Fa icon={faHourglass} size={14} class="h-3.5 w-3.5" />
            </span>
            <span
              id={titleId}
              class="min-w-0 flex-auto truncate text-muted-foreground {embedded
                ? 'font-normal'
                : 'font-medium'}"
              data-testid="background-hook-title">{hook.name}</span
            >
            <span
              class="min-w-0 shrink-[999] truncate text-muted-foreground"
              data-testid="background-hook-state">{summaryStatus(hook)}</span
            >
          </Button>
          <div
            class={SUBSCRIPTION_TRAILING_CONTROLS_CLASS}
            data-testid="background-hook-trailing-controls"
          >
            <DropdownMenu side="top" align="end">
              {#snippet trigger({ props })}
                <Button
                  {...props}
                  variant="plain"
                  size="icon-xs"
                  type="button"
                  class="h-6 w-6 shrink-0 border-0 {SUBSCRIPTION_ICON_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
                  data-testid="background-hook-chip"
                  aria-label={m.chat_backgroundHooks_row_ariaLabel()}
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
            <Button
              variant="plain"
              size="icon-xs"
              type="button"
              class="h-6 w-6 shrink-0 border-0 {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
              data-testid="background-hook-disclosure"
              aria-label={hook.name}
              aria-expanded={expandedHookId === hook.hookId}
              aria-controls={detailsId}
              onclick={(event) => {
                event.stopPropagation();
                toggleHookDetails(hook.hookId);
              }}
            >
              <span
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
                data-testid="background-hook-chevron"
              >
                <Fa
                  icon={faChevronDown}
                  size={16}
                  class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expandedHookId ===
                  hook.hookId
                    ? ''
                    : 'rotate-90'}"
                />
              </span>
            </Button>
          </div>
        </div>
        {#if expandedHookId === hook.hookId}
          <div
            id={detailsId}
            class="min-w-0 overflow-hidden border-t border-border text-xs text-subtle"
            data-testid="background-hook-details"
            transition:safeSubscriptionSlide
          >
            <dl
              class="background-hook-metrics grid min-w-0 grid-cols-4"
              data-testid="background-hook-metrics"
            >
              <div class="background-hook-metric min-w-0 px-3 py-2">
                <dt class="truncate text-muted-foreground">
                  {m.chat_backgroundHooks_details_nextRun_label()}
                </dt>
                <dd class="min-w-0 truncate font-medium text-foreground">
                  {hook.nextRunAt ? nextRunIn(hook) : '—'}
                </dd>
              </div>
              <div class="background-hook-metric min-w-0 border-l border-border px-3 py-2">
                <dt class="truncate text-muted-foreground">
                  {scheduleLabel(hook)}
                </dt>
                <dd class="min-w-0 truncate font-medium text-foreground">
                  {scheduleValue(hook)}
                </dd>
              </div>
              <div class="background-hook-metric min-w-0 border-l border-border px-3 py-2">
                <dt class="truncate text-muted-foreground">
                  {m.chat_backgroundHooks_details_expires_label()}
                </dt>
                <dd class="min-w-0 truncate font-medium text-foreground">
                  {hook.expiresAt ? expiresIn(hook) : '—'}
                </dd>
              </div>
              <div class="background-hook-metric min-w-0 border-l border-border px-3 py-2">
                <dt class="truncate text-muted-foreground">
                  {m.chat_backgroundHooks_details_runs_label()}
                </dt>
                <dd class="min-w-0 truncate font-medium text-foreground">
                  {formatInteger(hook.runCount)}
                </dd>
              </div>
            </dl>
            {#if hook.lastError}<div
                class="break-words border-t border-border px-3 py-2 text-danger"
                data-testid="background-hook-last-error"
              >
                {hook.lastError}
              </div>{/if}
            {#if hook.lastLogs}
              <div class="grid gap-1 border-t border-border px-3 py-2">
                <span class="font-medium text-muted-foreground"
                  >{m.chat_backgroundHooks_modal_logsTab_label()}</span
                >
                <pre
                  class="background-hook-logs max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug">{hook.lastLogs}</pre>
              </div>
            {/if}
            <div
              class="flex min-w-0 flex-wrap items-center justify-end gap-1 border-t border-border px-2 py-1.5"
            >
              <Button
                variant="ghost-light"
                size="xs"
                disabled={hook.state === 'running'}
                data-testid="background-hook-run-now-action"
                onclick={() => handleRunNow(hook)}
              >
                <Fa icon={faPlay} class="h-2.5 w-2.5" />
                {m.chat_backgroundHooks_runNow_label()}
              </Button>
              <Button
                variant="ghost-light"
                size="xs"
                data-testid="background-hook-view-script-link"
                onclick={() => handleViewScript(hook)}
              >
                <Fa icon={faCode} class="h-2.5 w-2.5" />
                {m.chat_backgroundHooks_viewScript_label()}
              </Button>
              <Button
                variant="ghost-light"
                size="xs"
                data-testid="background-hook-cancel-action"
                onclick={() => handleCancel(hook)}
              >
                <Fa icon={faXmark} class="h-2.5 w-2.5" />
                {m.chat_backgroundHooks_cancel_label()}
              </Button>
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .background-hook-logs {
    font-size: 11px;
  }

  .background-hook-card {
    container-type: inline-size;
  }

  .background-hook-card--embedded {
    margin: 0;
    border-width: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    width: 100%;
  }

  .background-hook-card--embedded + .background-hook-card--embedded {
    border-top: 1px solid hsl(var(--border));
  }

  @container (max-width: 32rem) {
    .background-hook-metrics {
      grid-template-columns: minmax(0, 1fr);
    }

    .background-hook-metric {
      display: grid;
      grid-template-columns: minmax(5rem, 0.8fr) minmax(0, 1fr);
      align-items: baseline;
      gap: 0.75rem;
      border-left-width: 0;
      border-top: 1px solid hsl(var(--border));
    }

    .background-hook-metric:first-child {
      border-top-width: 0;
    }

    .background-hook-metric dd {
      text-align: right;
    }
  }
</style>
