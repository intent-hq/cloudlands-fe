<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Select } from '$lib/components/ui/select';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { FormActions } from '$lib/components/patterns/form';
  import { ListRow } from '$lib/components/patterns/collection';
  import type {
    ProviderSwitchDialogAgent,
    ProviderSwitchDialogRow,
    ProviderSwitchDialogState,
  } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-types';
  import type { BulkSwitchTarget } from '$features/agent/bulk-provider-switch';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    state: ProviderSwitchDialogState;
    inline?: boolean;
    onSelect: (rowKey: string, target: BulkSwitchTarget) => void;
    onConfirm: () => void;
    onRetryAll: () => void;
    onClose: () => void;
  }

  let { state, inline = false, onSelect, onConfirm, onRetryAll, onClose }: Props = $props();

  // i18n-ignore (internal option separator, not user-facing)
  const SEPARATOR = '\u0000';

  const busy = $derived(state.running);
  const switchable = $derived(state.rows.some((row) => row.selection && row.targets.length > 0));
  const noTargets = $derived(
    !state.loading && state.rows.length > 0 && state.rows.every((row) => row.targets.length === 0),
  );

  function items(row: ProviderSwitchDialogRow) {
    return row.targets.flatMap((target) =>
      target.models.map((model) => ({
        value: `${target.providerId}${SEPARATOR}${model.value}`,
        label: `${target.label} · ${model.label}`,
      })),
    );
  }

  function selectionValue(row: ProviderSwitchDialogRow): string {
    return row.selection ? `${row.selection.providerId}${SEPARATOR}${row.selection.modelId}` : '';
  }

  function choose(row: ProviderSwitchDialogRow, value: string) {
    const [providerId, modelId] = value.split(SEPARATOR);
    if (providerId && modelId) onSelect(row.key, { providerId, modelId });
  }

  function countLabel(row: ProviderSwitchDialogRow): string {
    const count = row.agents.length;
    const agents =
      count === 1
        ? m.agent_providerSwitch_agentCount_one({ count: formatInteger(count) })
        : m.agent_providerSwitch_agentCount_many({ count: formatInteger(count) });
    if (row.workerCount === 0) return agents;
    const workers =
      row.workerCount === 1
        ? m.agent_providerSwitch_workerCount_one({ count: formatInteger(row.workerCount) })
        : m.agent_providerSwitch_workerCount_many({ count: formatInteger(row.workerCount) });
    return `${agents}, ${workers}`;
  }

  function agentStatus(
    row: ProviderSwitchDialogRow,
    agent: ProviderSwitchDialogAgent,
  ): { text: string; tone: 'muted' | 'ok' | 'error' } | null {
    const outcome = agent.outcome;
    if (outcome?.status === 'switched')
      return { text: m.agent_providerSwitch_switched_label(), tone: 'ok' };
    if (outcome?.status === 'retried')
      return { text: m.agent_providerSwitch_retried_label(), tone: 'ok' };
    if (outcome?.status === 'gone')
      return { text: m.agent_providerSwitch_gone_label(), tone: 'muted' };
    if (outcome?.status === 'failed') {
      return { text: m.agent_providerSwitch_failed_label(), tone: 'error' };
    }
    if (row.selection && !agent.eligibleProviderIds.includes(row.selection.providerId)) {
      return { text: m.agent_providerSwitch_unavailable_label(), tone: 'muted' };
    }
    return null;
  }

  function workersSwitchedLabel(count: number): string {
    return count === 1
      ? m.agent_providerSwitch_workersSwitched_one({ count: formatInteger(count) })
      : m.agent_providerSwitch_workersSwitched_many({ count: formatInteger(count) });
  }
</script>

