<script lang="ts">
  interface Props {
    agentId?: string;
    [key: string]: any;
  }

  let { agentId = '' }: Props = $props();
</script>

<span data-testid="auggie-avatar" data-agent-id={agentId}></span>
