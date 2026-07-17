<script lang="ts">
  interface Props {
    agentId: string;
    size?: number;
    state?: string;
    class?: string;
    specialist?: string | null;
  }

  let { agentId, size = 20, state = 'idle', class: className = '', specialist = null }: Props = $props();
</script>

<div data-testid="mock-avatar" data-agent-id={agentId} data-state={state} data-specialist={specialist} class={className} style="width: {size}px; height: {size}px;"></div>
