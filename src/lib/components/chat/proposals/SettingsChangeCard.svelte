<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Select } from '$lib/components/ui/select';
  import {
    findAppSettingDefinition,
    formatSettingValue,
    type AppSettingApplyPlan,
    type AppSettingDefinition,
  } from '$shared/app-settings-schema';
  import type {
    ProposalActionDetail,
    ProposalEditableField,
    SettingsChangeProposal,
  } from '$shared/types/proposal';
  import { selectProposalAppliedState } from '$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors';
  import {
    selectProposalError,
    selectProposalStatus,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import { getProposalId } from './proposal-id';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    proposal: SettingsChangeProposal;
    disabled?: boolean;
    onApply?: (detail: ProposalActionDetail) => void;
    onDiscard?: (detail: ProposalActionDetail) => void;
    onUndo?: (proposalId: string) => void;
    /** Tray-hosted Dismiss: skip the local "Discarded" tombstone state. */
    suppressLocalDiscard?: boolean;
    /**
     * Tray-hosted restore: enum edits captured by a previous mount,
     * string-serialized ('' encodes null). Applied once at init.
     */
    initialEditedFields?: Record<string, string> | null;
    /** Reports every enum-edit change (string-serialized) for persistence. */
    onEditedFieldsChange?: (fields: Record<string, string>) => void;
  }

  type SettingsChangePayload = { path: string; value: unknown; apply?: AppSettingApplyPlan };
  type DisplayRow = {
    key: string;
    label: string;
    before: unknown;
    after: unknown;
    rawAfter: unknown;
    editable: boolean;
  };

  let {
    proposal,
    disabled = false,
    onApply,
    onDiscard,
    onUndo,
    suppressLocalDiscard = false,
    initialEditedFields = null,
    onEditedFieldsChange,
  }: Props = $props();
  let rootElement = $state<HTMLElement | undefined>();
  let statusElement = $state<HTMLElement | undefined>();
  let isDismissed = $state(false);
  let editedFields = $state<Record<string, unknown>>(restoreEditedFields());
  let now = $state(Date.now());

  const proposalId = $derived(getProposalId(proposal));
  const appliedState = selectProposalAppliedState(untrack(() => proposalId));
  const lifecycleStatus = selectProposalStatus(untrack(() => proposalId));
  const lifecycleError = selectProposalError(untrack(() => proposalId));
  const rows = $derived(buildRows(proposal));
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

  // Enum edits are string-serialized for draft persistence ('' encodes the
  // nullable clear), matching handleEnumEdit's own value space.
  function restoreEditedFields(): Record<string, unknown> {
    if (!initialEditedFields) return {};
    const restored: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(initialEditedFields)) {
      const definition = findAppSettingDefinition(key);
      restored[key] = definition?.nullable === true && value === '' ? null : value;
    }
    return restored;
  }

  function getProposalChanges(currentProposal: SettingsChangeProposal): SettingsChangePayload[] {
    return currentProposal.payload.changes;
  }

  function buildRows(currentProposal: SettingsChangeProposal): DisplayRow[] {
    const fields = currentProposal.preview.fields ?? [];
    const changesByPath = new Map(
      getProposalChanges(currentProposal).map((change) => [change.path, change]),
    );
    if (fields.length > 0)
      return fields.map((field) => fieldToRow(field, changesByPath.get(field.key)));
    return getProposalChanges(currentProposal).map((change) => {
      const definition = findAppSettingDefinition(change.path);
      return {
        key: change.path,
        label: definition?.label ?? change.path,
        before: undefined,
        after: change.value,
        rawAfter: change.value,
        editable: true,
      };
    });
  }

  function fieldToRow(
    field: ProposalEditableField,
    change: SettingsChangePayload | undefined,
  ): DisplayRow {
    return {
      key: field.key,
      label: field.label,
      before: field.before,
      after: field.after ?? field.value,
      rawAfter: change?.value ?? field.value ?? field.after,
      editable: field.editable !== false,
    };
  }

  function formatRowValue(row: DisplayRow, value: unknown): string {
    const definition = findAppSettingDefinition(row.key);
    if (definition) return formatSettingValue(definition, value);
    if (value === null || value === undefined || value === '')
      return m.chat_shared_valueNone_label();
    if (typeof value === 'boolean')
      return value ? m.chat_shared_valueOn_label() : m.chat_shared_valueOff_label();
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value) ?? String(value);
  }

  function getRowDefinition(row: DisplayRow): AppSettingDefinition | undefined {
    return findAppSettingDefinition(row.key);
  }

  function isEditableEnum(row: DisplayRow): boolean {
    const definition = getRowDefinition(row);
    return Boolean(
      !isApplied &&
      !isApplying &&
      !isUndoing &&
      row.editable &&
      !disabled &&
      definition?.type === 'enum' &&
      definition.enumValues?.length,
    );
  }

  function selectedEnumValue(row: DisplayRow): string {
    const value = Object.prototype.hasOwnProperty.call(editedFields, row.key)
      ? editedFields[row.key]
      : row.rawAfter;
    return value === null || value === undefined ? '' : String(value);
  }

  function handleEnumEdit(row: DisplayRow, value: string) {
    const definition = getRowDefinition(row);
    editedFields = {
      ...editedFields,
      [row.key]: definition?.nullable === true && value === '' ? null : value,
    };
    onEditedFieldsChange?.(
      Object.fromEntries(
        Object.entries(editedFields).map(([key, edited]) => [
          key,
          edited === null || edited === undefined ? '' : String(edited),
        ]),
      ),
    );
  }

  function enumValueLabel(definition: AppSettingDefinition, value: string): string {
    if (value === '') return definition.nullLabel ?? m.chat_shared_valueNone_label();
    return definition.enumLabels?.[value] ?? value;
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
    return { proposal, editedFields, selectedBulkItemIds: [] };
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
  <div class="type-body px-3 py-2 text-muted-foreground">
    {m.chat_shared_discarded_label()}
    {proposal.preview.title}
  </div>
{:else}
  <section
    bind:this={rootElement}
    class="min-w-0 w-full"
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
          class="min-w-0 rounded-(--radius-medium) border border-border bg-background px-3 py-2.5"
          data-proposal-field={row.key}
        >
          <div class="type-body min-w-0 break-words">
            <span class="font-medium text-foreground">{row.label}</span><span
              class="text-muted-foreground"
              >:
            </span>
            <span class="text-muted-foreground" data-proposal-before-after-row={row.key}
              >{formatRowValue(row, row.before)} → {formatRowValue(row, row.after)}</span
            >
          </div>
          {#if isEditableEnum(row)}
            {@const definition = getRowDefinition(row)}
            {#if definition}
              <label class="sr-only" for={`settings-change-${row.key}`}>{row.label}</label>
              <div class="mt-2">
                <Select.Root
                  value={selectedEnumValue(row)}
                  onchange={(value) => handleEnumEdit(row, value)}
                >
                  <Select.Trigger id={`settings-change-${row.key}`} class="py-1.5">
                    <span class="truncate"
                      >{enumValueLabel(definition, selectedEnumValue(row))}</span
                    >
                  </Select.Trigger>
                  <Select.Content portal class="max-h-[300px]">
                    {#if definition.nullable}
                      <Select.Item value="">
                        <span class="truncate"
                          >{definition.nullLabel ?? m.chat_shared_valueNone_label()}</span
                        >
                      </Select.Item>
                    {/if}
                    {#each definition.enumValues ?? [] as option (option)}
                      <Select.Item value={option}>
                        <span class="truncate">{definition.enumLabels?.[option] ?? option}</span>
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            {/if}
          {/if}
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
