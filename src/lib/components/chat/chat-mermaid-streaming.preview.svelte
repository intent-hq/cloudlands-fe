<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    startAt?: 'start' | 'complete';
  }

  export const preview = definePreview<Props>({
    id: 'chat-mermaid-streaming',
    title: 'Streaming chat diagrams', // i18n-ignore (developer preview title)
    defaultState: 'complete',
    captureReadiness: { selector: '.mermaid-renderer[data-render-settled="true"]', count: 1 },
    states: {
      start: { props: { startAt: 'start' } },
      complete: { props: { startAt: 'complete' } },
    },
  });

  // i18n-ignore (deterministic agent-authored content for the streaming preview)
  const chunks = ['flowchart LR\n A[Draft]', '\n A -->|Review| B[Check]', '\n B --> C[Sh', 'ip]'];
  // i18n-ignore (developer preview diagnostics)
  const stages = ['First node', 'New connection', 'Incomplete chunk', 'New node', 'Complete'];
  // Simulated incoming chunks, not an animation duration. Pause/step can hold any chunk.
  const CHUNK_INTERVAL_MS = 1600;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ContentBlock } from '$shared/types';
  import StreamingMessageContent from './StreamingMessageContent.svelte';

  let { startAt = 'complete' }: Props = $props();
  let step = $state(untrack(() => (startAt === 'start' ? 0 : chunks.length)));
  let playing = $state(false);
  let replay = $state(0);
  const complete = $derived(step === chunks.length);
  const content: ContentBlock[] = $derived([
    {
      type: 'text',
      // i18n-ignore (deterministic agent-authored content for the streaming preview)
      text: `Here is the delivery flow.\n\n~~~mermaid\n${chunks.slice(0, step + 1).join('')}${complete ? '\n~~~\n\nEach new step appears as the response arrives.' : ''}`,
    },
  ]);

  function restart() {
    replay += 1;
    step = 0;
    playing = true;
  }

  function next() {
    playing = false;
    if (!complete) step += 1;
  }

  $effect(() => {
    // Include replay so restarting while the first chunk is visible resets its timer too.
    void replay;
    if (!playing || complete) return;
    const currentStep = step;
    const timer = setTimeout(() => {
      step = currentStep + 1;
      if (step === chunks.length) playing = false;
    }, CHUNK_INTERVAL_MS);
    return () => clearTimeout(timer);
  });
</script>

<!-- i18n-ignore (developer-only replay controls and diagnostics) -->
<section class="preview" data-probe="chat-mermaid-preview">
  <header>
    <h1 class="type-title">Streaming chat diagrams</h1>
    <p class="type-caption text-muted-foreground">
      Replay the response, or pause and step through each chunk. The unfinished chunk keeps the last
      diagram visible.
    </p>
  </header>
  <div class="controls" data-probe="replay-controls">
    <Button variant="outline" size="sm" onclick={restart}>Replay</Button>
    <Button variant="outline" size="sm" disabled={complete} onclick={() => (playing = !playing)}
      >{playing ? 'Pause' : 'Continue'}</Button
    >
    <Button variant="outline" size="sm" disabled={complete} onclick={next}>Next chunk</Button>
    <span class="type-caption text-muted-foreground" role="status">{stages[step]}</span>
  </div>
  <article class="conversation" data-probe="conversation" aria-label="Streaming chat response">
    {#key replay}
      <StreamingMessageContent {content} isStreaming={!complete} role="assistant" />
    {/key}
  </article>
</section>

<style>
  .preview {
    width: 100%;
    min-width: 0;
    display: grid;
    gap: var(--space-4);
    color: hsl(var(--foreground));
  }

  header {
    display: grid;
    gap: var(--space-2);
  }

  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .conversation {
    min-width: 0;
    padding: var(--space-4);
    background: hsl(var(--background));
  }
</style>
