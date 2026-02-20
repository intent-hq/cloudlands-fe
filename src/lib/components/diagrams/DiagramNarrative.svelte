<script lang="ts">
  /**
   * Diagram Narrative Component
   *
   * Displays narrative text for the current state
   */
  import type { DiagramNarrative } from '$shared/types/notes-primitives';

  interface Props {
    narrative: DiagramNarrative;
  }

  let { narrative }: Props = $props();
</script>

<div
  class="absolute top-4 left-4 max-w-md bg-background/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-lg pointer-events-auto"
>
  {#if narrative.title}
    <h3 class="text-sm font-semibold mb-2">{narrative.title}</h3>
  {/if}
  {#if narrative.text}
    <p class="text-xs text-muted-foreground">{narrative.text}</p>
  {/if}
</div>
