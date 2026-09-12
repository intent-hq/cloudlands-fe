<script lang="ts">
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { ArtifactDocument, ArtifactSelection } from '$shared/types/visual-artifact';
  import { displayImageSource } from './editor-actions';
  import { rectangle } from './editor-actions';
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
  let start = $state<{ x: number; y: number }>();
  let text = $state('');
  function point(event: PointerEvent) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }
  function annotate() {
    if (readonly || !selection.region || !text.trim() || document.annotations.length >= 200) return;
    onChange({
      ...document,
      annotations: [
        ...document.annotations,
        {
          id: crypto.randomUUID(),
          selection: structuredClone($state.snapshot(selection)),
          text: text.trim(),
        },
      ],
    });
    text = '';
  }
</script>

<p class="artifact-hint">{m.artifact_editor_image_hint()}</p>
{#if document.image && displayImageSource(document.image.src, imageSources)}
  <div class="artifact-image-wrap">
    <div class="artifact-image-stage">
      <img
        class="artifact-image"
        src={displayImageSource(document.image.src, imageSources)}
        alt={document.image.alt}
        draggable="false"
      />
      <Button
        variant="outline"
        class="artifact-image-target"
        aria-label={m.artifact_editor_region()}
        onpointerdown={(event) => {
          if (event.button !== 0) return;
          start = point(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          onSelect({ itemIds: [], region: rectangle(start, start) });
        }}
        onpointermove={(event) => {
          if (start) onSelect({ itemIds: [], region: rectangle(start, point(event)) });
        }}
        onpointerup={(event) => {
          if (start) onSelect({ itemIds: [], region: rectangle(start, point(event)) });
          start = undefined;
        }}
        onpointercancel={() => (start = undefined)}
        onclick={(event) => {
          if (event.detail === 0)
            onSelect({ itemIds: [], region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
        }}
      >
        {#each document.annotations as annotation (annotation.id)}
          {#if annotation.selection.region}
            {@const region = annotation.selection.region}
            <span
              class="artifact-region artifact-saved-region"
              style:left="{region.x * 100}%"
              style:top="{region.y * 100}%"
              style:width="{region.width * 100}%"
              style:height="{region.height * 100}%"
            ></span>
          {/if}
        {/each}
        {#if selection.region}
          <span
            class="artifact-region"
            style:left="{selection.region.x * 100}%"
            style:top="{selection.region.y * 100}%"
            style:width="{selection.region.width * 100}%"
            style:height="{selection.region.height * 100}%"
          ></span>
        {/if}
      </Button>
    </div>
  </div>
{:else}
  <p class="artifact-hint">{m.artifact_editor_image_unavailable()}</p>
{/if}
{#if !readonly}
  <form
    class="artifact-inspector"
    onsubmit={(event) => {
      event.preventDefault();
      annotate();
    }}
  >
    <label
      >{m.artifact_editor_annotation()}<Textarea bind:value={text} maxlength={16000}
      ></Textarea></label
    >
    <Button
      variant="outline"
      type="submit"
      disabled={!selection.region || !text.trim() || document.annotations.length >= 200}
      >{m.artifact_editor_add_annotation()}</Button
    >
  </form>
{/if}
<div class="artifact-annotations">
  {#each document.annotations as annotation (annotation.id)}
    <div class="artifact-annotation">
      <Button
        variant="outline"
        class="artifact-annotation-text"
        onclick={() => onSelect(structuredClone($state.snapshot(annotation.selection)))}
        >{annotation.text}</Button
      >
      {#if !readonly}<Button
          variant="outline"
          aria-label={m.artifact_editor_delete()}
          onclick={() =>
            onChange({
              ...document,
              annotations: document.annotations.filter((value) => value.id !== annotation.id),
            })}>×</Button
        >{/if}
    </div>
  {/each}
</div>
