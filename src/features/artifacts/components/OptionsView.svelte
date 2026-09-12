<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { ArtifactDocument, ArtifactSelection } from '$shared/types/visual-artifact';
  import { displayImageSource } from './editor-actions';
  let {
    document,
    imageSources = {},
    onChange,
    onSelect,
    selection,
    readonly,
  }: {
    document: ArtifactDocument;
    imageSources?: Record<string, string>;
    onChange: (document: ArtifactDocument) => void;
    onSelect: (selection: ArtifactSelection) => void;
    selection: ArtifactSelection;
    readonly: boolean;
  } = $props();
  function choose(id: string) {
    if (readonly) return;
    const chosen = document.chosenIds ?? [];
    onChange({
      ...document,
      chosenIds: chosen.includes(id) ? chosen.filter((value) => value !== id) : [...chosen, id],
    });
  }
</script>

<p class="artifact-hint">{m.artifact_editor_options_hint()}</p>
<div class="artifact-options">
  {#each document.items as item (item.id)}
    <article class="artifact-option" class:artifact-selected={selection.itemIds.includes(item.id)}>
      <Button
        variant="outline"
        class="artifact-option-content"
        aria-pressed={selection.itemIds.includes(item.id)}
        onclick={(event) =>
          onSelect({
            itemIds: event.shiftKey
              ? selection.itemIds.includes(item.id)
                ? selection.itemIds.filter((id) => id !== item.id)
                : [...selection.itemIds, item.id]
              : [item.id],
          })}
      >
        {#if item.src && displayImageSource(item.src, imageSources)}<img
            src={displayImageSource(item.src, imageSources)}
            alt=""
          />{/if}
        <span>{item.text}</span>
      </Button>
      <Button
        variant="outline"
        class={`artifact-choice ${document.chosenIds?.includes(item.id) ? 'artifact-chosen' : ''}`}
        aria-pressed={document.chosenIds?.includes(item.id) ?? false}
        disabled={readonly}
        onclick={() => choose(item.id)}
      >
        {document.chosenIds?.includes(item.id)
          ? m.artifact_editor_chosen()
          : m.artifact_editor_choose()}
      </Button>
    </article>
  {/each}
</div>
