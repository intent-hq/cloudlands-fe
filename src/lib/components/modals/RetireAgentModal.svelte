<script lang="ts">
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    agentName: string;
    onRetire: () => Promise<void>;
  }

  let { open = $bindable(false), agentName, onRetire }: Props = $props();
  let error = $state('');

  async function retire() {
    error = '';
    try {
      await onRetire();
      open = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.agent_mutation_retireFailed_error();
    }
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
  onConfirm={retire}
>
  {#snippet details()}
    {#if error}<p role="alert" class="type-body text-danger">{error}</p>{/if}
  {/snippet}
</DestructiveConfirm>
