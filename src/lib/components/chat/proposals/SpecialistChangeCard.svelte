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
    /** Tray-hosted Dismiss: skip the local "Discarded" tombstone state. */
    suppressLocalDiscard?: boolean;
  }

  type DisplayRow = {
    key: string;
    label: string;
    before: unknown;
    after: unknown;
  };

  let {
    proposal,
    disabled = false,
    onApply,
    onDiscard,
    onUndo,
    suppressLocalDiscard = false,
  }: Props = $props();
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
  const showDismissed = $derived(isDismissed);
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
    if (value === null || value === undefined || value === '')
      return m.chat_shared_valueNone_label();
    if (typeof value === 'boolean')
      return value ? m.chat_shared_valueOn_label() : m.chat_shared_valueOff_label();
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
    if (isApplying) return m.chat_shared_applying_label();
    if (isUndoing) return m.chat_shared_undoing_label();
    if (isFailed)
      return `${m.chat_shared_actionFailed_label()}${$lifecycleError ? `: ${$lifecycleError}` : ''}`;
    if ($lifecycleStatus === 'applied') return m.chat_shared_appliedStatus_label();
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
    if (!suppressLocalDiscard) isDismissed = true;
    onDiscard?.(detail);
    emitAction('proposaldiscard', detail);
  }

  function handleUndo() {
    onUndo?.(proposalId);
    emitAction('proposalundo', { proposalId, proposal });
  }
</script>

{#if showDismissed}
  <div
    class="type-body my-2 rounded-(--radius-medium) border border-border bg-muted/30 px-3 py-2 text-muted-foreground"
  >
    {m.chat_shared_discarded_label()}
    {proposal.preview.title}
  </div>
{:else}
  <section
    bind:this={rootElement}
    class="my-2 min-w-0 w-full max-w-xl overflow-hidden rounded-(--radius-medium) border border-border bg-card shadow-(--elevation-raised)"
    data-proposal-kind={proposal.kind}
    data-apply-tool-call-id={proposal.applyToolCallId}
    title={proposal.applyToolCallId
      ? m.chat_shared_tool_title({ id: proposal.applyToolCallId })
      : undefined}
  >
    <div class="px-3 pt-3">
      <h3 class="type-body font-medium leading-snug text-foreground">{proposal.preview.title}</h3>
      {#if proposal.preview.summary}
        <p class="type-body mt-1 leading-relaxed text-muted-foreground">
          {proposal.preview.summary}
        </p>
      {/if}
    </div>

    <div class="space-y-2 px-3 py-2.5">
      {#each rows as row (row.key)}
        <div
          class="type-body min-w-0 break-words rounded-(--radius-medium) border border-border bg-background px-3 py-2.5"
          data-proposal-field={row.key}
        >
          <span class="font-medium text-foreground">{row.label}</span><span
            class="text-muted-foreground"
            >:
          </span>
          <span class="text-muted-foreground" data-proposal-before-after-row={row.key}
            >{formatRowValue(row.before)} → {formatRowValue(row.after)}</span
          >
        </div>
      {/each}
    </div>

    {#if statusMessage}
      <div
        bind:this={statusElement}
        class={isFailed
          ? 'type-caption border-t border-border px-3 py-2 text-danger focus:outline-none'
          : 'type-caption border-t border-border px-3 py-2 text-muted-foreground focus:outline-none'}
        role="status"
        aria-live={isFailed ? 'assertive' : 'polite'}
        tabindex="-1"
      >
        {statusMessage}
      </div>
    {/if}

    {#if isApplied || isUndoing}
      <div
        class="type-caption flex items-center justify-between gap-3 border-t border-success/30 bg-success/10 px-3 py-2.5 text-muted-foreground"
      >
        <span class="text-success"
          >{m.chat_shared_appliedTimeAgo_label({ timeAgo })} <span aria-hidden="true">·</span></span
        >
        <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleUndo}>
          {isUndoing
            ? m.chat_shared_undoing_label()
            : isFailed
              ? m.chat_shared_retry_label()
              : m.chat_shared_undo_label()}
        </Button>
      </div>
    {:else}
      <div class="flex items-center justify-end gap-2 border-t border-border bg-muted/10 px-3 py-3">
        <Button variant="outline" size="sm" disabled={actionDisabled} onclick={handleDiscard}
          >{m.chat_shared_discard_label()}</Button
        >
        <Button size="sm" disabled={actionDisabled} onclick={handleApply}>
          {isApplying
            ? m.chat_shared_applying_label()
            : isFailed
              ? m.chat_shared_retry_label()
              : (proposal.preview.applyLabel ?? m.chat_shared_apply_label())}
        </Button>
      </div>
    {/if}
  </section>
{/if}
