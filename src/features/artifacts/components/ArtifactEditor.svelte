<script lang="ts">
  import type { ArtifactDocument, ArtifactSelection } from '$shared/types/visual-artifact';
  import BoardView from './BoardView.svelte';
  import ImageView from './ImageView.svelte';
  import OptionsView from './OptionsView.svelte';
  import PreviewView from './PreviewView.svelte';
  import './editor.css';
  let {
    document,
    imageSources = {},
    onChange,
    onSelect,
    selection = { itemIds: [] },
    readonly = false,
  }: {
    document: ArtifactDocument;
    imageSources?: Record<string, string>;
    onChange: (document: ArtifactDocument) => void;
    onSelect: (selection: ArtifactSelection) => void;
    selection?: ArtifactSelection;
    readonly?: boolean;
  } = $props();
</script>

<div class="artifact-editor" data-artifact-kind={document.kind}>
  {#if document.kind === 'board'}
    <BoardView {document} {imageSources} {onChange} {onSelect} {selection} {readonly} />
  {:else if document.kind === 'image'}
    <ImageView {document} {imageSources} {onChange} {onSelect} {selection} {readonly} />
  {:else if document.kind === 'options'}
    <OptionsView {document} {imageSources} {onChange} {onSelect} {selection} {readonly} />
  {:else}
    <PreviewView {document} {onChange} {readonly} />
  {/if}
</div>
