<script lang="ts">
  import { untrack } from 'svelte';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import { m } from '$shared/paraglide/messages.js';
  import DiagramRenderer from './DiagramRenderer.svelte';

  interface Props {
    diagram: DiagramPrimitive | null;
    isStreaming?: boolean;
    source: string;
    sourceError?: string;
    viewResetKey?: string;
    onBindingClick?: (event: MouseEvent, binding: { type: string; target: string }) => void;
  }

  let {
    diagram,
    isStreaming = false,
    source,
    sourceError,
    viewResetKey,
    onBindingClick,
  }: Props = $props();
  let lastGood = $state<DiagramPrimitive | null>(null);
  let rendererRevision = $state(0);
  let previousSource = '';
  let previousKey: string | undefined;
  let initialized = false;

  $effect.pre(() => {
    const incoming = diagram;
    const raw = source;
    const key = viewResetKey;
    const streaming = isStreaming;
    const invalid = Boolean(sourceError);
    untrack(() => {
      // A replacement must not inherit an unrelated preview or local walkthrough step.
      if (initialized && (key !== previousKey || !raw.startsWith(previousSource))) {
        lastGood = null;
        rendererRevision += 1;
      }
      initialized = true;
      previousSource = raw;
      previousKey = key;
      if (invalid || (!streaming && !incoming)) lastGood = null;
      else if (incoming) lastGood = incoming;
    });
  });

  const displayed = $derived(sourceError ? null : (diagram ?? (isStreaming ? lastGood : null)));
  const failed = $derived(Boolean(sourceError) || (!isStreaming && !diagram));
</script>

<div class="streaming-diagram" aria-busy={isStreaming} data-diagram-streaming={isStreaming}>
  {#if failed}
    <div class="diagram-feedback" role="alert">
      <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
      <span>{m.diagram_renderer_error_description()}</span>
    </div>
    <pre class="diagram-source" aria-label={m.markdown_mermaid_viewSource_label()}>{source}</pre>
  {:else if displayed}
    {#key rendererRevision}
      <DiagramRenderer diagram={displayed} editable={false} {viewResetKey} {onBindingClick} />
    {/key}
  {:else}
    <div class="diagram-feedback" role="status">{m.ui_spinner_loading_ariaLabel()}</div>
  {/if}
</div>

<style>
  .streaming-diagram {
    min-width: 0;
    width: 100%;
  }

  .diagram-feedback {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-4);
    color: hsl(var(--muted-foreground));
  }

  .diagram-source {
    max-height: 20rem;
    overflow: auto;
    padding: var(--space-4);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
