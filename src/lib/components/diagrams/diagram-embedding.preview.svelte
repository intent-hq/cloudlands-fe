<script lang="ts" module>
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { m } from '$shared/paraglide/messages.js';
  import { CUSTOM_WORKBENCH_CASES } from './diagram-workbench.preview-fixtures';

  export interface DiagramEmbeddingPreviewProps {
    context: 'note' | 'chat';
    diagram: DiagramPrimitive;
  }

  const architecture = CUSTOM_WORKBENCH_CASES['custom-architecture'];
  if (architecture.kind !== 'custom') throw new Error('Expected a custom diagram fixture.');

  export const preview = definePreview<DiagramEmbeddingPreviewProps>({
    id: 'diagram-embedding',
    get title() {
      return m.sandbox_diagramWorkbench_review_title();
    },
    defaultState: 'note',
    states: {
      note: { props: { context: 'note', diagram: architecture.diagram } },
      chat: { props: { context: 'chat', diagram: architecture.diagram } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import MessageContent from '$lib/components/chat/MessageContent.svelte';
  import DiagramPresentation from './DiagramPresentation.svelte';
  import DiagramRenderer from './DiagramRenderer.svelte';

  let { context, diagram }: DiagramEmbeddingPreviewProps = $props();
  let previewElement = $state<HTMLElement>();

  const chatContent: ContentBlock[] = $derived([
    {
      type: 'text',
      // i18n-ignore (deterministic fake agent response used only by the preview)
      text: `The preview uses a fixed architecture fixture.\n\n~~~diagram\n${JSON.stringify(diagram)}\n~~~\n\nThe shared actions can copy or download the rendered diagram.`,
    },
  ]);

  onMount(() => {
    requestAnimationFrame(() => {
      previewElement
        ?.querySelector<HTMLButtonElement>('button[aria-label="Diagram actions"]')
        ?.click();
    });
  });
</script>

<section
  class="mx-auto w-full max-w-4xl"
  data-diagram-embedding-preview
  data-embedding-context={context}
  bind:this={previewElement}
>
  {#if context === 'note'}
    <article
      class="note-font-serif rounded-lg bg-background px-8 py-10"
      aria-label={m.sandbox_diagramWorkbench_stage_ariaLabel()}
    >
      <div class="tiptap-editor ProseMirror" contenteditable="false">
        <!-- i18n-ignore (deterministic fake note content used only by the preview) -->
        <p>The team uses this note to explain how the preview remains local and deterministic.</p>
        <div class="node-diagram_block" data-preview-note-diagram>
          <DiagramPresentation kind="custom" fileName="preview-architecture">
            <DiagramRenderer {diagram} editable={false} />
          </DiagramPresentation>
        </div>
        <!-- i18n-ignore (deterministic fake note content used only by the preview) -->
        <p>The same shared action menu is available in notes and completed agent messages.</p>
      </div>
    </article>
  {:else}
    <article
      class="rounded-lg bg-background px-8 py-10"
      aria-label={m.sandbox_diagramWorkbench_stage_ariaLabel()}
    >
      <MessageContent content={chatContent} role="assistant" />
    </article>
  {/if}
</section>
