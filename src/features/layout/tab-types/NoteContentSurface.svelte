<script module lang="ts">
  export type NoteContentState =
    'editor' | 'loading' | 'empty' | 'missing' | 'read-only' | 'recent-note';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let { state, children }: { state: NoteContentState; children?: Snippet } = $props();
</script>

<div
  class="h-full min-h-0 w-full min-w-0 bg-background text-foreground"
  data-note-content-surface
  data-note-content-state={state}
>
  {#if children}
    {@render children()}
  {/if}
</div>
