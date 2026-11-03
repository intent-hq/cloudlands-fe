<script lang="ts">
  let {
    workspaceId,
    onSelectScript,
    onSelectMachineRun,
  }: {
    workspaceId: string;
    onSelectScript?: (scriptId: string | null) => void;
    onSelectMachineRun?: (scriptId: string, remoteAgentId: string) => void;
  } = $props();
</script>

<input aria-label="Sidebar state" value="retained" />
<button type="button" onclick={() => onSelectScript?.(`direct-${workspaceId}`)}>
  Direct select {workspaceId}
</button>
<button type="button" onclick={() => onSelectMachineRun?.('remote-dev', 'agent-remote')}>
  Select machine run
</button>
<button type="button" onclick={() => onSelectMachineRun?.('remote-dev', 'agent-other')}>
  Select other machine run
</button>
