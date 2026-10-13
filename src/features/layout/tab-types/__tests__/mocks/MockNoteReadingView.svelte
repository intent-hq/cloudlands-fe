<script lang="ts">
  let {
    onFullOperation,
  }: {
    onFullOperation: (
      kind: 'copy',
      selection: { anchor: number; head: number; anchorAffinity: 1; headAffinity: -1 },
    ) => void;
  } = $props();
</script>

<button
  onclick={() =>
    onFullOperation('copy', { anchor: 1, head: 2, anchorAffinity: 1, headAffinity: -1 })}
  >Copy selected note text</button
>
