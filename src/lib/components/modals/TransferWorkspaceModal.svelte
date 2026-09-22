<script lang="ts">
  /**
   * TransferWorkspaceModal — the Transfer/Download wizard.
   *
   * Presentational: all state arrives as props from the Redux host
   * (`TransferWorkspaceModalHost`), following the ConnectBackendModal layout.
   *   1. `destination` — pick a target server (connections minus the active
   *      backend — the local entry is listed when a remote is active) or
   *      "Download to file".
   *   2. `confirm` — render the `workspace.transfer.plan` result: manifest
   *      counts, size estimate, git summary, and pre-flight warnings.
   *   3. `transferring` — live progress (build stage, bytes down/up vs the
   *      plan estimate) + the "restart in-flight agents" toggle.
   *   4. `result` — success (archive-source checkbox and Open button for
   *      server transfers, Done) or failure (reason + Retry; the source
   *      stays usable).
   *
   * Download-to-file mode reuses the same steps with download-flavored copy
   * (see `isDownload`) and without the server-only controls.
   */

  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import Fa from 'svelte-fa';
  import {
    faCircleCheck,
    faCheck,
    faCircleXmark,
    faDownload,
    faLaptop,
    faServer,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import { formatConnectionLabel } from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import type { TransferFailurePhase } from '$shared/types/workspace-transfer';
  import type { ConnectionRecord } from '$store/renderer/slices/connections/connections-types';
  import type {
    TransferDestination,
    TransferFinalizeStatus,
    TransferPlan,
    TransferPlanStatus,
    TransferProgress,
    TransferRunStatus,
    TransferStep,
  } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';

  interface Props {
    static?: boolean;
    open?: boolean;
    workspaceTitle?: string;
    step?: TransferStep;
    /** Eligible target connections (all minus the active backend; includes local when a remote is active). */
    connections?: ConnectionRecord[];
    destination?: TransferDestination | null;
    planStatus?: TransferPlanStatus;
    plan?: TransferPlan | null;
    planError?: string | null;
    runStatus?: TransferRunStatus;
    progress?: TransferProgress | null;
    runError?: string | null;
    failurePhase?: TransferFailurePhase | null;
    restartAgents?: boolean;
    downloadFilePath?: string | null;
    interruptedAgents?: string[];
    archiveSource?: boolean;
    finalizeStatus?: TransferFinalizeStatus;
    finalizeError?: string | null;
    onSelectDestination?: (destination: TransferDestination) => void;
    onNext?: () => void;
    onBack?: () => void;
    onCancel?: () => void;
    onStart?: () => void;
    onRetry?: () => void;
    onSetRestartAgents?: (value: boolean) => void;
    onSetArchiveSource?: (value: boolean) => void;
    onFinalize?: (openTarget: boolean) => void;
  }

  let {
    open = false,
    static: staticPosition = false,
    workspaceTitle = '',
    step = 'destination',
    connections = [],
    destination = null,
    planStatus = 'idle',
    plan = null,
    planError = null,
    runStatus = 'idle',
    progress = null,
    runError = null,
    failurePhase = null,
    restartAgents = false,
    downloadFilePath = null,
    interruptedAgents = [],
    archiveSource = true,
    finalizeStatus = 'idle',
    finalizeError = null,
    onSelectDestination,
    onNext,
    onBack,
    onCancel,
    onStart,
    onRetry,
    onSetRestartAgents,
    onSetArchiveSource,
    onFinalize,
  }: Props = $props();

  const canNext = $derived(step === 'destination' && destination != null);

  /** Download-to-file mode swaps transfer-flavored copy for download copy. */
  const isDownload = $derived(destination?.kind === 'download');

  /**
   * Closing is locked while finalize is in flight — a close dispatches the
   * relay cancel, which would race the finalization on the source and
   * silently discard its outcome.
   */
  const canClose = $derived(finalizeStatus !== 'running');

  function requestClose() {
    if (canClose) onCancel?.();
  }

  const destinationLabel = $derived.by(() => {
    if (!destination) return '';
    if (destination.kind === 'download') return m.workspace_transfer_destinationDownload_label();
    const conn = connections.find((c) => c.id === destination.connectionId);
    return m.workspace_transfer_destinationServer_label({
      label: conn ? formatConnectionLabel(conn) : destination.connectionId,
    });
  });

  /** Tables with at least one row, for the manifest counts table. */
  const populatedTables = $derived((plan?.manifest.tables ?? []).filter((t) => t.rowCount > 0));

  const targetLabel = $derived.by(() => {
    if (!destination || destination.kind !== 'server') return '';
    const conn = connections.find((c) => c.id === destination.connectionId);
    return conn ? formatConnectionLabel(conn) : destination.connectionId;
  });

  /** Human copy for the current build stage / relay phase (step 3). */
  const progressLabel = $derived.by(() => {
    if (!progress) return m.workspace_transfer_stage_building();
    if (progress.phase === 'committing') return m.workspace_transfer_phase_committing();
    if (progress.phase === 'relaying') {
      return isDownload
        ? m.workspace_transfer_phase_downloading()
        : m.workspace_transfer_phase_relaying();
    }
    switch (progress.stage) {
      case 'stopping-agents':
        return m.workspace_transfer_stage_stoppingAgents();
      case 'exporting-rows':
        return m.workspace_transfer_stage_exportingRows();
      case 'bundling-git':
        return m.workspace_transfer_stage_bundlingGit();
      case 'writing-archive':
        return m.workspace_transfer_stage_writingArchive();
      default:
        return m.workspace_transfer_stage_building();
    }
  });

  /**
   * Progress fraction for the bar: relay bytes against the sealed archive
   * size once known, indeterminate (null) while the source is still building.
   */
  const progressFraction = $derived.by(() => {
    if (!progress || progress.phase === 'building') return null;
    const total = progress.bytesTotal;
    if (!total || total <= 0) return null;
    // For server relays count down+up against 2× total; downloads down only.
    const isRelay = destination?.kind === 'server';
    const done = isRelay ? progress.bytesDown + progress.bytesUp : progress.bytesDown;
    const denominator = isRelay ? total * 2 : total;
    return Math.min(1, done / denominator);
  });

  /** Size baseline shown next to the counters: actual, else plan estimate. */
  const sizeBaseline = $derived(progress?.bytesTotal ?? plan?.totalSizeBytes ?? 0);

  function isSelected(candidate: TransferDestination): boolean {
    if (!destination) return false;
    if (destination.kind === 'download') return candidate.kind === 'download';
    return candidate.kind === 'server' && candidate.connectionId === destination.connectionId;
  }

  // Let the shared row own multiline layout; the button supplies selection and focus.
  const optionClass = 'w-full h-auto justify-start !px-0 !py-0 text-left whitespace-normal';
</script>

<ContentDialog
  {open}
  static={staticPosition}
  title={m.workspace_transfer_modal_title()}
  closeLabel={m.workspace_transfer_close_ariaLabel()}
  onClose={() => requestClose()}
  busy={!canClose}
  dismissOnInteractOutside={false}
>
  <div class="space-y-4 min-w-0">
    {#if step === 'destination'}
      <p class="text-sm text-subtle">
        {m.workspace_transfer_destination_description({ title: workspaceTitle })}
      </p>

      <div class="space-y-1">
        <span class="block type-caption font-medium text-foreground"
          >{m.workspace_transfer_servers_label()}</span
        >
        {#if connections.length === 0}
          <p class="text-xs text-subtle" data-testid="transfer-empty-servers">
            {m.workspace_transfer_emptyServers_message()}
          </p>
        {:else}
          <div class="space-y-1">
            {#each connections as conn (conn.id)}
              <Button
                type="button"
                variant="plain"
                truncateLabel={false}
                class="{optionClass} {isSelected({ kind: 'server', connectionId: conn.id })
                  ? 'text-primary'
                  : 'text-foreground'}"
                data-testid="transfer-server-{conn.id}"
                aria-pressed={isSelected({ kind: 'server', connectionId: conn.id })}
                onclick={() => onSelectDestination?.({ kind: 'server', connectionId: conn.id })}
              >
                <ListRow leadingAlign="title" class="w-full min-h-8 px-0 py-1">
                  {#snippet leading()}<span
                      class="grid size-6 place-items-center rounded-lg bg-muted"
                      ><Fa
                        icon={conn.isLocal ? faLaptop : faServer}
                        class="text-foreground"
                      /></span
                    >{/snippet}
                  {#snippet title()}{formatConnectionLabel(conn)}{/snippet}
                  {#snippet trailing()}{#if isSelected( { kind: 'server', connectionId: conn.id } )}<Fa
                        icon={faCheck}
                        class="text-primary"
                      />{/if}{/snippet}
                </ListRow>
              </Button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="space-y-1">
        <Button
          type="button"
          variant="plain"
          truncateLabel={false}
          class="{optionClass} {isSelected({ kind: 'download' })
            ? 'text-primary'
            : 'text-foreground'}"
          data-testid="transfer-download-option"
          aria-pressed={isSelected({ kind: 'download' })}
          onclick={() => onSelectDestination?.({ kind: 'download' })}
        >
          <ListRow leadingAlign="title" class="w-full min-h-8 px-0 py-1">
            {#snippet leading()}<span class="grid size-6 place-items-center rounded-lg bg-muted"
                ><Fa icon={faDownload} class="text-foreground" /></span
              >{/snippet}
            {#snippet title()}{m.workspace_transfer_download_label()}{/snippet}
            {#snippet description()}{m.workspace_transfer_download_description()}{/snippet}
            {#snippet trailing()}{#if isSelected({ kind: 'download' })}<Fa
                  icon={faCheck}
                  class="text-primary"
                />{/if}{/snippet}
          </ListRow>
        </Button>
      </div>
    {:else if step === 'confirm'}
      <p class="text-sm text-subtle">
        {isDownload
          ? m.workspace_transfer_confirmDownload_description()
          : m.workspace_transfer_confirm_description()}
      </p>
      {#if destinationLabel}
        <p class="text-xs text-subtle" data-testid="transfer-destination-summary">
          {destinationLabel}
        </p>
      {/if}

      {#if planStatus === 'loading'}
        <p class="text-sm text-subtle" data-testid="transfer-plan-loading">
          {m.workspace_transfer_planLoading_message()}
        </p>
      {:else if planStatus === 'error'}
        <p class="text-xs text-danger" data-testid="transfer-plan-error">
          {m.workspace_transfer_planFailed_error({ error: planError ?? '' })}
        </p>
      {:else if plan}
        {#if plan.warnings.length > 0}
          <div class="space-y-1" data-testid="transfer-warnings">
            <span class="text-xs text-subtle">{m.workspace_transfer_warnings_label()}</span>
            {#each plan.warnings as warning (warning.code)}
              <p class="flex items-start gap-2 text-xs text-subtle">
                <Fa icon={faTriangleExclamation} class="text-warning-ink shrink-0 mt-0.5" />
                <span>{warning.message}</span>
              </p>
            {/each}
          </div>
        {/if}

        <div class="space-y-1">
          <span class="text-xs text-subtle">
            {isDownload
              ? m.workspace_transfer_sizeEstimateDownload_label()
              : m.workspace_transfer_sizeEstimate_label()}
          </span>
          <p class="text-lg font-semibold" data-testid="transfer-total-size">
            {formatBytesBinary(plan.totalSizeBytes)}
          </p>
          <ul class="text-xs text-subtle space-y-0.5">
            <li>
              {m.workspace_transfer_dbRows_label()}: {formatBytesBinary(plan.dbRowBytes)}
            </li>
            <li>
              {plan.manifest.assets.length === 1
                ? m.workspace_transfer_assets_one()
                : m.workspace_transfer_assets_many({ count: plan.manifest.assets.length })}:
              {formatBytesBinary(plan.assetBytes)}
            </li>
            <li>
              {m.workspace_transfer_gitBundle_label()}:
              {formatBytesBinary(plan.estimatedGitBundleBytes)}
            </li>
          </ul>
        </div>

        <div class="space-y-1">
          <span class="text-xs text-subtle">{m.workspace_transfer_data_label()}</span>
          <table class="w-full text-xs" data-testid="transfer-tables">
            <thead>
              <tr class="text-left text-subtle">
                <th class="font-normal pb-1">{m.workspace_transfer_tableName_label()}</th>
                <th class="font-normal pb-1 text-right">
                  {m.workspace_transfer_tableRows_label()}
                </th>
              </tr>
            </thead>
            <tbody>
              {#each populatedTables as table (table.name)}
                <tr>
                  <!-- i18n-ignore (table names are wire identifiers) -->
                  <td class="font-mono">{table.name}</td>
                  <td class="text-right">{formatInteger(table.rowCount)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="space-y-1 text-xs text-subtle">
          {#if plan.manifest.git.hasRepository}
            {#if plan.manifest.git.branch}
              <p>
                {m.workspace_transfer_gitBranch_label({ branch: plan.manifest.git.branch })}
              </p>
            {/if}
            {#if plan.manifest.git.sandboxBranches.length > 0}
              <p>
                {plan.manifest.git.sandboxBranches.length === 1
                  ? m.workspace_transfer_sandboxBranches_one()
                  : m.workspace_transfer_sandboxBranches_many({
                      count: plan.manifest.git.sandboxBranches.length,
                    })}
              </p>
            {/if}
          {:else}
            <p>{m.workspace_transfer_noRepository_message()}</p>
          {/if}
        </div>

        <p class="text-xs text-subtle">
          {isDownload
            ? m.workspace_transfer_notDownloaded_message()
            : m.workspace_transfer_notTransferred_message()}
        </p>
      {/if}
    {:else if step === 'transferring'}
      <p class="text-sm" data-testid="transfer-progress-label">
        {isDownload
          ? m.workspace_transfer_downloading_title({ title: workspaceTitle })
          : m.workspace_transfer_transferring_title({ title: workspaceTitle })}
      </p>
      <p class="text-sm text-subtle" data-testid="transfer-progress-stage">{progressLabel}</p>

      <div
        class="h-2 w-full rounded bg-muted overflow-hidden"
        role="progressbar"
        aria-label={isDownload
          ? m.workspace_transfer_downloadProgress_ariaLabel()
          : m.workspace_transfer_progress_ariaLabel()}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressFraction != null ? Math.round(progressFraction * 100) : undefined}
        data-testid="transfer-progress-bar"
      >
        {#if progressFraction != null}
          <div
            class="h-full bg-primary transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none"
            style="width: {Math.round(progressFraction * 100)}%"
          ></div>
        {:else}
          <div class="h-full w-1/3 bg-primary/60 animate-pulse"></div>
        {/if}
      </div>

      <ul class="text-xs text-subtle space-y-0.5" data-testid="transfer-progress-bytes">
        <li>
          {m.workspace_transfer_bytesDown_label({
            bytes: formatBytesBinary(progress?.bytesDown ?? 0),
          })}
          {#if sizeBaseline > 0}
            {m.workspace_transfer_ofEstimate_label({ bytes: formatBytesBinary(sizeBaseline) })}
          {/if}
        </li>
        {#if destination?.kind === 'server'}
          <li>
            {m.workspace_transfer_bytesUp_label({
              bytes: formatBytesBinary(progress?.bytesUp ?? 0),
            })}
            {#if sizeBaseline > 0}
              {m.workspace_transfer_ofEstimate_label({
                bytes: formatBytesBinary(sizeBaseline),
              })}
            {/if}
          </li>
        {/if}
      </ul>

      {#if destination?.kind === 'server'}
        <label
          class="flex items-start gap-2 text-sm cursor-pointer"
          data-testid="transfer-restart-agents"
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
      {/if}
    {:else if step === 'result'}
      {#if runStatus === 'succeeded'}
        <p class="flex items-center gap-2 text-sm" data-testid="transfer-result-success">
          <Fa icon={faCircleCheck} class="text-success shrink-0" />
          <span class="font-semibold">
            {isDownload
              ? m.workspace_transfer_result_downloadSuccess_title()
              : m.workspace_transfer_result_success_title()}
          </span>
        </p>
        {#if downloadFilePath}
          <p class="text-sm text-subtle" data-testid="transfer-result-file">
            {m.workspace_transfer_result_downloadSuccess_message({
              filePath: downloadFilePath,
            })}
          </p>
        {:else}
          <p class="text-sm text-subtle">
            {m.workspace_transfer_result_serverSuccess_message({ title: workspaceTitle })}
          </p>
          {#if restartAgents && interruptedAgents.length > 0}
            <p class="text-xs text-subtle" data-testid="transfer-result-interrupted">
              {interruptedAgents.length === 1
                ? m.workspace_transfer_result_interrupted_one()
                : m.workspace_transfer_result_interrupted_many({
                    count: interruptedAgents.length,
                  })}
            </p>
          {/if}
        {/if}

        {#if destination?.kind === 'server'}
          <label
            class="flex items-start gap-2 text-sm cursor-pointer"
            data-testid="transfer-archive-source"
          >
            <Checkbox
              checked={archiveSource}
              onCheckedChange={(v) => onSetArchiveSource?.(v)}
              ariaLabel={m.workspace_transfer_archiveSource_label()}
            />
            <span class="flex flex-col">
              <span>{m.workspace_transfer_archiveSource_label()}</span>
              <span class="text-xs text-subtle">
                {m.workspace_transfer_archiveSource_description()}
              </span>
            </span>
          </label>
        {/if}

        {#if finalizeStatus === 'running'}
          <p class="text-xs text-subtle" data-testid="transfer-finalizing">
            {m.workspace_transfer_finalizing_message()}
          </p>
        {:else if finalizeStatus === 'error'}
          <p class="text-xs text-danger" data-testid="transfer-finalize-error">
            {m.workspace_transfer_finalizeFailed_error({ error: finalizeError ?? '' })}
          </p>
        {/if}
      {:else}
        <p class="flex items-center gap-2 text-sm" data-testid="transfer-result-failed">
          <Fa icon={faCircleXmark} class="text-danger shrink-0" />
          <span class="font-semibold">
            {isDownload
              ? m.workspace_transfer_result_downloadFailed_title()
              : m.workspace_transfer_result_failed_title()}
          </span>
        </p>
        <p class="text-xs text-subtle" data-testid="transfer-failed-reason">
          {isDownload
            ? m.workspace_transfer_result_downloadFailed_message({ error: runError ?? '' })
            : failurePhase === 'preflight'
              ? m.workspace_transfer_result_preflightFailed_message({ error: runError ?? '' })
              : m.workspace_transfer_result_failed_message({ error: runError ?? '' })}
        </p>
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    {#if step === 'destination'}
      <Button variant="ghost" onclick={() => onCancel?.()}>
        {m.workspace_transfer_cancel_label()}
      </Button>
      <Button variant="primary" onclick={() => onNext?.()} disabled={!canNext}>
        {m.workspace_transfer_next_label()}
      </Button>
    {:else if step === 'confirm'}
      <Button variant="ghost" onclick={() => onBack?.()}>
        {m.workspace_transfer_back_label()}
      </Button>
      <Button variant="ghost" onclick={() => onCancel?.()}>
        {m.workspace_transfer_cancel_label()}
      </Button>
      <Button
        variant="primary"
        onclick={() => onStart?.()}
        disabled={planStatus !== 'loaded'}
        data-testid="transfer-start-button"
      >
        {isDownload
          ? m.workspace_transfer_startDownload_label()
          : m.workspace_transfer_start_label()}
      </Button>
    {:else if step === 'transferring'}
      <Button variant="ghost" onclick={() => onCancel?.()}>
        {m.workspace_transfer_cancel_label()}
      </Button>
    {:else if runStatus === 'succeeded'}
      {#if destination?.kind === 'server'}
        <Button
          variant="ghost"
          onclick={() => onFinalize?.(true)}
          disabled={finalizeStatus === 'running'}
          data-testid="transfer-open-button"
        >
          {m.workspace_transfer_openTarget_label({ label: targetLabel })}
        </Button>
      {/if}
      <Button
        variant="primary"
        onclick={() => onFinalize?.(false)}
        disabled={finalizeStatus === 'running'}
        data-testid="transfer-done-button"
      >
        {m.workspace_transfer_done_label()}
      </Button>
    {:else}
      <Button variant="ghost" onclick={() => onCancel?.()}>
        {m.workspace_transfer_close_label()}
      </Button>
      <Button variant="primary" onclick={() => onRetry?.()} data-testid="transfer-retry-button">
        {m.workspace_transfer_retry_label()}
      </Button>
    {/if}
  {/snippet}
</ContentDialog>
