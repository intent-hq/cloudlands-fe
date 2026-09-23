<script lang="ts">
  /**
   * CT harness for the remote cursor caret tag in the note editor.
   *
   * Mounts a production TipTap editor with the remote cursor decorations
   * plugin inside a host that models the note layout contract from
   * NoteWithComments: a scroll container that clips horizontally around a
   * centered, padded prose column. One remote caret is placed at `head`.
   */
  import '$lib/styles/tiptap-editor.css';
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import {
    createRemoteCursorDecorationsPlugin,
    remoteCursorColor,
    setRemoteCursors,
  } from '../RemoteCursorDecorations';

  interface Props {
    label: string;
    head: number;
    hostWidth: number;
    paragraphs: string[];
    avatarUrl?: string | null;
  }

  let { label, head, hostWidth, paragraphs, avatarUrl = null }: Props = $props();

  let editorElement: HTMLDivElement;

  onMount(() => {
    const editor = new Editor({
      element: editorElement,
      extensions: [StarterKit],
      content: {
        type: 'doc',
        content: paragraphs.map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      },
      editorProps: {
        attributes: { class: 'tiptap-editor' },
      },
    });
    editor.registerPlugin(createRemoteCursorDecorationsPlugin());
    setRemoteCursors(editor.view, [
      {
        principalId: 'principal-b',
        label,
        avatarUrl,
        color: remoteCursorColor('principal-b'),
        anchor: head,
        head,
      },
    ]);

    return () => {
      editor.destroy();
    };
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
    overflow-y: auto;
    height: 320px;
    padding-top: 1.5rem;
    box-sizing: border-box;
  }

  .prose-column {
    width: 100%;
    max-width: 60rem;
    margin: 0 auto;
    padding: 0 3rem;
    box-sizing: border-box;
  }
</style>
