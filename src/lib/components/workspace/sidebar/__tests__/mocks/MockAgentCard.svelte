<script lang="ts">
  interface Props {
    agentId: string;
    agentName?: string;
    isBackground?: boolean;
  }

  let { agentId, agentName = 'Agent', isBackground = false }: Props = $props();
</script>

<div data-testid="mock-agent-card" data-agent-id={agentId} data-background={isBackground}>
  {agentName}
</div>
