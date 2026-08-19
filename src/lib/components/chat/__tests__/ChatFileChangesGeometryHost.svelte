<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import ChatFileChangesSummary from '../ChatFileChangesSummary.svelte';
  import StreamingTypingIndicator from '../StreamingTypingIndicator.svelte';

  let { width = 240, zoom = 1 }: { width?: number; zoom?: number } = $props();

  const message = {
    id: 'file-summary-geometry',
    role: 'assistant',
    timestamp: '2026-08-17T12:00:00.000Z',
    contentBlocks: Array.from({ length: 1_234 }, (_, index) => ({
      type: 'tool_use',
      id: `file-summary-tool-${index}`,
      name: 'save_file',
      input: { path: `src/file-${index}.ts`, content: `export const value${index} = true;` },
    })),
  } as AgentMessage;
</script>

<section
  class="bg-background p-3 text-foreground"
  style:width="{width}px"
  style:zoom
  data-testid="file-summary-geometry-host"
>
  <div data-testid="reference-operational-row">
    <StreamingTypingIndicator visible message="Reference operational row" />
  </div>
  <div data-testid="file-summary-row">
    <ChatFileChangesSummary
      workspaceId="file-summary-geometry"
      {message}
      suffix="in conversation so far"
      isAggregate
      readOnly
    />
  </div>
</section>
