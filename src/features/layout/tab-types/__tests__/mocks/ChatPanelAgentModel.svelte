<script lang="ts">
  interface Props {
    agentModel?: string;
    onTaskProgressChange?: (tasks: Array<{ id: string; title: string; status: string }>) => void;
  }

  let { agentModel, onTaskProgressChange }: Props = $props();

  $effect(() => {
    onTaskProgressChange?.([
      { id: 'workspace:task-1', title: 'Header task', status: 'running' },
      { id: 'workspace:task-2', title: 'Completed header task', status: 'completed' },
    ]);
  });
</script>

<div data-testid="chat-panel-agent-model" data-agent-model={agentModel ?? ''}>
  {agentModel ?? ''}
</div>
