<script lang="ts">
  import type { ArtifactDocument, ArtifactSelection } from '$shared/types/visual-artifact';
  let {
    document,
    onChange,
    onSelect,
    readonly,
  }: {
    document: ArtifactDocument;
    onChange: (document: ArtifactDocument) => void;
    onSelect: (selection: ArtifactSelection) => void;
    readonly?: boolean;
  } = $props();
</script>

<p data-testid="title">{document.title}</p>
<button disabled={readonly} onclick={() => onChange({ ...document, title: 'Edited title' })}
  >Edit document</button
>
<button onclick={() => onSelect({ itemIds: ['card-a'] })}>Select card</button>
