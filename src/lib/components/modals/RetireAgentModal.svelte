<script lang="ts">
  import { writable } from 'svelte/store';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    agentMutationUiConsumed,
    agentMutationUiReleased,
    agentMutationUiRequested,
  } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-slice';
  import { selectAgentMutationUi } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-selectors';

  interface Props {
    open?: boolean;
    agentName: string;
    workspaceId: string;
    agentId: string;
  }

  let { open = $bindable(false), agentName, workspaceId, agentId }: Props = $props();
  const consumerId = crypto.randomUUID();
  const workspaceIdStore = writable('');
  const outcome$ = selectAgentMutationUi(workspaceIdStore, consumerId);
  const outcome = $derived(
    $outcome$?.workspaceId === workspaceId && $outcome$.agentId === agentId ? $outcome$ : undefined,
  );
  const busy = $derived(outcome?.status === 'pending');
  const error = $derived(outcome?.status === 'failed' ? outcome.error : '');
  $effect(() => {
    const wsId = workspaceId;
    void agentId;
    workspaceIdStore.set(wsId);
    return () => appStore.dispatch(agentMutationUiReleased(wsId, consumerId));
  });
  $effect(() => {
    if (outcome?.status !== 'succeeded') return;
    open = false;
    appStore.dispatch(agentMutationUiConsumed(workspaceId, consumerId, outcome.requestId));
  });

  function retire() {
    const current = selectAgentMutationUi.select(appStore.state, workspaceId, consumerId);
    if (current?.agentId === agentId && current.status === 'pending') return;
    appStore.dispatch(
      agentMutationUiRequested(workspaceId, consumerId, crypto.randomUUID(), agentId, {
        kind: 'retire',
      }),
    );
  }
</script>

<DestructiveConfirm
  bind:open
  title={m.modals_retireAgent_title()}
  description={m.modals_retireAgent_description({ name: agentName })}
  confirmLabel={m.modals_retireAgent_confirm_label()}
  cancelLabel={m.modals_bulkActionConfirm_cancel_label()}
  focusSubmit={false}
  focusCancel
  {busy}
  onConfirm={retire}
>
  {#snippet details()}
    {#if error}<p role="alert" class="type-body text-danger">{error}</p>{/if}
  {/snippet}
</DestructiveConfirm>
