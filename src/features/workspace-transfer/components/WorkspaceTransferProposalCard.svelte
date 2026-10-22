<script lang="ts">
  import { untrack } from 'svelte';
  import type { ProposalActionDetail, WorkspaceTransferProposal } from '$shared/types/proposal';
  import {
    selectConnections,
    selectCurrentConnection,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { selectProposalLifecycleEntry } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors';
  import { getProposalId } from '$lib/components/chat/proposals/proposal-id';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import {
    resolveTransferDestination,
    transferConnectionLabel,
  } from '../utils/proposal-destination';
  import TransferProposalView from './TransferProposalView.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let {
    proposal,
    disabled = false,
    onApply,
    onDiscard,
    suppressLocalDiscard = false,
  }: {
    proposal: WorkspaceTransferProposal;
    disabled?: boolean;
    onApply?: (detail: ProposalActionDetail) => void;
    onDiscard?: (detail: ProposalActionDetail) => void;
    suppressLocalDiscard?: boolean;
  } = $props();
  let root: HTMLDivElement;
  let selectedId = $state<string | null>(null);
  let dismissed = $state(false);
  const connections = selectConnections();
  const source = selectCurrentConnection();
  const sourceId = selectCurrentConnectionId();
  const entry = selectProposalLifecycleEntry(untrack(() => getProposalId(proposal)));
  const displaySourceId = $derived($entry?.result?.transfer?.sourceConnectionId ?? $sourceId);
  const displaySource = $derived(
    $connections.find((connection) => connection.id === displaySourceId) ??
      ($source?.id === displaySourceId ? $source : null),
  );
  const targets = $derived(
    $connections
      .filter((c) => c.id !== displaySourceId)
      .map((c) => ({ value: c.id, label: transferConnectionLabel(c) })),
  );
  let destinationId = $derived(
    $entry?.result?.transfer?.destinationConnectionId ??
      selectedId ??
      resolveTransferDestination($connections, $sourceId, proposal.payload.destination),
  );
  const sourceLabel = $derived(
    displaySource ? transferConnectionLabel(displaySource) : m.chat_transfer_sourceUnknown_label(),
  );
  function detail(): ProposalActionDetail {
    return {
      proposal,
      editedFields: { destinationConnectionId: destinationId, sourceConnectionId: $sourceId },
      selectedBulkItemIds: [],
    };
  }
  function approve() {
    if (
      disabled ||
      $entry?.status === 'applying' ||
      $entry?.status === 'applied' ||
      $entry?.status === 'dismissed'
    )
      return;
    const value = detail();
    onApply?.(value);
    root.dispatchEvent(
      new CustomEvent('proposalapply', { bubbles: true, composed: true, detail: value }),
    );
  }
  function cancel() {
    if (disabled || $entry?.status === 'applying' || $entry?.result?.transfer) return;
    const value = detail();
    if (!suppressLocalDiscard) dismissed = true;
    onDiscard?.(value);
    root.dispatchEvent(
      new CustomEvent('proposaldiscard', { bubbles: true, composed: true, detail: value }),
    );
  }
</script>

<div bind:this={root} class="min-w-0 w-full">
  <TransferProposalView
    {proposal}
    source={sourceLabel}
    destinations={targets}
    bind:destinationId={() => destinationId, (value) => (selectedId = value)}
    entry={dismissed ? { status: 'dismissed' } : $entry}
    {disabled}
    desktop={isElectronPlatform()}
    onapprove={approve}
    oncancel={cancel}
  />
</div>
