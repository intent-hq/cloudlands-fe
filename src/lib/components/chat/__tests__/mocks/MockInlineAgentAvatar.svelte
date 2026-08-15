<script lang="ts">
  interface Props {
    agentId: string;
    agentName?: string;
    isCompleted?: boolean;
    onclick?: (event: MouseEvent) => void;
  }

  let { agentId, agentName, isCompleted = false, onclick }: Props = $props();
</script>

<button
  type="button"
  data-testid="event-agent-avatar"
  data-agent-id={agentId}
  data-completed={isCompleted}
  aria-label={agentName ?? agentId}
  {onclick}
>
  {agentName ?? agentId}
</button>
