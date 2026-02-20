<script lang="ts">
  /**
   * Integration test harness for complete Choice Block
   *
   * Creates a TipTap editor with all three nodes:
   * - ChoiceBlock (container)
   * - ChoiceQuestion (question text)
   * - ChoiceOption (options with selection)
   */
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import Document from '@tiptap/extension-document';
  import Paragraph from '@tiptap/extension-paragraph';
  import Text from '@tiptap/extension-text';
  import { ChoiceBlock } from '../ChoiceBlock';
  import { ChoiceQuestion } from '../ChoiceQuestion';
  import { ChoiceOption } from '../ChoiceOption';

  interface ChoiceOptionData {
    text: string;
    selected: boolean;
  }

  interface Props {
    question?: string;
    options?: ChoiceOptionData[];
  }

  let {
    question = 'Test question',
    options = [
      { text: 'Option A', selected: false },
      { text: 'Option B', selected: true },
    ],
  }: Props = $props();

  let editorElement: HTMLDivElement;
  let editor: Editor | null = $state(null);

  onMount(() => {
    // Build the choice block content structure
    const choiceBlockContent = {
      type: 'doc',
      content: [
        {
          type: 'choiceBlock',
          content: [
            // Question node
            {
              type: 'choiceQuestion',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: question }],
                },
              ],
            },
            // Option nodes
            ...options.map((option) => ({
              type: 'choiceOption',
              attrs: {
                selected: option.selected,
              },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: option.text }],
                },
              ],
            })),
          ],
        },
      ],
    };

    editor = new Editor({
      element: editorElement,
      extensions: [Document, Paragraph, Text, ChoiceBlock, ChoiceQuestion, ChoiceOption],
      content: choiceBlockContent,
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
    min-height: 200px;
  }

  :global(.tiptap-editor) {
    outline: none;
  }

  :global(.tiptap-editor p) {
    margin: 0;
  }
</style>
