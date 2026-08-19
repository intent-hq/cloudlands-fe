<script lang="ts">
  interface Props {
    agentId?: string;
    visible?: boolean;
    count?: number;
  }

  let { agentId = '', visible = $bindable(false), count = $bindable(0) }: Props = $props();
  $effect(() => {
    visible = agentId.includes('agents');
    count = visible ? 1 : 0;
  });
</script>

{#if visible}
  <div data-testid="mock-agent-event-section">
    <button type="button" data-testid="mock-agent-cohort-header">Waiting for {count} agent</button>
  </div>
{/if}
