<script lang="ts">
  let { noteId }: { noteId?: string } = $props();
</script>

<div data-testid="note-with-comments" data-note-id={noteId}></div>
