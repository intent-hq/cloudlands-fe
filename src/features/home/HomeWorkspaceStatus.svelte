<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import {
    faHourglass,
    faCircleCheck,
    faCircleQuestion,
    faCircleExclamation,
    faCodePullRequest,
  } from '$lib/icons/phosphor-icons';
  import { cn } from '$lib/utils';
  import { getHomeStatusCause } from './home-attention';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeTriageGroup, type HomeTriageInput } from './home-model';

  let {
    workspace,
    class: className,
    showLabel = false,
  }: { workspace: HomeTriageInput; class?: string; showLabel?: boolean } = $props();
  const waiting = $derived(getHomeStatusCause(workspace) === 'waiting');
  const group = $derived(getHomeTriageGroup(workspace));
  const explanation = $derived.by(() => {
    switch (getHomeStatusCause(workspace)) {
      case 'failed':
        return m.home_status_failed();
      case 'blocked':
        return m.home_status_blocked();
      case 'review':
        return m.home_status_review();
      case 'question':
        return m.home_status_question();
      case 'pull-request':
        return m.home_status_pull_request();
      case 'running':
        return m.home_status_running();
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
  const failed = $derived(workspace.displayStatus === 'failed');
  const presentation = $derived.by(() => {
    if (waiting)
      return {
        label: m.workspace_taskStatus_waiting_label(),
        icon: faHourglass,
        color: 'text-muted-foreground',
      };
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
          class:needs-you={group === 'needs-you'}
          role={showLabel ? undefined : 'img'}
          aria-label={showLabel ? undefined : `${presentation.label}. ${explanation}`}
          data-home-status={group}
          data-home-status-error={failed || undefined}
        >
          <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            {#if presentation.icon}
              <Fa icon={presentation.icon} weight="fill" class="size-full!" />
            {:else}
              <span class="size-2 rounded-full bg-current"></span>
            {/if}
          </span>
          {#if showLabel}<span>{presentation.label}</span><span class="sr-only">{explanation}</span
            >{/if}
        </span>{/snippet}</Tooltip.Trigger
    ><Tooltip.Content>{explanation}</Tooltip.Content></Tooltip.Root
  ></Tooltip.Provider
>

<style>
  .needs-you {
    color: hsl(var(--workspace-status-unread));
  }
</style>
