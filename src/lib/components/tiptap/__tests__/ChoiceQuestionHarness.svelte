<script lang="ts">
  /**
   * Test harness for ChoiceQuestion node
   *
   * Creates a minimal TipTap editor with just the ChoiceQuestion node
   * for isolated testing.
   */
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import { ChoiceQuestion } from '../ChoiceQuestion';

  interface Props {
    initialText?: string;
  }

  let { initialText = 'Test question' }: Props = $props();

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [Document, Paragraph, Text, ChoiceQuestion],
      content: {
        type: 'doc',
        content: [
          {
            type: 'choiceQuestion',
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
