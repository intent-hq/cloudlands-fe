<script lang="ts">
  /**
   * CT harness for the Mermaid block lane in the note editor.
   *
   * Mounts a production TipTap editor with the production MermaidBlock node
   * (and its Svelte node view) inside a host that models the note layout
   * contract from NoteWithComments: a container-query host (`100cqw` is the
   * full editor width) around a centered, padded prose column. The global
   * tiptap-editor.css breakout rules then decide which lane each block uses.
   */
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { MermaidBlock } from '../MermaidBlock';

  interface Props {
    code: string;
    hostWidth: number;
  }

  let { code, hostWidth }: Props = $props();

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [StarterKit, MermaidBlock],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph before the diagram.' }],
          },
          { type: 'mermaidBlock', attrs: { code } },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Paragraph after the diagram.' }],
          },
        ],
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

  // Prop updates swap the block's source in place, like the code editor does.
  $effect(() => {
    if (!editor) return;
    const { state } = editor;
    let tr = state.tr;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'mermaidBlock' || node.attrs.code === code) return;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, code });
    });
    if (tr.docChanged) editor.view.dispatch(tr);
  });
</script>

<div class="note-host" style:width="{hostWidth}px" data-testid="note-host">
  <div class="prose-column">
    <div bind:this={editorElement} class="tiptap-editor-wrapper" data-testid="editor"></div>
  </div>
</div>

<style>
  .note-host {
    container-type: inline-size;
    overflow-x: hidden;
  }

  .prose-column {
    width: 100%;
    max-width: 60rem;
    margin: 0 auto;
    padding: 0 3rem;
    box-sizing: border-box;
  }
</style>
