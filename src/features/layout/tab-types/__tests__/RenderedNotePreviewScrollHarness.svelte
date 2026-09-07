<script lang="ts">
  import RenderedNotePreview from '../RenderedNotePreview.svelte';

  let { content }: { content: string } = $props();
  let showPreview = $state(true);
  let savedScrollPosition = $state(0);
</script>

<div style="height: 260px; display: flex; flex-direction: column;">
  <button type="button" data-testid="toggle-preview" onclick={() => (showPreview = !showPreview)}>
    Toggle preview
  </button>
  <div style="min-height: 0; flex: 1;">
    {#if showPreview}
      <RenderedNotePreview
        {content}
        workspaceId="preview-workspace"
        noteId="preview-note"
        initialScrollPosition={savedScrollPosition}
        onScrollPositionSave={(scrollTop) => (savedScrollPosition = scrollTop)}
      />
    {/if}
  </div>
  <output data-testid="saved-scroll-position">{savedScrollPosition}</output>
</div>
