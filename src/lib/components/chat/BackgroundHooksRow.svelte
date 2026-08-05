<script lang="ts">
  /**
   * BackgroundHooksRow Component
   *
   * Faint row above the chat input surfacing the active agent's background
   * hooks (PROTOCOL §5.40): one small chip per scheduled/running hook with a
   * shrinking time-to-next-run bar (pure CSS animation derived from
   * `nextRunAt` — no polling timers) and a spinner while a run is in flight.
   * Clicking a chip opens a popover offering "Run now" (`hook.runNow`),
   * "View script" (opens `HookScriptModal`), and "Cancel" (`hook.cancel`);
   * the hover card offers the same "View script" affordance. Hidden entirely
   * when the agent has no active hooks.
   *
   * All wire traffic lives in the `backgroundHooks` slice + its companion
   * read middleware (`background-hooks-read-service`): this component only
   * dispatches the subscribe/unsubscribe + run/cancel triggers and renders
   * from the selector.
   */

  import Fa from 'svelte-fa';
  import { faBolt, faCode, faPlay, faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import HookScriptModal from '$lib/components/chat/HookScriptModal.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatTime } from '$lib/i18n/format';
  import type { BackgroundHook } from '$features/hooks/background-hooks-service';
  import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
  import {
    backgroundHooksSubscribeRequested,
    backgroundHooksUnsubscribeRequested,
    cancelBackgroundHookRequested,
    runBackgroundHookRequested,
  } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    agentId: string;
  }

  let { workspaceId, agentId }: Props = $props();

  // Writable store mirrors the prop so the Redux selector re-evaluates when
  // workspaceId changes (selector readables are init-time only).
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

  /**
   * Inline animation style for the shrinking time bar: one linear pass over
   * the full `delayMs` cycle, offset by a negative delay so the bar picks up
   * at the fraction of the cycle already elapsed. Computed once per
   * `nextRunAt` value ({#key} restarts the animation on a new cycle).
   */
  function timeBarStyle(hook: BackgroundHook): string {
    const total = hook.delayMs;
    if (!hook.nextRunAt || !Number.isFinite(total) || total <= 0) return 'display: none;';
    const remaining = new Date(hook.nextRunAt).getTime() - Date.now();
    const elapsed = Math.min(total, Math.max(0, total - remaining));
    return `animation-duration: ${total}ms; animation-delay: -${elapsed}ms;`;
  }

  function handleRunNow(hook: BackgroundHook, close: () => void) {
    close();
    appStore.dispatch(runBackgroundHookRequested(hook.workspaceId, hook.hookId));
  }

  function handleCancel(hook: BackgroundHook, close: () => void) {
    close();
    appStore.dispatch(cancelBackgroundHookRequested(hook.workspaceId, hook.hookId));
  }

  // Hook whose script/logs modal is open; null when closed.
  let viewingHookId = $state<string | null>(null);

  function handleViewScript(hook: BackgroundHook, close?: () => void) {
    close?.();
    viewingHookId = hook.hookId;
  }

  function stateLabel(hook: BackgroundHook): string {
    return hook.state === 'running'
      ? m.chat_backgroundHooks_running_label()
      : m.chat_backgroundHooks_state_scheduled_label();
  }

  /**
   * Compact TTL duration (`expiresAt − createdAt`): "60m" / "12m 30s" / "45s"
   * — the seconds part is omitted when zero.
   */
  function ttlDuration(hook: BackgroundHook): string {
    const totalSeconds = Math.max(
      0,
      Math.round((new Date(hook.expiresAt!).getTime() - new Date(hook.createdAt).getTime()) / 1000),
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
      return m.chat_backgroundHooks_hover_ttlDurationSeconds_label({
        seconds: formatInteger(seconds),
      });
    }
    if (seconds === 0) {
      return m.chat_backgroundHooks_hover_ttlDurationMinutes_label({
        minutes: formatInteger(minutes),
      });
    }
    return m.chat_backgroundHooks_hover_ttlDurationMinutesSeconds_label({
      minutes: formatInteger(minutes),
      seconds: formatInteger(seconds),
    });
  }
</script>

