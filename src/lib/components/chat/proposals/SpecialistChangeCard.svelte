<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type {
    ProposalActionDetail,
    ProposalEditableField,
    SpecialistEditProposal,
  } from '$shared/types/proposal';
  import { selectSpecialistProposalAppliedState } from '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors';
  import {
    selectProposalError,
    selectProposalStatus,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import { getProposalId } from './proposal-id';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    proposal: SpecialistEditProposal;
    disabled?: boolean;
    onApply?: (detail: ProposalActionDetail) => void;
    onDiscard?: (detail: ProposalActionDetail) => void;
    onUndo?: (proposalId: string) => void;
  }

  type DisplayRow = {
    key: string;
    label: string;
    before: unknown;
    after: unknown;
  };

  let { proposal, disabled = false, onApply, onDiscard, onUndo }: Props = $props();
  let rootElement = $state<HTMLElement | undefined>();
  let statusElement = $state<HTMLElement | undefined>();
  let isDismissed = $state(false);
  let now = $state(Date.now());

  const proposalId = $derived(getProposalId(proposal));
  const appliedState = selectSpecialistProposalAppliedState(untrack(() => proposalId));
  const lifecycleStatus = selectProposalStatus(untrack(() => proposalId));
  const lifecycleError = selectProposalError(untrack(() => proposalId));
  const rows = $derived((proposal.preview.fields ?? []).map(fieldToRow));
  const isApplying = $derived($lifecycleStatus === 'applying');
  const isUndoing = $derived($lifecycleStatus === 'undoing');
  const isFailed = $derived($lifecycleStatus === 'failed');
  const isApplied = $derived($lifecycleStatus === 'applied' || Boolean($appliedState));
  const actionDisabled = $derived(disabled || isApplying || isUndoing);
  const timeAgo = $derived($appliedState ? formatTimeAgo(now - $appliedState.appliedAt) : '');
  const statusMessage = $derived(getStatusMessage());

  $effect(() => {
    if (!$appliedState || typeof window === 'undefined') return;
    now = Date.now();
    const intervalId = window.setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => window.clearInterval(intervalId);
  });

  $effect(() => {
    if (!statusMessage) return;
    void tick().then(() => statusElement?.focus());
  });

  function fieldToRow(field: ProposalEditableField): DisplayRow {
    return {
      key: field.key,
      label: field.label,
      before: field.before,
      after: field.after ?? field.value,
    };
  }

  function formatRowValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '(none)';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value) ?? String(value);
  }

  function formatTimeAgo(deltaMs: number): string {
    const seconds = Math.max(0, Math.floor(deltaMs / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  function buildDetail(): ProposalActionDetail {
    return { proposal, editedFields: {}, selectedBulkItemIds: [] };
  }

  function getStatusMessage(): string {
    if (isApplying) return 'Applying…';
    if (isUndoing) return 'Undoing…';
    if (isFailed)
      return `${m.chat_shared_actionFailed_label()}${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
    if ($lifecycleStatus === 'applied') return 'Applied.';
    return '';
  }

  function emitAction(name: string, detail: unknown) {
    rootElement?.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  function handleApply() {
    const detail = buildDetail();
    onApply?.(detail);
    emitAction('proposalapply', detail);
  }

  function handleDiscard() {
    const detail = buildDetail();
    isDismissed = true;
    onDiscard?.(detail);
    emitAction('proposaldiscard', detail);
  }

  function handleUndo() {
    onUndo?.(proposalId);
    emitAction('proposalundo', { proposalId, proposal });
  }
</script>

{#if isDismissed}
  <div class="my-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-subtle">
    {m.chat_shared_discarded_label()} {proposal.preview.title}
  </div>
{:else}
  <section
    bind:this={rootElement}
    class="my-2 w-full max-w-xl overflow-hidden rounded-lg border border-border bg-background"
    data-proposal-kind={proposal.kind}
    data-apply-tool-call-id={proposal.applyToolCallId}
    title={proposal.applyToolCallId
      ? m.chat_shared_tool_title({ id: proposal.applyToolCallId })
      : undefined}
  >
    <div class="px-3 pt-3">
      <h3 class="text-sm font-semibold leading-snug text-foreground">{proposal.preview.title}</h3>
      {#if proposal.preview.summary}
        <p class="mt-1 text-xs leading-relaxed text-subtle">{proposal.preview.summary}</p>
      {/if}
    </div>

    <div class="space-y-2 px-3 py-2.5">
      {#each rows as row (row.key)}
        <div class="rounded-md bg-muted/20 px-2.5 py-2 text-sm" data-proposal-field={row.key}>
          <span class="font-medium text-foreground">{row.label}</span><span class="text-subtle"
            >:
          </span>
          <span class="text-subtle" data-proposal-before-after-row={row.key}
            >{formatRowValue(row.before)} → {formatRowValue(row.after)}</span
          >
        </div>
      {/each}
    </div>

    {#if statusMessage}
      <div
        bind:this={statusElement}
        class="border-t border-border/60 px-3 py-2 text-xs text-subtle focus:outline-none"
        role="status"
        aria-live={isFailed ? 'assertive' : 'polite'}
        tabindex="-1"
      >
        {statusMessage}
      </div>
    {/if}

    {#if isApplied || isUndoing}
      <div
        class="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2.5 text-xs text-subtle"
      >
        <span>{m.chat_shared_appliedTimeAgo_label({ timeAgo })} <span aria-hidden="true">·</span></span>
        <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleUndo}>
          {isUndoing ? 'Undoing…' : isFailed ? 'Retry' : 'Undo'}
        </Button>
      </div>
    {:else}
      <div class="flex items-center justify-end gap-2 px-3 pb-3 pt-1">
        <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
          >{m.chat_shared_discard_label()}</Button
        >
        <Button size="sm" disabled={actionDisabled} onclick={handleApply}>
          {isApplying ? 'Applying…' : isFailed ? 'Retry' : (proposal.preview.applyLabel ?? 'Apply')}
        </Button>
      </div>
    {/if}
  </section>
{/if}