{#if state.open}
  <ContentDialog
    open
    static={inline}
    title={m.agent_providerSwitch_dialog_title({ provider: state.providerLabel })}
    description={m.agent_providerSwitch_dialog_description()}
    titleId="provider-switch-dialog-title"
    descriptionId="provider-switch-dialog-description"
    closeLabel={m.agent_providerSwitch_close_label()}
    {busy}
    allowOverflow
    dismissOnInteractOutside={false}
    onClose={() => {
      if (!busy) onClose();
    }}
  >
    <div class="grid gap-4" data-testid="provider-switch-rows" aria-busy={busy || state.loading}>
      {#if state.loading}
        <p class="text-sm text-muted-foreground">{m.agent_providerSwitch_loading_label()}</p>
      {/if}
      {#each state.rows as row (row.key)}
        <section
          class="grid min-w-0 gap-2"
          data-testid="provider-switch-row"
          data-row-key={row.key}
        >
          <div class="flex min-w-0 items-center justify-between gap-3">
            <p class="min-w-0 truncate text-sm font-medium" title={row.label}>{row.label}</p>
            <p class="shrink-0 text-sm text-muted-foreground">{countLabel(row)}</p>
          </div>
          {#if !state.loading && row.targets.length > 0}
            <Select.Root
              value={selectionValue(row)}
              items={items(row)}
              disabled={busy || state.finished}
              onchange={(value) => choose(row, value)}
            >
              <Select.Trigger
                aria-label={m.agent_providerSwitch_target_ariaLabel({ source: row.label })}
              >
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each items(row) as item (item.value)}
                  <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
          <div class="grid">
            {#each row.agents as agent (agent.agentId)}
              {@const status = agentStatus(row, agent)}
              <ListRow
                class="min-h-7 gap-3 px-0 py-0.5"
                data-testid="provider-switch-agent"
                data-agent-id={agent.agentId}
              >
                {#snippet title()}
                  <span class="text-muted-foreground">
                    {agent.workspaceName ? `${agent.name} / ${agent.workspaceName}` : agent.name}
                  </span>
                {/snippet}
                {#snippet description()}
                  {#if agent.outcome?.status === 'failed' && agent.outcome.reason}
                    <span class="break-words text-danger" data-testid="provider-switch-agent-reason"
                      >{agent.outcome.reason}</span
                    >
                  {/if}
                {/snippet}
                {#snippet trailing()}
                  {#if status}
                    <span
                      class="whitespace-nowrap"
                      class:text-muted-foreground={status.tone === 'muted'}
                      class:text-success={status.tone === 'ok'}
                      class:text-danger={status.tone === 'error'}
                      data-testid="provider-switch-agent-status">{status.text}</span
                    >
                  {/if}
                {/snippet}
              </ListRow>
            {/each}
          </div>
          {#if row.workersSwitched}
            <p class="text-sm text-muted-foreground" data-testid="provider-switch-workers-switched">
              {workersSwitchedLabel(row.workersSwitched)}
            </p>
          {/if}
        </section>
      {/each}
      {#if noTargets}
        <InputMessage>{m.agent_providerSwitch_noTargets_label()}</InputMessage>
      {/if}
    </div>
    {#snippet footer()}
      <FormActions class="gap-1 [&>[data-slot=form-actions-end]]:gap-1">
        {#snippet destructive()}
          {#if busy}
            <span class="px-2 text-sm text-muted-foreground" data-testid="provider-switch-progress">
              {m.agent_providerSwitch_progress_label({
                done: formatInteger(state.progress.done),
                total: formatInteger(state.progress.total),
              })}
            </span>
          {/if}
        {/snippet}
        {#snippet secondary()}
          {#if !state.finished}
            <Button
              variant="ghost-light"
              class="px-2"
              disabled={busy || state.loading}
              onclick={onRetryAll}
            >
              {m.agent_failureGroupToast_retryAll_label()}
            </Button>
          {/if}
        {/snippet}
        {#snippet primary()}
          {#if state.finished}
            <Button variant="primary" onclick={onClose}
              >{m.agent_providerSwitch_close_label()}</Button
            >
          {:else}
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || state.loading || !switchable}
              onclick={onConfirm}
            >
              {m.agent_providerSwitch_confirm_label()}
            </Button>
          {/if}
        {/snippet}
      </FormActions>
    {/snippet}
  </ContentDialog>
{/if}
