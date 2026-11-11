<script lang="ts">
  /**
   * BulkTransferModal — transfer a Home multi-selection to another machine.
   *
   * Presentational; `BulkTransferModalHost` feeds it the bulk-transfer slice.
   *   1. `setup` — destination, per-workspace and total size estimates, and
   *      the two options applied to every workspace.
   *   2. `transferring` — one progress bar for the whole run.
   *   3. `result` — each workspace's outcome.
   */

  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { scrollFade } from '$lib/actions/scroll-fade';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircle,
    faCircleCheck,
    faCircleXmark,
    faLaptop,
    faServer,
  } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import { formatConnectionLabel } from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import { transferStageLabel } from '$features/workspace-transfer/utils/transfer-stage-label';
  import type { ConnectionRecord } from '$store/renderer/slices/connections/connections-types';
  import type { TransferProgress } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';
  import type {
    BulkTransferItem,
    BulkTransferStep,
  } from '$store/renderer/slices/workspace-bulk-transfer/workspace-bulk-transfer-types';
  import {
    bulkTransferEstimate,
    bulkTransferFraction,
  } from '$store/renderer/slices/workspace-bulk-transfer/bulk-transfer-progress';

  interface Props {
    static?: boolean;
    open?: boolean;
    step?: BulkTransferStep;
    items?: BulkTransferItem[];
    connections?: ConnectionRecord[];
    connectionId?: string | null;
    restartAgents?: boolean;
    archiveSource?: boolean;
    currentId?: string | null;
    progress?: TransferProgress | null;
    cancelling?: boolean;
    onSelectTarget?: (connectionId: string) => void;
    onSetRestartAgents?: (value: boolean) => void;
    onSetArchiveSource?: (value: boolean) => void;
    onConnectDevice?: () => void;
    onStart?: () => void;
    onStop?: () => void;
    onClose?: () => void;
  }

  let {
    open = false,
    static: staticPosition = false,
    step = 'setup',
    items = [],
    connections = [],
    connectionId = null,
    restartAgents = false,
    archiveSource = true,
    currentId = null,
    progress = null,
    cancelling = false,
    onSelectTarget,
    onSetRestartAgents,
    onSetArchiveSource,
    onConnectDevice,
    onStart,
    onStop,
    onClose,
  }: Props = $props();

  const count = $derived(formatInteger(items.length));
  const estimate = $derived(bulkTransferEstimate(items));
  const fraction = $derived(bulkTransferFraction(items, currentId, progress));
  const percent = $derived(Math.round(fraction * 100));
  const currentIndex = $derived(items.findIndex((item) => item.workspaceId === currentId));
  const current = $derived(currentIndex >= 0 ? items[currentIndex] : null);
  const doneCount = $derived(items.filter((item) => item.status === 'done').length);
  const allDone = $derived(doneCount === items.length);
  const running = $derived(step === 'transferring');

  const title = $derived(
    running ? m.workspace_bulkTransfer_transferring_title() : m.workspace_bulkTransfer_title(),
  );
  const totalLabel = $derived(
    estimate.loading && estimate.bytes === 0
      ? m.workspace_bulkTransfer_estimating_message()
      : formatBytesBinary(estimate.bytes),
  );

  function statusLabel(item: BulkTransferItem): string {
    switch (item.status) {
      case 'running':
        return m.workspace_bulkTransfer_status_running();
      case 'done':
        return m.workspace_bulkTransfer_status_done();
      case 'failed':
        return m.workspace_bulkTransfer_status_failed();
      case 'skipped':
        return m.workspace_bulkTransfer_status_skipped();
      default:
        return m.workspace_bulkTransfer_status_pending();
    }
  }

  function sizeLabel(item: BulkTransferItem): string {
    if (item.sizeStatus === 'loaded' && item.sizeBytes !== null)
      return formatBytesBinary(item.sizeBytes);
    return item.sizeStatus === 'loading' ? '…' : '—';
  }

  const optionClass = 'w-full h-auto justify-start !px-0 !py-0 text-left whitespace-normal';
</script>

