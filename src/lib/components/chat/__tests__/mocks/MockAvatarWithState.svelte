<script lang="ts">
  interface Props {
    agentId?: string;
    state?: string;
    variant?: string;
    [key: string]: unknown;
  }

  let { agentId = '', state = 'idle', variant = 'standard' }: Props = $props();
</script>

<div
  data-testid="mock-avatar-with-state"
  data-agent-id={agentId}
  data-state={state}
  data-variant={variant}
></div>
