<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'transfer-proposal',
    title: 'Inline project transfer',
    defaultState: 'confirm',
    states: Object.fromEntries(
      ['confirm', 'choose', 'transferring', 'finalize-error', 'complete', 'desktop-only'].map(
        (state) => [state, { props: { state } }],
      ),
    ),
  });
</script>

<script lang="ts">
  import TransferProposalView from './TransferProposalView.svelte';
  import type { WorkspaceTransferProposal } from '$shared/types/proposal';
  import type { ProposalLifecycleEntry } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';
  let { state = 'confirm' }: { state?: string } = $props();
  const proposal: WorkspaceTransferProposal = {
    kind: 'workspace-transfer',
    applyToolCallId: 'preview-transfer',
    payload: {
      operation: 'workspace.transfer',
      workspaceId: 'design-system',
      sourceWorkspacePath: '/home/sam/projects/design-system',
      destination: 'MacBook',
    },
    preview: {
      title: 'Transfer Design system',
      fields: [{ key: 'workspaceTitle', label: 'Project', value: 'Design system' }],
      warnings: ['Two running agents will stop. Uncommitted changes will be included.'],
    },
  };
  const transfer = {
    workspaceId: 'design-system',
    sourceWorkspacePath: proposal.payload.sourceWorkspacePath,
    sourceConnectionId: 'source',
    destinationConnectionId: 'macbook',
    phase: 'imported' as const,
  };
  const entry = $derived<ProposalLifecycleEntry>({
    status:
      state === 'complete'
        ? 'applied'
        : state === 'transferring'
          ? 'applying'
          : state === 'finalize-error'
            ? 'failed'
            : 'idle',
    ...(state === 'finalize-error'
      ? {
          result: { transfer },
          error: 'The source device disconnected. Reconnect it and finish the transfer.',
        }
      : {}),
  });
</script>

<TransferProposalView
  {proposal}
  source="Development server (dev.example:443)"
  destinations={[
    { value: 'macbook', label: 'MacBook (sam.local:5181)' },
    { value: 'desktop', label: 'Office desktop (office.local:5181)' },
  ]}
  destinationId={state === 'choose' ? '' : 'macbook'}
  {entry}
  desktop={state !== 'desktop-only'}
/>
