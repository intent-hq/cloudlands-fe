<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'tool-completion-status',
    title: 'Tool completion status',
    defaultState: 'mixed',
    captureReadiness: { selector: '[data-tool-icon]' },
    states: {
      mixed: { props: { statuses: ['completed', 'error', 'started'] } },
      completed: { props: { statuses: ['completed'] } },
      error: { props: { statuses: ['error'] } },
      started: { props: { statuses: ['started'] } },
    },
  });
</script>

<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import ToolCall from './ToolCall.svelte';
  import { resolveToolState } from './tool-result-pairing';

  let { statuses = ['completed', 'error', 'started'] }: { statuses?: string[] } = $props();

  const content = $derived(
    statuses.map((status, index): ToolUseBlock => ({
      type: 'tool_use',
      id: `tool-status:${index}`,
      toolCallId: `call-status-${index}`,
      name: 'launch-process',
      input: { command: `printf '${status}'` },
      metadata: { toolKind: 'execute', status },
    })),
  );
</script>

<div class="w-full bg-background p-6 text-foreground">
  {#each content as block (block.id)}
    <ToolCall toolUse={block} toolState={resolveToolState(block, undefined, true)} />
  {/each}
</div>
