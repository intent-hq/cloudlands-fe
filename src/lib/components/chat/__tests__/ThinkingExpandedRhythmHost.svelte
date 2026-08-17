<script lang="ts">
  import { onDestroy } from 'svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import ThinkingBlock from '../ThinkingBlock.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    streamStage?: 'partial' | 'complete';
  }

  let { theme = 'dark', width = 280, zoom = 1, streamStage = 'partial' }: Props = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(disposeStore);

  const staticContent = `# Reasoning rhythm

First paragraph with \`inline code\`.

## Inspect chunks

- First list item
- Second list item

\`\`\`ts
const seam = 8;
\`\`\`

Final paragraph.
**Nested strong heading**
Nested strong body.`;

  const streamingContent = $derived(
    streamStage === 'partial'
      ? `# Streaming rhythm

First streamed paragraph with \`inline code\`.

## Streamed heading
**Nested strong heading**`
      : `# Streaming rhythm

First streamed paragraph with \`inline code\`.

## Streamed heading

- Reconciled list item
- Stable list item

\`\`\`ts
const streamedSeam = 8;
\`\`\`

Final streamed paragraph.
**Nested strong heading**
Nested strong body.`,
  );
</script>

<section
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  class="bg-background p-3 text-foreground"
  data-testid="expanded-reasoning-rhythm-host"
>
  <div data-testid="static-reasoning-rhythm">
    <ThinkingBlock content={staticContent} workspaceId="reasoning-rhythm" />
  </div>
  <div class="mt-3" data-testid="streaming-reasoning-rhythm">
    <ThinkingBlock content={streamingContent} isStreaming workspaceId="reasoning-rhythm" />
  </div>
</section>
