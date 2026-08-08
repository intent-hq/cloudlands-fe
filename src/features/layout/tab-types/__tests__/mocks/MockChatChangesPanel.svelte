<script lang="ts">
  let { changes = [] }: { changes?: Array<{ filePath: string; toolCallId: string }> } = $props();
</script>

<div data-testid="chat-changes-panel">
  {#each changes as change (change.toolCallId)}
    <div data-testid="chat-change" data-file-path={change.filePath}></div>
  {/each}
</div>
