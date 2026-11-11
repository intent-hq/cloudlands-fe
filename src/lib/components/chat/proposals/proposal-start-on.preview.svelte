<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scene =
    | 'backend'
    | 'remote'
    | 'e2b'
    | 'unavailable'
    | 'removed'
    | 'legacy-remote'
    | 'launch-error';

  interface Props {
    state?: Scene;
  }

  const scene = (state: Scene) => ({ props: { state } });
  export const preview = definePreview<Props>({
    id: 'proposal-start-on',
    title: 'Workspace proposal Start on',
    defaultState: 'remote',
    states: {
      // The proposer runs on the backend.
      backend: scene('backend'),
      // The proposer runs on a remote machine.
      remote: scene('remote'),
      // The proposer runs in an E2B sandbox: a new sandbox from the same entry.
      e2b: scene('e2b'),
      // The proposer's machine is unreachable: warning, Apply blocked.
      unavailable: scene('unavailable'),
      // The proposer's machine was removed from the list.
      removed: scene('removed'),
      // An older backend stamps no placement: the proposer's own location.
      'legacy-remote': scene('legacy-remote'),
      // workspace.create refused the launch.
      'launch-error': scene('launch-error'),
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import type { AgentSession } from '$shared/types';
  import type { ProposalActionDetail, WorkspaceCreateProposal } from '$shared/types/proposal';
  import {
    setupStartOnPreview,
    startOnPreviewMachine,
  } from '$lib/components/workspace/initializer/start-on.preview-fixtures';
  import { cloudMachinesLoaded } from '$features/cloud-machines/cloud-machines-slice';
  import { setLabsCloudMachinesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    clearProposalLifecycle,
    proposalFailed,
  } from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
  import { E2B_PROVIDER } from '../../../../test/cloud-machines-preview';
  import ProposalCard from './ProposalCard.svelte';

  let { state: current = 'remote' }: Props = $props();
  const s = untrack(() => current);

  const placements: Partial<Record<Scene, unknown>> = {
    backend: { target: 'local', checkout: 'worktree' },
    remote: { target: 'remote', checkout: 'isolated', nodeId: 'd-mac' },
    e2b: { target: 'e2b', checkout: 'isolated', cloudMachineId: 'e2b-team' },
    unavailable: { target: 'remote', checkout: 'isolated', nodeId: 'd-lab' },
    removed: { target: 'remote', checkout: 'isolated', nodeId: 'd-old' },
    'launch-error': { target: 'remote', checkout: 'isolated', nodeId: 'd-mac' },
  };
  const proposer = {
    id: 'fixture-proposer',
    ...(s === 'legacy-remote'
      ? {
          nodeId: 'd-mac',
          nodeName: 'Mac mini',
          placement: { target: 'remote', checkout: 'isolated', nodeId: 'd-mac' },
        }
      : s === 'removed'
        ? {
            nodeId: 'd-old',
            nodeName: 'Old box',
            placement: { target: 'remote', checkout: 'isolated', nodeId: 'd-old' },
          }
        : {}),
  } as unknown as AgentSession;
  const lifecycleId = `fixture-start-on-${s}`;
  const proposal = {
    kind: 'workspace-create',
    applyToolCallId: lifecycleId,
    payload: {
      operation: 'workspace.create',
      params: {
        title: 'Retry flaky upload test',
        repositoryPath: '/fixture/intent',
        initialAgent: { prompt: 'Find why the upload test fails on CI and fix it.' },
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
        specialist: null,
      },
    },
    ...(s in placements ? { placement: placements[s] } : {}),
  } as WorkspaceCreateProposal;

  onDestroy(
    setupStartOnPreview([
      startOnPreviewMachine('d-mac', 'Mac mini', 'connected'),
      startOnPreviewMachine('d-lab', 'Lab PC', 'unreachable'),
    ]),
  );
  const previousCloudLabs = store.state.userPreferences?.labsCloudMachinesEnabled === true;
  store.dispatch(setLabsCloudMachinesEnabled(true));
  store.dispatch(
    cloudMachinesLoaded({
      supported: true,
      entries: true,
      providers: [{ ...E2B_PROVIDER, id: 'e2b-team', name: 'Team' }],
      machines: [],
      readAt: 0,
    }),
  );
  if (s === 'launch-error')
    store.dispatch(
      proposalFailed({
        proposalId: lifecycleId,
        error:
          'Work (API key) is not marked remote-compatible, so it cannot run on Mac mini. {"code":"profile-not-remote-compatible","reason":"not-marked"}',
        errorCode: 'profile-not-remote-compatible',
        completedAt: 0,
        lastAction: 'apply',
      }),
    );
  onDestroy(() => {
    store.dispatch(clearProposalLifecycle(lifecycleId));
    store.dispatch(setLabsCloudMachinesEnabled(previousCloudLabs));
  });

  let applied = $state<string | null>(null);
  function onApply(detail: ProposalActionDetail) {
    applied = JSON.stringify(detail.editedFields.placement ?? null);
  }
</script>

<div class="w-full max-w-xl p-4">
  <ProposalCard {proposal} {proposer} {lifecycleId} {onApply} />
  {#if applied !== null}
    <pre class="sr-only" data-testid="applied-placement">{applied}</pre>
  {/if}
</div>
