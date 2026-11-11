<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { Proposal } from '$shared/types/proposal';
  import {
    selectAgentMessageById,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectProposalLifecycleMap } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import ProposalCard from './ProposalCard.svelte';
  import DismissProposalConfirmDialog from './DismissProposalConfirmDialog.svelte';
  import {
    classifyPendingProposalRefs,
    getProposalLifecycleEntry,
    isPendingProposalCard,
    pendingProposalKeyOf,
    proposalOutcomeOf,
    proposalsOf,
  } from './pending-proposals';
  import {
    applyProposal,
    dismissProposal,
    reconcileAppliedProposals,
    rememberProposalIdentity,
    undoProposal,
  } from './proposal-action-handlers';
  import {
    clearProposalDraft,
    loadProposalDraft,
    saveProposalDraft,
    type ProposalCardDraft,
  } from './proposal-draft-storage';
  import { getCardProposalId } from './proposal-id';
  import { openCreatedWorkspace } from './open-created-workspace';
  import { OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS } from '../operational-disclosure-row';

  interface Props {
    agentId: string;
    workspaceId: string;
    messageId: string;
    proposal: Proposal;
  }

  let { agentId, workspaceId, messageId, proposal }: Props = $props();
  const proposalId = $derived(pendingProposalKeyOf(proposal));
  const localProposalId = $derived(getCardProposalId(proposal, agentId, messageId));
  const agentSession$ = $derived(selectAgentSession(agentId));
  const carryingMessage$ = $derived(selectAgentMessageById(agentId, messageId));
  const lifecycleMap$ = selectProposalLifecycleMap();
  let initialDraft = $state<ProposalCardDraft | null>(null);
  let initialDraftLoaded = $state(false);
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
    getProposalLifecycleEntry($lifecycleMap$, agentId, proposalId, localProposalId),
  );
  const outcomeSources = $derived({
    lifecycle: $lifecycleMap$,
    resolutions: $agentSession$?.metadata?.proposalResolutions,
  });
  const outcome = $derived(proposalOutcomeOf(agentId, outcomeSources, proposalId, localProposalId));
  const isApplied = $derived(outcome === 'applied');
  const isDismissed = $derived(outcome === 'dismissed');
  // Same rule as the composer pill (`effectivelyPendingProposalRefs` in ChatPanel).
  const isPending = $derived(
    isPendingProposalCard({
      agentId,
      refs: pendingRefs,
      sources: outcomeSources,
      proposal,
      messageId,
      localId: localProposalId,
      messageProposals: $carryingMessage$ ? proposalsOf($carryingMessage$) : undefined,
    }),
  );
  const canUndo = $derived(
    lifecycleEntry?.status === 'applied' &&
      (proposal.kind === 'settings-change' || proposal.kind === 'specialist-edit'),
  );
  // The local apply result, else the daemon-recorded link — covers cards
  // applied by the agent (`ws.workspace.applyProposal`), another client, or
  // before a restart, sibling follow-up cards included.
  const daemonCreatedWorkspaceId = $derived(
    proposal.kind === 'workspace-create'
      ? $agentSession$?.metadata?.proposalCreatedWorkspaces?.[proposalId]
      : undefined,
  );
  const createdWorkspaceId = $derived(
    isApplied ? (lifecycleEntry?.result?.workspaceId ?? daemonCreatedWorkspaceId) : undefined,
  );

  const launchError = $derived(isApplied ? lifecycleEntry?.result?.launchError : undefined);

  function flushDraft(): void {
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    if (!pendingDraft) return;
    saveProposalDraft(agentId, proposalId, pendingDraft);
    pendingDraft = null;
  }

  function discardDraft(): void {
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    pendingDraft = null;
    clearProposalDraft(agentId, proposalId);
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
    await openCreatedWorkspace(createdWorkspaceId);
  }

  $effect(() => {
    rememberProposalIdentity(agentId, { proposalId, messageId }, localProposalId);
    void $lifecycleMap$;
    if (!matchingRef) return;
    reconcileAppliedProposals({
      agentId,
      workspaceId,
      refs: [matchingRef],
      lifecycle: $lifecycleMap$,
    });
  });

  // A resolution converging from the daemon (`proposalResolutions` via
  // `agent:updated`, e.g. another client or the agent's own applyProposal)
  // never passes through the local apply/dismiss handlers that clear the
  // stored draft, so retire the edited fields here for either source.
  $effect(() => {
    if (!isApplied && !isDismissed) return;
    discardDraft();
  });

  onMount(() => {
    initialDraft = loadProposalDraft(agentId, proposalId);
    initialDraftLoaded = true;
  });
  onDestroy(flushDraft);
</script>

{#if isPending || isApplied || isDismissed}
  <!-- The composer pill's click finds the card a pending ref points at by
       this daemon-parity key (id or title), so id-less cards resolve too. -->
  <div
    class="my-4 {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
    data-inline-proposal
    data-pending-proposal-key={isPending ? proposalId : undefined}
  >
    {#if isPending}
      {#if initialDraftLoaded}
        <ProposalCard
          {proposal}
          lifecycleId={localProposalId}
          resolvedCreatedWorkspaceId={daemonCreatedWorkspaceId}
          proposer={$agentSession$}
          suppressLocalDiscard
          {initialDraft}
          onDraftChange={handleDraftChange}
          onApply={(detail) => applyProposal(agentId, detail, messageId)}
          onDiscard={() =>
            proposal.kind === 'workspace-transfer'
              ? handleConfirmDismiss()
              : (confirmingDismiss = true)}
          onUndo={undoProposal}
        />
      {/if}
    {:else}
      <section
        class="flex min-w-0 w-full items-center gap-3 rounded-(--radius-medium) border border-border bg-card px-3 py-2.5"
        data-inline-proposal-outcome={isApplied ? 'applied' : 'dismissed'}
        data-proposal-id={proposalId}
      >
        <div class="min-w-0 flex-1">
          <p class="type-body truncate font-medium text-foreground">{proposal.preview.title}</p>
          {#if launchError}
            <p class="type-caption text-warning-ink" data-testid="proposal-launch-error">
              {launchError}
            </p>
          {:else}
            <p
              class={isApplied ? 'type-caption text-success' : 'type-caption text-muted-foreground'}
            >
              {isApplied && proposal.kind === 'workspace-create'
                ? m.chat_proposalCard_workspaceCreated_label()
                : isApplied
                  ? m.chat_shared_appliedStatus_label()
                  : m.chat_shared_dismissedStatus_label()}
            </p>
          {/if}
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
  </div>
{/if}

<DismissProposalConfirmDialog
  open={confirmingDismiss}
  onConfirm={handleConfirmDismiss}
  onCancel={() => (confirmingDismiss = false)}
/>
