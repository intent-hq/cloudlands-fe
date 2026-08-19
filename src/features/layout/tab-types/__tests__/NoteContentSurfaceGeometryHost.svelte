<script lang="ts">
  import NoteContentSurface, { type NoteContentState } from '../NoteContentSurface.svelte';

  let {
    state = 'editor',
    theme = 'light',
    width = 480,
    zoom = 1,
  }: {
    state?: NoteContentState;
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  } = $props();
</script>

<section class:dark={theme === 'dark'} data-note-surface-host>
  <div class="bg-card" style:width={`${width}px`} style:height="320px" style:zoom>
    <NoteContentSurface {state}>
      {#if state === 'loading'}
        <div class="h-full space-y-4 p-4" data-state-content><div class="h-8 w-3/4" /></div>
      {:else if state === 'empty' || state === 'missing'}
        <div class="flex h-full items-center justify-center" data-state-content>{state}</div>
      {:else}
        <article
          class:pointer-events-none={state === 'read-only'}
          class="min-h-full p-6"
          data-state-content
        >
          {state === 'recent-note' ? 'Recent note' : 'Note document'}
        </article>
      {/if}
    </NoteContentSurface>
  </div>
  <span class="bg-background" data-background-probe></span>
</section>