{#snippet workspaceList(showStatus: boolean)}
  <div
    role="list"
    class="max-h-56 w-full min-w-0 overflow-y-auto"
    use:scrollFade
    data-testid="bulk-transfer-items"
  >
    {#each items as item (item.workspaceId)}
      <div
        role="listitem"
        class="flex min-w-0 items-start gap-2.5 py-1.5 text-sm"
        data-status={item.status}
      >
        {#if showStatus}
          <span class="first-line-icon grid size-3.5 shrink-0 place-items-center">
            {#if item.status === 'running'}
              <IntentMarkLoader size={12} />
            {:else if item.status === 'done'}
              <Fa icon={faCircleCheck} class="text-success" />
            {:else if item.status === 'failed'}
              <Fa icon={faCircleXmark} class="text-danger" />
            {:else if item.status === 'skipped'}
              <Fa icon={faCircle} class="text-muted-foreground/40" />
            {:else}
              <span class="size-1.5 rounded-full bg-muted-foreground/40"></span>
            {/if}
            <span class="sr-only">{statusLabel(item)}</span>
          </span>
        {/if}
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate" class:text-subtle={item.status === 'skipped'}>{item.title}</span>
          {#if item.status === 'failed' && item.error}
            <span class="type-caption text-subtle">{item.error}</span>
          {/if}
        </span>
        <span class="shrink-0 type-caption text-subtle tabular-nums">{sizeLabel(item)}</span>
      </div>
    {/each}
  </div>
{/snippet}

<ContentDialog
  {open}
  static={staticPosition}
  {title}
  closeLabel={m.workspace_transfer_close_ariaLabel()}
  onClose={() => onClose?.()}
  busy={running}
  dismissOnInteractOutside={false}
>
  <div class="min-w-0 space-y-4">
    {#if step === 'setup'}
      {#if connections.length === 0}
        <p class="text-sm text-subtle" data-testid="bulk-transfer-no-servers">
          {m.workspace_bulkTransfer_noServers_message()}
        </p>
        <Button variant="ghost" onclick={() => onConnectDevice?.()}>
          {m.workspace_transfer_connectDevice_label()}
        </Button>
      {:else}
        <p class="text-sm text-subtle">
          {items.length === 1
            ? m.workspace_bulkTransfer_description_one()
            : m.workspace_bulkTransfer_description_many({ count })}
        </p>
        <div class="space-y-1">
          {#each connections as conn (conn.id)}
            {@const selected = conn.id === connectionId}
            <Button
              type="button"
              variant="plain"
              truncateLabel={false}
              class="{optionClass} {selected ? 'text-primary' : 'text-foreground'}"
              data-testid="bulk-transfer-server-{conn.id}"
              aria-pressed={selected}
              onclick={() => onSelectTarget?.(conn.id)}
            >
              <ListRow class="w-full min-h-8 px-0 py-1">
                {#snippet leading()}<span class="grid size-6 place-items-center rounded-lg bg-muted"
                    ><Fa icon={conn.isLocal ? faLaptop : faServer} class="text-foreground" /></span
                  >{/snippet}
                {#snippet title()}{formatConnectionLabel(conn)}{/snippet}
                {#snippet trailing()}{#if selected}<Fa
                      icon={faCheck}
                      class="text-primary"
                    />{/if}{/snippet}
              </ListRow>
            </Button>
          {/each}
        </div>
      {/if}

      <div class="space-y-1">
        <div class="flex items-baseline justify-between gap-4">
          <span class="type-caption font-medium text-foreground"
            >{m.workspace_bulkTransfer_estimate_label()}</span
          >
          <span class="text-lg font-semibold tabular-nums" data-testid="bulk-transfer-total-size"
            >{totalLabel}</span
          >
        </div>
        {@render workspaceList(false)}
        {#if !estimate.complete && !estimate.loading}
          <p class="type-caption text-subtle">
            {m.workspace_bulkTransfer_estimatePartial_message()}
          </p>
        {/if}
      </div>

      {#if connections.length > 0}
        <div class="space-y-3">
          <label
            class="flex cursor-pointer items-start gap-2 text-sm"
            data-testid="bulk-transfer-restart-agents"
          >
            <Checkbox
              checked={restartAgents}
              onCheckedChange={(v) => onSetRestartAgents?.(v)}
              ariaLabel={m.workspace_transfer_restartAgents_label()}
            />
            <span class="flex flex-col">
              <span>{m.workspace_transfer_restartAgents_label()}</span>
              <span class="text-xs text-subtle">
                {m.workspace_transfer_restartAgents_description()}
              </span>
            </span>
          </label>
          <label
            class="flex cursor-pointer items-start gap-2 text-sm"
            data-testid="bulk-transfer-archive-source"
          >
            <Checkbox
              checked={archiveSource}
              onCheckedChange={(v) => onSetArchiveSource?.(v)}
              ariaLabel={m.workspace_bulkTransfer_archiveSource_label()}
            />
            <span class="flex flex-col">
              <span>{m.workspace_bulkTransfer_archiveSource_label()}</span>
              <span class="text-xs text-subtle">
                {m.workspace_bulkTransfer_archiveSource_description()}
              </span>
            </span>
          </label>
        </div>
        <p class="text-xs text-subtle">{m.workspace_transfer_notTransferred_message()}</p>
      {/if}
    {:else}
      {#if running}
        <div class="space-y-2">
          <p class="truncate text-sm" aria-live="polite" data-testid="bulk-transfer-current">
            {current
              ? m.workspace_bulkTransfer_current_label({
                  index: formatInteger(currentIndex + 1),
                  count,
                  title: current.title,
                })
              : m.workspace_transfer_stage_building()}
          </p>
          <div
            class="h-2 w-full overflow-hidden rounded bg-accent/50 dark:bg-accent"
            role="progressbar"
            aria-label={m.workspace_transfer_progress_ariaLabel()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            data-testid="bulk-transfer-progress-bar"
          >
            <div
              class="h-full bg-primary transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none"
              style="width: {percent}%"
            ></div>
          </div>
          <div class="flex items-baseline justify-between gap-4 type-caption text-subtle">
            <span class="truncate" data-testid="bulk-transfer-stage"
              >{cancelling
                ? m.workspace_bulkTransfer_cancelling_message()
                : transferStageLabel(progress)}</span
            >
            <span class="shrink-0 tabular-nums" data-testid="bulk-transfer-total-size"
              >{m.workspace_bulkTransfer_total_label({
                bytes: formatBytesBinary(estimate.bytes),
              })}</span
            >
          </div>
        </div>
      {:else}
        <p class="flex items-start gap-2 text-sm" role="status" data-testid="bulk-transfer-result">
          <span class="first-line-icon"
            ><Fa
              icon={allDone ? faCircleCheck : faCircleXmark}
              class={allDone ? 'text-success' : 'text-danger'}
            /></span
          >
          <span class="font-semibold">
            {allDone
              ? m.workspace_bulkTransfer_result_success_title()
              : m.workspace_bulkTransfer_result_partial_title({
                  done: formatInteger(doneCount),
                  count,
                })}
          </span>
        </p>
        {#if !allDone}
          <p class="text-xs text-subtle">{m.workspace_bulkTransfer_result_unchanged_message()}</p>
        {/if}
      {/if}
      {@render workspaceList(true)}
    {/if}
  </div>
  {#snippet footer()}
    {#if step === 'setup'}
      <Button variant="ghost" onclick={() => onClose?.()}>
        {m.workspace_transfer_cancel_label()}
      </Button>
      {#if connections.length > 0}
        <Button
          variant="primary"
          onclick={() => onStart?.()}
          disabled={!connectionId || items.length === 0}
          data-testid="bulk-transfer-start-button"
        >
          {items.length === 1
            ? m.workspace_bulkTransfer_start_one()
            : m.workspace_bulkTransfer_start_many({ count })}
        </Button>
      {/if}
    {:else if running}
      <Button
        variant="ghost"
        onclick={() => onStop?.()}
        disabled={cancelling || progress?.phase === 'committing'}
        data-testid="bulk-transfer-stop-button"
      >
        {m.workspace_bulkTransfer_stop_label()}
      </Button>
    {:else}
      <Button variant="primary" onclick={() => onClose?.()} data-testid="bulk-transfer-done-button">
        {m.workspace_transfer_done_label()}
      </Button>
    {/if}
  {/snippet}
</ContentDialog>
