<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { InputMessage } from '$lib/components/ui/input-message';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { FormActions } from '$lib/components/patterns/form';
  import type {
    ProviderSwitchDialogRow,
    ProviderSwitchDialogView,
  } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-types';
  import type { BulkSwitchTarget } from '$features/agent/bulk-provider-switch';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    state: ProviderSwitchDialogView;
    inline?: boolean;
    onSelect: (rowKey: string, target: BulkSwitchTarget) => void;
    onConfirm: () => void;
    onRetryAll: () => void;
    onClose: () => void;
  }

  let { state, inline = false, onSelect, onConfirm, onRetryAll, onClose }: Props = $props();

  const busy = $derived(state.running);
  const switchable = $derived(state.rows.some((row) => row.selection && row.targets.length > 0));
  const noTargets = $derived(
    !state.loading && state.rows.length > 0 && state.rows.every((row) => row.targets.length === 0),
  );

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

  type Tone = 'muted' | 'ok' | 'error';
  type CountMessage = (input: { count: string }) => string;

  function counted(count: number, one: CountMessage, many: CountMessage): string {
    return (count === 1 ? one : many)({ count: formatInteger(count) });
  }

  /** Before a run: agents the chosen target cannot serve. After: per-status counts. */
  function rowSummary(row: ProviderSwitchDialogRow): { text: string; tone: Tone }[] {
    const outcomes = row.agents.map((agent) => agent.outcome?.status);
    if (outcomes.every((status) => status === undefined)) {
      const unavailable = row.selection
        ? row.agents.filter(
            (agent) => !agent.eligibleProviderIds.includes(row.selection?.providerId ?? ''),
          ).length
        : 0;
      return unavailable > 0
        ? [
            {
              text: counted(
                unavailable,
                m.agent_providerSwitch_unavailableCount_one,
                m.agent_providerSwitch_unavailableCount_many,
              ),
              tone: 'muted',
            },
          ]
        : [];
    }
    const count = (status: string) => outcomes.filter((outcome) => outcome === status).length;
    const parts: { text: string; tone: Tone; n: number }[] = [
      {
        n: count('switched'),
        tone: 'ok',
        text: counted(
          count('switched'),
          m.agent_providerSwitch_switchedCount_one,
          m.agent_providerSwitch_switchedCount_many,
        ),
      },
      {
        n: count('retried'),
        tone: 'ok',
        text: counted(
          count('retried'),
          m.agent_providerSwitch_retriedCount_one,
          m.agent_providerSwitch_retriedCount_many,
        ),
      },
      {
        n: count('unavailable'),
        tone: 'muted',
        text: counted(
          count('unavailable'),
          m.agent_providerSwitch_notAvailableCount_one,
          m.agent_providerSwitch_notAvailableCount_many,
        ),
      },
      {
        n: count('gone'),
        tone: 'muted',
        text: counted(
          count('gone'),
          m.agent_providerSwitch_goneCount_one,
          m.agent_providerSwitch_goneCount_many,
        ),
      },
      {
        n: count('failed'),
        tone: 'error',
        text: counted(
          count('failed'),
          m.agent_providerSwitch_failedCount_one,
          m.agent_providerSwitch_failedCount_many,
        ),
      },
    ];
    return parts.filter((part) => part.n > 0).map(({ text, tone }) => ({ text, tone }));
  }

  function failureReasons(row: ProviderSwitchDialogRow): string[] {
    return [
      ...new Set(
        row.agents.flatMap((agent) =>
          agent.outcome?.status === 'failed' && agent.outcome.reason ? [agent.outcome.reason] : [],
        ),
      ),
    ];
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
        {@const summary = rowSummary(row)}
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
            <div
              data-testid="provider-switch-picker"
              inert={busy || state.finished}
              class:opacity-60={busy || state.finished}
            >
              <ModelPicker
                workspaceId={row.pickerWorkspaceId}
                allowedProviderIds={row.targets.map((target) => target.providerId)}
                selectedModel={row.selection
                  ? `${row.selection.providerId}:${row.selection.modelId}`
                  : undefined}
                onModelChange={(_model, pick) => {
                  if (pick) onSelect(row.key, pick);
                }}
                showDefaultOption={false}
                variant="outline"
                size="sm"
                fullWidth
                modalAware
              />
            </div>
          {/if}
          {#if summary.length > 0}
            <p class="flex flex-wrap gap-x-1.5 text-sm" data-testid="provider-switch-summary">
              {#each summary as part, index (part.text)}
                {#if index > 0}<span class="text-muted-foreground" aria-hidden="true">·</span>{/if}
                <span
                  class:text-muted-foreground={part.tone === 'muted'}
                  class:text-success={part.tone === 'ok'}
                  class:text-danger={part.tone === 'error'}>{part.text}</span
                >
              {/each}
            </p>
          {/if}
          {#each failureReasons(row) as reason (reason)}
            <p class="break-words text-sm text-danger" data-testid="provider-switch-reason">
              {reason}
            </p>
          {/each}
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
