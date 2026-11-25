<script lang="ts">
  import AgentFailureGroupToast from '$lib/components/ui/toast/AgentFailureGroupToast.svelte';
  import ProviderSwitchDialog from '../ProviderSwitchDialog.svelte';
  import {
    closedProviderSwitchDialog,
    type ProviderSwitchDialogRow,
    type ProviderSwitchDialogState,
  } from '$features/agent/provider-switch-dialog-state';
  import type { BulkSwitchTarget } from '$features/agent/bulk-provider-switch';

  let {
    rows,
    finishedRows,
    onConfirm,
    onRetryAll,
  }: {
    rows: ProviderSwitchDialogRow[];
    /** Rows shown after Confirm, to render per-agent results. */
    finishedRows?: ProviderSwitchDialogRow[];
    onConfirm: (selections: Record<string, BulkSwitchTarget | null>) => void;
    onRetryAll: () => void;
  } = $props();

  let dialog = $state<ProviderSwitchDialogState>({ ...closedProviderSwitchDialog });
</script>

<div class="w-88 rounded-md border bg-popover p-3" data-testid="group-toast">
  <AgentFailureGroupToast
    title="Claude Code usage or rate limit reached — 5 agents"
    errorSummary="You have hit your weekly limit."
    members={['Implementor / Fix login', 'Verifier / Dark mode', 'Planner / Billing']}
    moreCount={2}
    retrying={false}
    onSwitchAll={() => {
      dialog = {
        ...closedProviderSwitchDialog,
        open: true,
        groupKey: 'quota:claude-code',
        kind: 'quota',
        providerLabel: 'Claude Code',
        rows,
      };
    }}
    {onRetryAll}
    onClose={() => {}}
  />
</div>

<ProviderSwitchDialog
  state={dialog}
  onSelect={(rowKey, target) => {
    dialog = {
      ...dialog,
      rows: dialog.rows.map((row) => (row.key === rowKey ? { ...row, selection: target } : row)),
    };
  }}
  onConfirm={() => {
    onConfirm(Object.fromEntries(dialog.rows.map((row) => [row.key, row.selection])));
    if (finishedRows) dialog = { ...dialog, rows: finishedRows, finished: true };
  }}
  {onRetryAll}
  onClose={() => (dialog = { ...closedProviderSwitchDialog })}
/>
