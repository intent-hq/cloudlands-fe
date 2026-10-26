<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import {
    faCircleCheck,
    faCircleQuestion,
    faCircleExclamation,
    faCodePullRequest,
  } from '$lib/icons/phosphor-icons';
  import { cn } from '$lib/utils';
  import { getHomeStatusCause } from './home-attention';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeBaseTriageGroup, type HomeTriageInput } from './home-model';
  import type { Workspace } from '$shared/types';
  import { getWorkspaceStatusPresentation } from '$lib/components/workspace/utils/workspace-status-presentation';

  let {
    workspace,
    class: className,
    showLabel = false,
  }: {
    workspace: HomeTriageInput & Pick<Workspace, 'waiting'>;
    class?: string;
    showLabel?: boolean;
  } = $props();
  // Waiting shows as a marker on the underlying state, so the chip keys off
  // the group without the waiting overlay.
  const group = $derived(getHomeBaseTriageGroup(workspace));
  const cause = $derived(getHomeStatusCause(workspace));
  const prPresentation = $derived(
    cause === 'pr_open' || cause === 'pr_ready' || cause === 'pr_queued'
      ? getWorkspaceStatusPresentation(cause)
      : null,
  );
  const waiting = $derived(
    cause === 'waiting' ||
      (workspace.waiting === true &&
        (cause === 'idle' ||
          cause === 'merged' ||
          cause === 'complete' ||
          prPresentation !== null)),
  );
  const waitingPresentation = $derived(getWorkspaceStatusPresentation('waiting'));
  const supplementalWaiting = $derived(
    waiting && cause !== 'idle' && cause !== 'waiting' && cause !== 'pr_queued',
  );
  const explanation = $derived.by(() => {
    if (prPresentation) return prPresentation.tooltip;
    if (waiting && cause === 'idle') return m.home_status_waiting_description();
    switch (cause) {
      case 'failed':
        return m.home_status_failed();
      case 'blocked':
        return m.home_status_blocked();
      case 'review':
        return m.home_status_review();
      case 'question':
        return m.home_status_question();
      case 'running':
        return m.home_status_running();
      case 'scripts_running':
        return m.home_status_scripts_running();
      case 'background_tasks_running':
        return m.home_status_background_tasks_running();
      case 'merged':
        return m.home_status_merged();
      case 'complete':
        return m.home_status_complete();
      case 'waiting':
        return m.home_status_waiting();
      case 'unread':
        return m.home_status_unread();
      default:
        return m.home_status_idle();
    }
  });
  const description = $derived(
    waiting && cause !== 'idle' && cause !== 'waiting'
      ? `${explanation} ${m.home_status_waiting_description()}`
      : explanation,
  );
  const failed = $derived(workspace.displayStatus === 'failed');
  const presentation = $derived.by(() => {
    const specific =
      prPresentation ??
      (waiting && (cause === 'idle' || cause === 'waiting') ? waitingPresentation : null);
    if (specific) return { label: specific.label, icon: specific.icon, color: specific.className };
    switch (group) {
      case 'needs-you':
        return {
          label: m.home_filter_attention(),
          icon: faCircleQuestion,
          color: '',
        };
      case 'pr-ready':
        return { label: m.home_filter_pr_ready(), icon: faCodePullRequest, color: 'text-success' };
      case 'running':
        return { label: m.home_filter_running(), icon: null, color: 'text-primary' };
      case 'blocked':
        return {
          label: failed
            ? m.workspace_statusIcon_failed_label()
            : m.workspace_statusIcon_blocked_label(),
          icon: faCircleExclamation,
          color: failed ? 'text-danger' : 'text-warning-ink',
        };
      case 'done':
        return { label: m.home_board_done(), icon: faCircleCheck, color: 'text-success' };
      default:
        return { label: m.home_board_idle(), icon: null, color: 'text-muted-foreground' };
    }
  });
</script>

<Tooltip.Provider
  ><Tooltip.Root
    ><Tooltip.Trigger
      >{#snippet child({ props: homeTooltipProps })}<span
          {...homeTooltipProps}
          class={cn(
            'inline-flex shrink-0 items-center gap-1.5 type-caption',
            presentation.color,
            className,
          )}
          class:needs-you={group === 'needs-you' && !prPresentation}
          role={showLabel ? undefined : 'img'}
          aria-label={showLabel ? undefined : `${presentation.label}. ${description}`}
          data-home-status={group}
          data-home-status-error={failed || undefined}
        >
          {#if supplementalWaiting && waitingPresentation.icon}
            <span class="inline-flex size-3 shrink-0 text-muted-foreground" aria-hidden="true">
              <Fa icon={waitingPresentation.icon} weight="regular" class="size-full!" />
            </span>
          {/if}
          <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            {#if presentation.icon}
              <Fa
                icon={presentation.icon}
                weight="regular"
                class={cause === 'pr_queued' || (waiting && cause === 'idle')
                  ? 'size-3!'
                  : 'size-full!'}
              />
            {:else}
              <span class="size-2 rounded-full bg-current"></span>
            {/if}
          </span>
          {#if showLabel}<span>{presentation.label}</span><span class="sr-only">{description}</span
            >{/if}
        </span>{/snippet}</Tooltip.Trigger
    ><Tooltip.Content>{description}</Tooltip.Content></Tooltip.Root
  ></Tooltip.Provider
>

<style>
  .needs-you {
    color: hsl(var(--workspace-status-unread));
  }
</style>
