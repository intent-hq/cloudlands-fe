<script lang="ts">
  interface Props {
    agentId?: string;
    visible?: boolean;
    count?: number;
    participantAvatarItems?: Array<{ key: string; agentId: string }>;
  }

  let { agentId = '', visible = false, count = 0, participantAvatarItems = [] }: Props = $props();
  const effectiveVisible = $derived(visible || agentId.includes('agents'));
  const effectiveCount = $derived(count || (effectiveVisible ? 1 : 0));
</script>

{#if effectiveVisible}
  <div data-testid="mock-agent-event-section">
    <button type="button" data-testid="mock-agent-cohort-header">
      Waiting for {effectiveCount}
      {effectiveCount === 1 ? 'agent' : 'agents'}
      <span data-agent-avatar-stack>
        {#each participantAvatarItems as item (item.key)}
          <span data-agent-avatar-stack-item data-agent-id={item.agentId}></span>
        {/each}
      </span>
    </button>
  </div>
{/if}
