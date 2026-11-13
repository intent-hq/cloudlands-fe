<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupProviderDisablePreview } from '$lib/components/settings/provider-selector.preview';
  import { store } from '$store/renderer/store';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';

  /** Auggie turned off (or still on, for a refusal the card did not foresee). */
  function setupProviders(auggieEnabled: boolean) {
    const restoreProviders = setupProviderDisablePreview('signed-out', auggieEnabled);
    // Codex is the default provider; its models name the agent's default.
    store.dispatch(
      providerModelsLoaded(
        'codex',
        { models: [{ value: 'gpt-5.5', label: 'GPT-5.5' }] },
        store.state.providerModels.clearEpoch,
      ),
    );
    return restoreProviders;
  }

  type Scene = 'default' | 'pinned-off' | 'refused';

  interface Props {
    state?: Scene;
  }

  const scene = (state: Scene) => ({ props: { state } });
  export const preview = definePreview<Props>({
    id: 'proposal-provider-alert',
    title: 'Workspace proposal model row and turned-off provider',
    defaultState: 'default',
    states: {
      // The Model row names New Workspace's default provider and model for the agent.
      default: scene('default'),
      // The suggested agent is pinned to Auggie, which is turned off: the Model row
      // still lands on an enabled provider's model and Apply is ready.
      'pinned-off': scene('pinned-off'),
      // workspace.create refused the Model row's provider (Codex) although the card
      // thought it was on.
      refused: scene('refused'),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { WorkspaceCreateProposal } from '$shared/types/proposal';
  import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    clearProposalLifecycle,
    proposalFailed,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
  import ProposalCard from './ProposalCard.svelte';

  let { state: current = 'default' }: Props = $props();
  const s = untrack(() => current);

  // Restores the providers and the specialists it replaced.
  onDestroy(setupProviders(s !== 'pinned-off'));
  store.dispatch(
    setFileSpecialists([
      {
        id: 'implementor',
        name: 'Implementor',
        description: '',
        codingAgent: 'auggie',
        model: '',
        // The daemon's default-model preview for the active provider (Codex).
        resolvedModel: 'gpt-5.5',
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
          'workspace.create: provider "codex" (Codex) is not enabled — enable it in Settings > Providers, or choose an enabled provider or model.',
        completedAt: 0,
        lastAction: 'apply',
      }),
    );
  onDestroy(() => store.dispatch(clearProposalLifecycle(lifecycleId)));
</script>

<div class="w-full max-w-xl p-4">
  <ProposalCard {proposal} {lifecycleId} />
</div>
