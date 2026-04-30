<script lang="ts">
  interface Props {
    agentModel?: string;
  }

  let { agentModel }: Props = $props();
</script>

<div data-testid="chat-panel-agent-model" data-agent-model={agentModel ?? ''}>
  {agentModel ?? ''}
</div>
