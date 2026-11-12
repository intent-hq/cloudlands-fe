<!--
  The chat's failure card for an agent on E2B or Northflank that couldn't start, in the
  standard turn-failure layout: plain title and cause, what happens to the
  queued message, the most helpful action filled and the rest quiet, and the
  backend's detail under Details.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faRotateRight, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import FailureDetails from '$lib/components/chat/FailureDetails.svelte';
  import { faArrowUpRightFromSquare } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { cloudDashboardUrl } from '$features/cloud-machines/cloud-machines-format';
  import type { CloudStartFailureAction, CloudStartFailureView } from './cloud-start-failure';

  let {
    view,
    failedAt = null,
    queued = false,
    onRetry,
    retrying = false,
    onOpenSettings,
  }: {
    view: CloudStartFailureView;
    failedAt?: string | null;
    queued?: boolean;
    onRetry?: () => void;
    /** A retry is in flight: Retry shows it and ignores clicks. */
    retrying?: boolean;
    onOpenSettings: () => void;
  } = $props();

  // Retry sends the queued message; without Retry it just waits in the queue.
  const queuedNote = $derived(!queued ? null : view.actions.includes('retry') ? 'retry' : 'stays');
  const warning = $derived(view.tone === 'warning');

  function run(action: CloudStartFailureAction) {
    if (action === 'retry') onRetry?.();
    else onOpenSettings();
  }
</script>

<div
  role={warning ? 'status' : 'alert'}
  data-cloud-start-failure
  data-stream-terminal-error="true"
  data-tone={view.tone}
  class="type-caption mt-4 flex w-full min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3"
>
  <div class="flex min-w-0 items-start gap-2" data-failure-summary>
    {#if warning}
      <Fa icon={faExclamationTriangle} class="mt-0.5 size-3 shrink-0 text-warning-ink" />
    {/if}
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="font-medium {warning ? 'text-warning-ink' : 'text-danger'}"
        >{view.title}{#if failedAt}
          <span class="type-caption ml-1.5 leading-4 font-normal text-muted-foreground">
            <RelativeTime date={failedAt} />
          </span>
        {/if}</span
      >
      <span class="text-muted-foreground">{view.cause}</span>
      {#if queuedNote}
        <span class="text-muted-foreground" data-queued-note={queuedNote}
          >{queuedNote === 'retry'
            ? m.cloudMachines_startFailure_retrySendsQueued()
            : m.cloudMachines_startFailure_staysQueued()}</span
        >
      {/if}
    </div>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    {#each view.actions as action, index (action)}
      <Button
        variant={index === 0 ? 'default' : 'ghost'}
        size="sm"
        class={index === 0 ? 'type-caption h-7 gap-1.5 px-2' : 'shrink-0'}
        data-primary-action={index === 0 ? '' : undefined}
        data-action={action}
        loading={action === 'retry' && retrying}
        onclick={() => run(action)}
      >
        {#if action === 'retry'}<Fa icon={faRotateRight} class="size-3" />{/if}
        {action === 'retry'
          ? m.chat_shared_retry_label()
          : m.cloudMachines_startFailure_machinesSettings_label()}
      </Button>
    {/each}
    <FailureDetails text={view.details} />
    {#if view.dashboard}
      <a
        class="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        href={cloudDashboardUrl(view.provider)}
        target="_blank"
        rel="noopener noreferrer"
        >{view.provider === 'northflank'
          ? m.cloudMachines_northflank_dashboardOpen_label()
          : m.cloudMachines_dashboardOpen_label()}
        <Fa icon={faArrowUpRightFromSquare} class="size-2.5" /></a
      >
    {/if}
  </div>
</div>
