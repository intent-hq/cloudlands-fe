<script lang="ts">
  // Stand-in for InterruptedAgentsModal that publishes the handler props the
  // layout wires up, so a test can invoke the resume/abandon paths directly.
  const props: Record<string, unknown> = $props();
  (globalThis as Record<string, unknown>).__interruptedAgentsModalProps = {
    get onResumeSelected() {
      return props.onResumeSelected;
    },
    get onAbandonAll() {
      return props.onAbandonAll;
    },
  };
</script>

<div data-testid="interrupted-agents-modal-marker"></div>
