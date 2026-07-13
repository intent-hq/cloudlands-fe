<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';

  export let toolUse: ToolUseBlock;
  export let state: 'running' | 'completed' | 'error' = 'running';
  export let result: any = null;
</script>

<button class="tool-call">
  {toolUse.name} - {state}
</button>

<style>
  .tool-call {
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #f5f5f5;
  }
</style>
