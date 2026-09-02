<script lang="ts">
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { Proposal } from '$shared/types/proposal';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectProposalLifecycleMap } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import ProposalCard from './ProposalCard.svelte';
  import DismissProposalConfirmDialog from './DismissProposalConfirmDialog.svelte';
  import { classifyPendingProposalRefs, pendingProposalKeyOf } from './pending-proposals';
  import {
    applyProposal,
    dismissProposal,
    getProposalLifecycleEntry,
    reconcileAppliedProposals,
    rememberProposalIdentity,
    undoProposal,
  } from './proposal-action-handlers';
  import { loadTrayDraft, saveTrayDraft, type ProposalCardDraft } from './proposal-tray-storage';
  import { getProposalId } from './proposal-id';

  interface Props {
    agentId: string;
    workspaceId: string;
    messageId: string;
    proposal: Proposal;
  }

  let { agentId, workspaceId, messageId, proposal }: Props = $props();
  const proposalId = $derived(pendingProposalKeyOf(proposal));
  const localProposalId = $derived(getProposalId(proposal));
  const initialDraft = $derived(loadTrayDraft(agentId, proposalId));
  const agentSession$ = $derived(selectAgentSession(agentId));
  const lifecycleMap$ = selectProposalLifecycleMap();
  let confirmingDismiss = $state(false);
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraft: ProposalCardDraft | null = null;

  const pendingRefs = $derived(
    classifyPendingProposalRefs($agentSession$?.metadata?.pendingProposals),
  );
  const matchingRef = $derived(
    pendingRefs.find((ref) => ref.proposalId === proposalId && ref.messageId === messageId),
  );
  const lifecycleEntry = $derived(
    getProposalLifecycleEntry($lifecycleMap$, agentId, proposalId, proposal),
  );
  const isApplied = $derived(lifecycleEntry?.status === 'applied');
  const isDismissed = $derived(lifecycleEntry?.status === 'dismissed');
  const isPending = $derived(Boolean(matchingRef) && !isApplied && !isDismissed);
  const canUndo = $derived(
    isApplied && (proposal.kind === 'settings-change' || proposal.kind === 'specialist-edit'),
  );
  const createdWorkspaceId = $derived(lifecycleEntry?.result?.workspaceId);

  function flushDraft(): void {
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    if (!pendingDraft) return;
    saveTrayDraft(agentId, proposalId, pendingDraft);
    pendingDraft = null;
  }

  function handleDraftChange(draft: ProposalCardDraft): void {
    pendingDraft = draft;
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(flushDraft, 300);
  }

  async function handleConfirmDismiss(): Promise<void> {
    confirmingDismiss = false;
    flushDraft();
    try {
      await dismissProposal(agentId, workspaceId, { proposalId, messageId, proposal });
    } catch {
      // The mutation middleware reports the error. The proposal stays pending.
    }
  }

  async function handleOpenWorkspace(event: MouseEvent): Promise<void> {
    if (!createdWorkspaceId) return;
    event.preventDefault();
    await goto(`/workspace/${createdWorkspaceId}`);
  }

  $effect(() => {
    rememberProposalIdentity(agentId, proposalId, proposal);
    void $lifecycleMap$;
    if (!matchingRef) return;
    reconcileAppliedProposals({
      agentId,
      workspaceId,
      refs: [matchingRef],
      lifecycle: $lifecycleMap$,
    });
  });

  onDestroy(flushDraft);
</script>

{#if isPending}
  <ProposalCard
    {proposal}
    suppressLocalDiscard
    {initialDraft}
    onDraftChange={handleDraftChange}
    onApply={(detail) => applyProposal(agentId, detail)}
    onDiscard={() => (confirmingDismiss = true)}
    onUndo={undoProposal}
  />
{:else if isApplied || isDismissed}
  <section
    class="my-2 flex min-w-0 w-full max-w-xl items-center gap-3 rounded-(--radius-medium) border border-border bg-card px-3 py-2.5"
    data-inline-proposal-outcome={isApplied ? 'applied' : 'dismissed'}
    data-proposal-id={proposalId}
  >
    <div class="min-w-0 flex-1">
      <p class="type-body truncate font-medium text-foreground">{proposal.preview.title}</p>
      <p class={isApplied ? 'type-caption text-success' : 'type-caption text-muted-foreground'}>
        {isApplied && proposal.kind === 'workspace-create'
          ? m.chat_proposalCard_workspaceCreated_label()
          : isApplied
            ? m.chat_shared_appliedStatus_label()
            : m.chat_shared_dismissedStatus_label()}
      </p>
    </div>
    {#if createdWorkspaceId}
      <a href={`/workspace/${createdWorkspaceId}`} onclick={handleOpenWorkspace}>
        <Button size="sm">{m.chat_proposalCard_openWorkspace_label()}</Button>
      </a>
    {:else if canUndo}
      <Button variant="outline" size="sm" onclick={() => undoProposal(localProposalId)}>
        {m.chat_shared_undo_label()}
      </Button>
    {/if}
  </section>
{/if}

<DismissProposalConfirmDialog
  open={confirmingDismiss}
  onConfirm={handleConfirmDismiss}
  onCancel={() => (confirmingDismiss = false)}
/>
