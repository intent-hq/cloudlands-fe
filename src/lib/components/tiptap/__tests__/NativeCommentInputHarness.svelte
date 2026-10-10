<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
  let { source, markdownCopy = false }: { source: string; markdownCopy?: boolean } = $props();
  let host: HTMLDivElement;
  onMount(() => {
    let disposed = false;
    let editor: Editor | undefined;
    void processMarkdownToHTML(source).then((content) => {
      if (disposed) return;
      editor = new Editor(
        createEditorConfig({
          element: host,
          content,
          editable: true,
          useMarkdown: true,
          enableComments: true,
          copySelectionAsMarkdown: markdownCopy,
          enableMentions: false,
          onUpdate: () => {},
        }),
      );
      Object.assign(host, { editor, markdown: () => processHTMLToMarkdown(editor!.getHTML()) });
    });
    return () => {
      disposed = true;
      editor?.destroy();
    };
  });
</script>

<div bind:this={host} data-testid="native-comment-input"></div>
