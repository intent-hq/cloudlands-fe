<script lang="ts">
  /**
   * CT harness for the line attribution gutter (intent-hq/intent#5575).
   *
   * Mounts the production `LineAttributionGutter` beside a production TipTap
   * editor inside a host that models the note panel layout contract from
   * NoteWithComments: a clipping `#editor-content` scroll container (the
   * gutter reads it by id for viewport clamping) around a centered prose
   * column whose horizontal padding is the content gutter. The attribution
   * data itself arrives through the daemon seam (`note.lineAttribution.load`),
   * scripted by the spec's `mockBackend` hooks config.
   */
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import LineAttributionGutter from '../LineAttributionGutter.svelte';
  import type { NoteId, WorkspaceId } from '$shared/types';

  interface Props {
    hostWidth: number;
    hostHeight?: number;
    markdown: string;
  }

  let { hostWidth, hostHeight = 640, markdown }: Props = $props();

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: {
        type: 'doc',
        content: markdown
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) =>
            line.startsWith('# ')
              ? {
                  type: 'heading',
                  attrs: { level: 1 },
                  content: [{ type: 'text', text: line.slice(2) }],
                }
              : { type: 'paragraph', content: [{ type: 'text', text: line }] },
          ),
      },
      editorProps: {
        attributes: { class: 'tiptap-editor' },
      },
    });

    return () => {
      editor?.destroy();
      editor = null;
    };
  });
</script>

<div
  class="editor-container flex relative overflow-hidden"
  style:width="{hostWidth}px"
  style:height="{hostHeight}px"
  data-testid="note-host"
>
  <section
    id="editor-content"
    class="note-content-container relative flex-1 pt-6 overflow-y-auto"
    data-testid="editor-content"
  >
    <div class="positioning-relative-container relative min-h-full" data-testid="prose-column">
      {#if editor}
        <LineAttributionGutter
          {editor}
          workspaceId={'ws-1' as WorkspaceId}
          noteId={'note-1' as NoteId}
          {markdown}
        />
      {/if}
      <div bind:this={editorElement} class="tiptap-editor-wrapper" data-testid="editor"></div>
    </div>
  </section>
</div>

<style>
  .note-content-container {
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
    container-type: inline-size;
    --content-max-width: 60rem;
    --content-gutter-left: 3rem;
  }

  .positioning-relative-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100%;
    align-self: center;
    width: 100%;
    max-width: var(--content-max-width);
    padding-left: var(--content-gutter-left);
    padding-right: var(--content-gutter-left);
  }

  .tiptap-editor-wrapper {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
</style>
