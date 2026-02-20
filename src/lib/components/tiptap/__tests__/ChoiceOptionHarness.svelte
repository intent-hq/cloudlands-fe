<script lang="ts">
  /**
   * Test harness for ChoiceOption node
   *
   * Creates a minimal TipTap editor with just the ChoiceOption node
   * for isolated testing.
   */
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import { ChoiceOption } from '../ChoiceOption';

  interface Props {
    initialText?: string;
    selected?: boolean;
  }

  let { initialText = 'Test option', selected = false }: Props = $props();

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [Document, Paragraph, Text, ChoiceOption],
      content: {
        type: 'doc',
        content: [
          {
            type: 'choiceOption',
            attrs: {
              selected: selected,
            },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: initialText }],
              },
            ],
          },
        ],
      },
      editorProps: {
        attributes: {
          class: 'tiptap-editor',
        },
      },
    });

    // Expose editor to window for debugging
    (window as any).testEditor = editor;

    return () => {
      editor?.destroy();
    };
  });
</script>

<div bind:this={editorElement} class="editor-container"></div>

<style>
  .editor-container {
    border: 1px solid #ccc;
    padding: 1rem;
    min-height: 100px;
  }

  :global(.tiptap-editor) {
    outline: none;
  }

  :global(.tiptap-editor p) {
    margin: 0;
  }
</style>
