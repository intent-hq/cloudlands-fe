<script lang="ts">
  /**
   * TransferWorkspaceModal — the Transfer/Download wizard (steps 1–2).
   *
   * Presentational: all state arrives as props from the Redux host
   * (`TransferWorkspaceModalHost`), following the ConnectBackendModal layout.
   *   1. `destination` — pick a target server (remote connections minus the
   *      active backend) or "Download to file".
   *   2. `confirm` — render the `workspace.transfer.plan` result: manifest
   *      counts, size estimate, git summary, and pre-flight warnings.
   * Starting the transfer is a later surface; Next on the confirm step is
   * intentionally absent.
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faDownload,
    faServer,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatBytesBinary, formatInteger } from '$lib/i18n/format';
  import { formatConnectionLabel } from '$lib/components/layout/DaemonStatusIndicator.svelte';
  import type { ConnectionRecord } from '$store/renderer/slices/connections/connections-types';
  import type {
    TransferDestination,
    TransferPlan,
    TransferPlanStatus,
    TransferStep,
  } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';

  interface Props {
    open?: boolean;
    workspaceTitle?: string;
    step?: TransferStep;
    /** Eligible target servers (remotes minus the active backend). */
    connections?: ConnectionRecord[];
    destination?: TransferDestination | null;
    planStatus?: TransferPlanStatus;
    plan?: TransferPlan | null;
    planError?: string | null;
    onSelectDestination?: (destination: TransferDestination) => void;
    onNext?: () => void;
    onBack?: () => void;
    onCancel?: () => void;
  }

  let {
    open = false,
    workspaceTitle = '',
    step = 'destination',
    connections = [],
    destination = null,
    planStatus = 'idle',
    plan = null,
    planError = null,
    onSelectDestination,
    onNext,
    onBack,
    onCancel,
  }: Props = $props();

  const canNext = $derived(step === 'destination' && destination != null);

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

  function isSelected(candidate: TransferDestination): boolean {
    if (!destination) return false;
    if (destination.kind === 'download') return candidate.kind === 'download';
    return candidate.kind === 'server' && candidate.connectionId === destination.connectionId;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel?.();
    } else {
      e.stopPropagation();
    }
  }

  const optionClass =
    'w-full flex items-center gap-3 px-3 py-2 border rounded text-left text-sm transition-colors';
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
      aria-labelledby="transfer-modal-title"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 id="transfer-modal-title" class="text-lg font-semibold">
          {m.workspace_transfer_modal_title()}
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
        {#if step === 'destination'}
          <p class="text-sm text-subtle">
            {m.workspace_transfer_destination_description({ title: workspaceTitle })}
          </p>

          <div class="space-y-1">
            <span class="text-xs text-subtle">{m.workspace_transfer_servers_label()}</span>
            {#if connections.length === 0}
              <p class="text-xs text-subtle bg-muted/50 rounded p-2" data-testid="transfer-empty-servers">
                {m.workspace_transfer_emptyServers_message()}
              </p>
            {:else}
              <div class="space-y-1">
                {#each connections as conn (conn.id)}
                  <button
                    type="button"
                    class="{optionClass} {isSelected({ kind: 'server', connectionId: conn.id })
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted/50'}"
                    data-testid="transfer-server-{conn.id}"
                    aria-pressed={isSelected({ kind: 'server', connectionId: conn.id })}
                    onclick={() =>
                      onSelectDestination?.({ kind: 'server', connectionId: conn.id })}
                  >
                    <Fa icon={faServer} class="text-subtle shrink-0" />
                    <span class="truncate">{formatConnectionLabel(conn)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <div class="space-y-1">
            <button
              type="button"
              class="{optionClass} {isSelected({ kind: 'download' })
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted/50'}"
              data-testid="transfer-download-option"
              aria-pressed={isSelected({ kind: 'download' })}
              onclick={() => onSelectDestination?.({ kind: 'download' })}
            >
              <Fa icon={faDownload} class="text-subtle shrink-0" />
              <span class="flex flex-col min-w-0">
                <span>{m.workspace_transfer_download_label()}</span>
                <span class="text-xs text-subtle">
                  {m.workspace_transfer_download_description()}
                </span>
              </span>
            </button>
          </div>
        {:else}
          <p class="text-sm text-subtle">{m.workspace_transfer_confirm_description()}</p>
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
            <p class="text-xs text-red-500" data-testid="transfer-plan-error">
              {m.workspace_transfer_planFailed_error({ error: planError ?? '' })}
            </p>
          {:else if plan}
            {#if plan.warnings.length > 0}
              <div class="space-y-1" data-testid="transfer-warnings">
                <span class="text-xs text-subtle">{m.workspace_transfer_warnings_label()}</span>
                {#each plan.warnings as warning (warning.code)}
                  <p class="flex items-start gap-2 text-xs bg-muted/50 rounded p-2">
                    <Fa icon={faTriangleExclamation} class="text-amber-500 shrink-0 mt-0.5" />
                    <span>{warning.message}</span>
                  </p>
                {/each}
              </div>
            {/if}

            <div class="space-y-1">
              <span class="text-xs text-subtle">{m.workspace_transfer_sizeEstimate_label()}</span>
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
                  <p>{m.workspace_transfer_gitBranch_label({ branch: plan.manifest.git.branch })}</p>
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

            <p class="text-xs text-subtle">{m.workspace_transfer_notTransferred_message()}</p>
            <p class="text-xs text-subtle italic" data-testid="transfer-coming-soon">
              {m.workspace_transfer_comingSoon_message()}
            </p>
          {/if}
        {/if}
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        {#if step === 'destination'}
          <Button variant="ghost" onclick={() => onCancel?.()}>
            {m.workspace_transfer_cancel_label()}
          </Button>
          <Button variant="default" onclick={() => onNext?.()} disabled={!canNext}>
            {m.workspace_transfer_next_label()}
          </Button>
        {:else}
          <Button variant="ghost" onclick={() => onBack?.()}>
            {m.workspace_transfer_back_label()}
          </Button>
          <Button variant="default" onclick={() => onCancel?.()}>
            {m.workspace_transfer_cancel_label()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}