{#if agentHooks.length > 0}
  <div
    class="flex flex-wrap items-center gap-1.5 px-2.5 py-1 opacity-70"
    role="group"
    aria-label={m.chat_backgroundHooks_row_ariaLabel()}
    data-testid="background-hooks-row"
    transition:slide={{ axis: 'y', duration: 200 }}
  >
    <Fa icon={faBolt} class="w-2.5 h-2.5 text-ghost shrink-0" />
    <span class="text-xs leading-tight text-ghost shrink-0"
      >{m.chat_backgroundHooks_runningHooks_label()}</span
    >
    {#each agentHooks as hook (hook.hookId)}
      <DropdownMenu side="top" align="start">
        {#snippet trigger({ toggle }: { toggle: () => void })}
          <Tooltip
            side="top"
            align="start"
            delayDuration={300}
            disableHoverableContent={false}
            contentClass="max-w-sm"
          >
            {#snippet content()}
              <div class="flex flex-col gap-1 text-xs" data-testid="background-hook-hover-card">
                <div class="flex items-center gap-1.5 font-medium">
                  <Fa icon={faBolt} class="w-2.5 h-2.5 text-ghost shrink-0" />
                  <span class="truncate">{hook.name}</span>
                  <span class="text-subtle font-normal">{stateLabel(hook)}</span>
                </div>
                <div class="text-subtle">
                  <span
                    >{m.chat_backgroundHooks_hover_delay_label({
                      seconds: formatInteger(Math.round(hook.delayMs / 1000)),
                    })}</span
                  >
                  {#if hook.nextRunAt}
                    <span class="mx-1" aria-hidden="true">·</span>
                    <span
                      >{m.chat_backgroundHooks_hover_nextRun_label({
                        time: formatTime(hook.nextRunAt, { seconds: true }),
                      })}</span
                    >
                  {/if}
                  {#if hook.expiresAt}
                    <span class="mx-1" aria-hidden="true">·</span>
                    <span
                      >{m.chat_backgroundHooks_hover_ttl_label({
                        duration: ttlDuration(hook),
                        time: formatTime(hook.expiresAt, { seconds: true }),
                      })}</span
                    >
                  {/if}
                </div>
                <button
                  type="button"
                  class="mt-0.5 self-start cursor-pointer text-primary underline hover:text-primary/80"
                  data-testid="background-hook-view-script-link"
                  onclick={() => handleViewScript(hook)}
                >
                  {m.chat_backgroundHooks_viewScript_label()}
                </button>
              </div>
            {/snippet}
            <button
              type="button"
              onclick={toggle}
              class="group/chip relative flex flex-col rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 text-xs leading-tight text-subtle hover:text-foreground hover:bg-muted/40 transition-colors overflow-hidden cursor-pointer"
              data-testid="background-hook-chip"
              data-hook-state={hook.state}
            >
              <span class="flex items-center gap-1 max-w-32">
                <span class="truncate">{hook.name}</span>
                {#if hook.state === 'running'}
                  <Fa icon={faSpinner} class="w-2 h-2 animate-spin shrink-0" />
                  <span class="sr-only">{m.chat_backgroundHooks_running_label()}</span>
                {/if}
              </span>
              {#if hook.state === 'scheduled' && hook.nextRunAt}
                {#key hook.nextRunAt}
                  <span
                    class="hook-time-bar mt-0.5 block h-px w-full bg-muted-foreground/50"
                    style={timeBarStyle(hook)}
                  ></span>
                {/key}
              {:else}
                <span class="mt-0.5 block h-px w-full bg-transparent"></span>
              {/if}
            </button>
          </Tooltip>
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
              <Fa icon={faPlay} class="w-2.5 h-2.5" />
              {m.chat_backgroundHooks_runNow_label()}
            </Button>
            <Button
              variant="ghost-light"
              size="xs"
              class="justify-start"
              data-testid="background-hook-view-script-item"
              onclick={() => handleViewScript(hook, close)}
            >
              <Fa icon={faCode} class="w-2.5 h-2.5" />
              {m.chat_backgroundHooks_viewScript_label()}
            </Button>
            <Button
              variant="ghost-light"
              size="xs"
              class="justify-start"
              onclick={() => handleCancel(hook, close)}
            >
              <Fa icon={faXmark} class="w-2.5 h-2.5" />
              {m.chat_backgroundHooks_cancel_label()}
            </Button>
          </div>
        {/snippet}
      </DropdownMenu>
    {/each}
  </div>
{/if}

{#if viewingHookId !== null}
  <HookScriptModal {workspaceId} hookId={viewingHookId} onClose={() => (viewingHookId = null)} />
{/if}

<style>
  @keyframes hook-time-bar-shrink {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  .hook-time-bar {
    transform-origin: left;
    animation-name: hook-time-bar-shrink;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
</style>
