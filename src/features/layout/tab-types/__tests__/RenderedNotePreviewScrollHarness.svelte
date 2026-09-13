<script lang="ts">
  import RenderedNotePreview from '../RenderedNotePreview.svelte';

  let { content }: { content: string } = $props();
  let activeNote = $state<'a' | 'b' | 'short'>('a');
  let savedScrollPositions = $state<Record<string, number>>({ a: 0, b: 360, short: 0 });
  const activeContent = $derived(activeNote === 'short' ? 'Short note' : content);

  function saveScrollPosition(scrollKey: string, scrollTop: number) {
    savedScrollPositions = { ...savedScrollPositions, [scrollKey]: scrollTop };
  }
</script>

<div style="height: 260px; display: flex; flex-direction: column;">
  <div>
    <button type="button" data-testid="show-note-a" onclick={() => (activeNote = 'a')}>A</button>
    <button type="button" data-testid="show-note-b" onclick={() => (activeNote = 'b')}>B</button>
    <button type="button" data-testid="show-short-note" onclick={() => (activeNote = 'short')}>
      Short
    </button>
  </div>
  <div style="min-height: 0; flex: 1;">
    <RenderedNotePreview
      content={activeContent}
      workspaceId="preview-workspace"
      noteId={`note-${activeNote}`}
      scrollKey={activeNote}
      initialScrollPosition={savedScrollPositions[activeNote]}
      onScrollPositionSave={saveScrollPosition}
    />
  </div>
  <output data-testid="saved-scroll-a">{savedScrollPositions.a}</output>
  <output data-testid="saved-scroll-b">{savedScrollPositions.b}</output>
</div>
