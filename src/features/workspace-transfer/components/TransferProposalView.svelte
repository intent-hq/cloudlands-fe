<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceTransferProposal } from '$shared/types/proposal';
  import type { ProposalLifecycleEntry } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';

  let {
    proposal,
    source,
    destinations,
    destinationId = $bindable(''),
    entry,
    disabled = false,
    desktop = true,
    onapprove,
    oncancel,
  }: {
    proposal: WorkspaceTransferProposal;
    source: string;
    destinations: { value: string; label: string }[];
    destinationId?: string;
    entry?: ProposalLifecycleEntry | null;
    disabled?: boolean;
    desktop?: boolean;
    onapprove?: () => void;
    oncancel?: () => void;
  } = $props();
  const busy = $derived(entry?.status === 'applying');
  const done = $derived(entry?.status === 'applied' || entry?.status === 'dismissed');
  const locked = $derived(disabled || busy || done);
  const started = $derived(Boolean(entry?.result?.transfer));
  const imported = $derived(entry?.result?.transfer?.phase === 'imported');
  const project = $derived(
    proposal.preview.fields?.find((field) => field.key === 'workspaceTitle')?.value,
  );
</script>

<section
  class="min-w-0 w-full overflow-hidden rounded-(--radius-large) border border-border bg-card shadow-(--elevation-raised)"
  data-proposal-kind="workspace-transfer"
  data-lifecycle-status={entry?.status ?? 'idle'}
  data-testid="transfer-proposal"
>
  <div class="space-y-3 p-5">
    <h3 class="type-body font-medium text-foreground">{proposal.preview.title}</h3>
    {#if proposal.preview.summary}<p class="type-body text-muted-foreground">
        {proposal.preview.summary}
      </p>{/if}
    <dl class="type-body space-y-2">
      <div>
        <dt class="type-caption text-muted-foreground">{m.chat_transfer_project_label()}</dt>
        <dd class="break-words text-foreground">
          {typeof project === 'string' ? project : proposal.preview.title}
        </dd>
      </div>
      <div>
        <dt class="type-caption text-muted-foreground">{m.chat_transfer_source_label()}</dt>
        <dd class="break-words text-foreground">
          {source}<span class="type-caption block text-muted-foreground"
            >{proposal.payload.sourceWorkspacePath}</span
          >
        </dd>
      </div>
    </dl>
    <div class="space-y-1">
      <span class="type-caption text-muted-foreground">{m.chat_transfer_target_label()}</span>
      <Select.Root bind:value={destinationId} items={destinations} disabled={locked || started}>
        <Select.Trigger aria-label={m.chat_transfer_target_label()} class="w-full"
          ><Select.Value placeholder={m.chat_transfer_choose_label()} /></Select.Trigger
        >
        <Select.Content
          >{#each destinations as item (item.value)}<Select.Item value={item.value}
              >{item.label}</Select.Item
            >{/each}</Select.Content
        >
      </Select.Root>
      {#if !destinationId}<p class="type-caption text-muted-foreground">
          {proposal.payload.destination
            ? m.chat_transfer_hint_description({ destination: proposal.payload.destination })
            : m.chat_transfer_choose_description()}
        </p>{/if}
    </div>
    <p class="type-body text-muted-foreground">{m.chat_transfer_effects_description()}</p>
    {#each proposal.preview.warnings ?? [] as warning}<p class="type-caption text-muted-foreground">
        {warning}
      </p>{/each}
    {#if !desktop}<p class="type-body text-danger" role="alert">
        {m.chat_transfer_desktop_error()}
      </p>{/if}
    {#if entry?.error}<p class="type-body break-words text-danger" role="alert">
        {entry.error}
      </p>{/if}
    <div aria-live="polite" class="type-body text-muted-foreground">
      {#if entry?.status === 'applied'}{m.chat_transfer_complete_label()}
      {:else if entry?.status === 'dismissed'}{m.chat_shared_discarded_label()}
      {:else if imported}{m.chat_transfer_imported_description()}
      {:else if busy}
        {entry?.transferProgress === 'committing'
          ? m.workspace_transfer_phase_committing()
          : entry?.transferProgress === 'relaying'
            ? m.workspace_transfer_phase_relaying()
            : m.chat_transfer_running_label()}
      {/if}
    </div>
  </div>
  {#if !done}
    <div class="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
      <Button variant="ghost" disabled={locked || started} onclick={oncancel}
        >{m.workspace_modals_cancel_label()}</Button
      >
      <Button disabled={locked || !desktop || !destinationId} loading={busy} onclick={onapprove}>
        {imported
          ? m.chat_transfer_finish_label()
          : entry?.status === 'failed'
            ? m.chat_shared_retry_label()
            : m.chat_transfer_approve_label()}
      </Button>
    </div>
  {/if}
</section>
