<script lang="ts">
  import { onMount } from 'svelte';
  import type { WorkspaceDraft } from '$shared/types/workspace-draft';
  import {
    createInitialControllerState,
    reduce,
    type Capability,
    type ControllerState,
    type DraftInput,
  } from '../../controller';
  import UntitledWorkspaceShell from '../UntitledWorkspaceShell.svelte';

  interface Props {
    pendingCapabilities?: boolean;
  }

  const draft: WorkspaceDraft = {
    id: 'draft-shell-test',
    ownerClientId: 'component-test',
    revision: 1,
    phase: 'editing',
    title: 'Untitled',
    intentText: 'Draft message',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: 'operation-shell-test',
    delivery: { state: 'none' },
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
  };

  let { pendingCapabilities = false }: Props = $props();
  let controllerState = $state(buildState());
  let startCount = $state(0);

  function buildState(): ControllerState {
    let next: ControllerState = createInitialControllerState(0);
    next = reduce(next, { type: 'backend.connected', generation: 0, draftId: draft.id });
    next = reduce(next, { type: 'restore.succeeded', generation: 0, draft });
    for (const capability of ['provider', 'git', 'node', 'github'] as Capability[]) {
      next = reduce(next, {
        type: 'capability.result',
        capability,
        status: capability === 'provider' || !pendingCapabilities ? 'ready' : 'pending',
        generation: 0,
      });
    }
    return next;
  }

  function edit(patch: Partial<DraftInput>): void {
    controllerState = reduce(controllerState, { type: 'user.edited', patch });
  }

  function settleProbes(): void {
    for (const capability of ['git', 'node', 'github'] as Capability[]) {
      controllerState = reduce(controllerState, {
        type: 'capability.result',
        capability,
        status: 'ready',
        generation: 0,
      });
    }
  }

  onMount(() => {
    window.addEventListener('new-workspace-probes-settled', settleProbes);
    return () => window.removeEventListener('new-workspace-probes-settled', settleProbes);
  });
</script>

<UntitledWorkspaceShell
  state={controllerState}
  presentation={{ requiredCapabilities: ['provider'] }}
  onEdit={edit}
  onStart={() => (startCount += 1)}
/>
<output class="sr-only" data-testid="start-count">{startCount}</output>
