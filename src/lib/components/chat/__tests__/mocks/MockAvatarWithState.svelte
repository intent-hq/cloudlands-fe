<script lang="ts">
  interface Props {
    agentId?: string;
    state?: string;
    [key: string]: unknown;
  }

  let { agentId = '', state = 'idle' }: Props = $props();
</script>

<div data-testid="mock-avatar-with-state" data-agent-id={agentId} data-state={state}></div>
