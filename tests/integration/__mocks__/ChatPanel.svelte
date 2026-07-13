<script lang="ts">
  export let agentId: string;
  export let workspaceId: string;
</script>

<div class="chat-panel" data-agent-id={agentId} data-workspace-id={workspaceId}>
  Mock Chat Panel for {agentId}
</div>

<style>
  .chat-panel {
    padding: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
</style>
