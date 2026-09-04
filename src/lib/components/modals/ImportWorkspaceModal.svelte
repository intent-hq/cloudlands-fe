<script lang="ts">
  /**
   * ImportWorkspaceModal — the "Import Workspace from File…" wizard.
   *
   * Presentational: all state arrives as props from the Redux host
   * (`ImportWorkspaceModalHost`), following the TransferWorkspaceModal layout.
   *   1. `importing` — live progress (reading/uploading/committing phases,
   *      bytes uploaded vs archive size).
   *   2. `result` — success (workspace title, interrupted agents, Open
   *      button) or failure (daemon error verbatim + Retry against the
   *      same file).
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faCircleCheck, faCircleXmark, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary } from '$lib/i18n/format';
  import type {
    ImportProgress,
    ImportRunStatus,
    ImportStep,
  } from '$store/renderer/slices/workspace-import/workspace-import-types';

  interface Props {
    open?: boolean;
    step?: ImportStep;
    runStatus?: ImportRunStatus;
    progress?: ImportProgress | null;
    runError?: string | null;
    workspaceTitle?: string;
    interruptedAgents?: string[];
    onCancel?: () => void;
    onRetry?: () => void;
    onOpenWorkspace?: () => void;
  }

  let {
    open = false,
    step = 'importing',
    runStatus = 'idle',
    progress = null,
    runError = null,
    workspaceTitle = '',
    interruptedAgents = [],
    onCancel,
    onRetry,
    onOpenWorkspace,
  }: Props = $props();

  /** Human copy for the current import phase. */
  const progressLabel = $derived.by(() => {
    if (!progress || progress.phase === 'reading') return m.workspace_import_phase_reading();
    if (progress.phase === 'committing') return m.workspace_import_phase_committing();
    return m.workspace_import_phase_uploading();
  });

  /** Upload fraction against the archive size; indeterminate while reading. */
  const progressFraction = $derived.by(() => {
    if (!progress || progress.phase === 'reading') return null;
    if (!progress.bytesTotal || progress.bytesTotal <= 0) return null;
    return Math.min(1, progress.bytesUp / progress.bytesTotal);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel?.();
    } else {
      e.stopPropagation();
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="presentation"
    onclick={() => onCancel?.()}
    onkeydown={handleKeydown}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 id="import-modal-title" class="text-lg font-semibold">
          {m.workspace_import_modal_title()}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onclick={() => onCancel?.()}
          aria-label={m.workspace_transfer_close_ariaLabel()}
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        {#if step === 'importing'}
          <p class="text-sm" data-testid="import-progress-label">
            {m.workspace_import_importing_title()}
          </p>
          <p class="text-sm text-subtle" data-testid="import-progress-stage">{progressLabel}</p>

          <div
            class="h-2 w-full rounded bg-muted overflow-hidden"
            role="progressbar"
            aria-label={m.workspace_import_progress_ariaLabel()}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressFraction != null
              ? Math.round(progressFraction * 100)
              : undefined}
            data-testid="import-progress-bar"
          >
            {#if progressFraction != null}
              <div
                class="h-full bg-primary transition-[width] duration-300"
                style="width: {Math.round(progressFraction * 100)}%"
              ></div>
            {:else}
              <div class="h-full w-1/3 bg-primary/60 animate-pulse"></div>
            {/if}
          </div>

          {#if progress && progress.bytesTotal > 0}
            <p class="text-xs text-subtle" data-testid="import-progress-bytes">
              {m.workspace_transfer_bytesUp_label({
                bytes: formatBytesBinary(progress.bytesUp),
              })}
              {m.workspace_transfer_ofEstimate_label({
                bytes: formatBytesBinary(progress.bytesTotal),
              })}
            </p>
          {/if}
        {:else if runStatus === 'succeeded'}
          <p class="flex items-center gap-2 text-sm" data-testid="import-result-success">
            <Fa icon={faCircleCheck} class="text-green-500 shrink-0" />
            <span class="font-semibold">{m.workspace_import_result_success_title()}</span>
          </p>
          <p class="text-sm text-subtle" data-testid="import-result-message">
            {m.workspace_import_result_success_message({ title: workspaceTitle })}
          </p>
          {#if interruptedAgents.length > 0}
            <p class="text-xs text-subtle" data-testid="import-result-interrupted">
              {interruptedAgents.length === 1
                ? m.workspace_import_result_interrupted_one()
                : m.workspace_import_result_interrupted_many({
                    count: interruptedAgents.length,
                  })}
            </p>
          {/if}
        {:else}
          <p class="flex items-center gap-2 text-sm" data-testid="import-result-failed">
            <Fa icon={faCircleXmark} class="text-danger shrink-0" />
            <span class="font-semibold">{m.workspace_import_result_failed_title()}</span>
          </p>
          <p class="text-xs text-subtle" data-testid="import-failed-reason">
            {m.workspace_import_result_failed_message({ error: runError ?? '' })}
          </p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        {#if step === 'importing'}
          <Button variant="ghost" onclick={() => onCancel?.()}>
            {m.workspace_transfer_cancel_label()}
          </Button>
        {:else if runStatus === 'succeeded'}
          <Button variant="ghost" onclick={() => onCancel?.()} data-testid="import-done-button">
            {m.workspace_transfer_done_label()}
          </Button>
          <Button
            variant="default"
            onclick={() => onOpenWorkspace?.()}
            data-testid="import-open-button"
          >
            {m.workspace_import_openWorkspace_label()}
          </Button>
        {:else}
          <Button variant="ghost" onclick={() => onCancel?.()}>
            {m.workspace_transfer_close_label()}
          </Button>
          <Button variant="default" onclick={() => onRetry?.()} data-testid="import-retry-button">
            {m.workspace_transfer_retry_label()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
