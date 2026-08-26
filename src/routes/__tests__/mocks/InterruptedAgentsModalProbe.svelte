<script lang="ts">
  import type { InterruptedAgent } from '$lib/client/app-client';

  interface Props {
    open?: boolean;
    agents?: InterruptedAgent[];
    onResumeSelected?: (resumeIds: string[], abandonIds: string[]) => void;
    onAbandonAll?: (abandonIds: string[]) => void;
    onClose?: () => void;
  }

  // Stand-in for InterruptedAgentsModal that publishes the handler props the
  // layout wires up and mirrors its close/resolve behavior.
  let {
    open = $bindable(false),
    agents = [],
    onResumeSelected,
    onAbandonAll,
    onClose,
  }: Props = $props();

  function close() {
    open = false;
    onClose?.();
  }

  function resume(resumeIds: string[], abandonIds: string[]) {
    onResumeSelected?.(resumeIds, abandonIds);
    open = false;
  }

  function abandon(abandonIds: string[]) {
    onAbandonAll?.(abandonIds);
    open = false;
  }

  (globalThis as Record<string, unknown>).__interruptedAgentsModalProps = {
    get onResumeSelected() {
      return onResumeSelected;
    },
    get onAbandonAll() {
      return onAbandonAll;
    },
    close,
    resume,
    abandon,
  };
</script>

{#if open && agents.length > 0}
  <div data-testid="interrupted-agents-modal-marker"></div>
{/if}
