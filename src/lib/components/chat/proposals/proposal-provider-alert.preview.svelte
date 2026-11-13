<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupProviderDisablePreview } from '$lib/components/settings/provider-selector.preview';

  /** Auggie turned off (or still on, for a refusal the card did not foresee). */
  function setupProviders(auggieEnabled: boolean) {
    return setupProviderDisablePreview('signed-out', auggieEnabled);
  }

  type Scene = 'pinned-off' | 'refused';

  interface Props {
    state?: Scene;
  }

  const scene = (state: Scene) => ({ props: { state } });
  export const preview = definePreview<Props>({
    id: 'proposal-provider-alert',
    title: 'Workspace proposal turned-off provider',
    defaultState: 'pinned-off',
    states: {
      // The suggested agent is pinned to Auggie, which is turned off: Apply waits for a pick.
      'pinned-off': scene('pinned-off'),
      // workspace.create refused Auggie although the card thought it was on.
      refused: scene('refused'),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import type { WorkspaceCreateProposal } from '$shared/types/proposal';
  import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    clearProposalLifecycle,
    proposalFailed,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
  import ProposalCard from './ProposalCard.svelte';

  let { state: current = 'pinned-off' }: Props = $props();
  const s = untrack(() => current);

  // Restores the providers and the specialists it replaced.
  onDestroy(setupProviders(s === 'refused'));
  store.dispatch(
    setFileSpecialists([
      {
        id: 'implementor',
        name: 'Implementor',
        description: '',
        codingAgent: 'auggie',
        model: '',
        behaviorPrompt: '',
        filePath: '/fixture/specialists/implementor.md',
        source: 'user',
      },
    ]),
  );

  const lifecycleId = `fixture-provider-alert-${s}`;
  const proposal = {
    kind: 'workspace-create',
    applyToolCallId: lifecycleId,
    payload: {
      operation: 'workspace.create',
      params: {
        title: 'Retry flaky upload test',
        repositoryPath: '/fixture/intent',
        initialAgent: {
          prompt: 'Find why the upload test fails on CI and fix it.',
          specialist: 'implementor',
        },
      },
    },
    preview: {
      title: 'Retry flaky upload test',
      workspaceCreate: {
        mode: 'sibling',
        title: 'Retry flaky upload test',
        initialPrompt: 'Find why the upload test fails on CI and fix it.',
        repoPath: '/fixture/intent',
        branch: 'main',
        specialist: 'implementor',
      },
    },
  } as WorkspaceCreateProposal;

  if (s === 'refused')
    store.dispatch(
      proposalFailed({
        proposalId: lifecycleId,
        error:
          'workspace.create: provider "auggie" (Augment Auggie) is not enabled — enable it in Settings > Providers, or choose an enabled provider or model.',
        completedAt: 0,
        lastAction: 'apply',
      }),
    );
  onDestroy(() => store.dispatch(clearProposalLifecycle(lifecycleId)));
</script>

<div class="w-full max-w-xl p-4">
  <ProposalCard {proposal} {lifecycleId} />
</div>
