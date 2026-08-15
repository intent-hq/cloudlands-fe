<script lang="ts">
  interface Props {
    agentId?: string;
  }

  let { agentId = '' }: Props = $props();
</script>

<span data-testid="agent-avatar" data-agent-id={agentId}></span>
