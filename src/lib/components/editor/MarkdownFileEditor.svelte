<script lang="ts">
  /**
   * MarkdownFileEditor
   *
   * A read-write rich-text editor for markdown files from the workspace.
   * Uses TipTap with the same editor config as notes, but without
   * notes-specific features (CRDT, comments, mentions, primitives).
   *
   * Content flow:
   *   markdown string → processMarkdownToHTML → TipTap (editable)
   *   TipTap HTML → processHTMLToMarkdown → markdown string (emitted via bind:value)
   */

  import {
  onMount,
  onDestroy,
} from 'svelte';
  import { Editor } from '@tiptap/core';
  import { createEditorConfig } from '$lib/utils/editor-config';
  import {
  processMarkdownToHTML,
  processHTMLToMarkdown,
  extractFrontMatter,
} from '$lib/utils/markdown-processor';
  import BubbleMenu from '$lib/components/tiptap/BubbleMenu.svelte';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { openWorkspaceFile } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';


  interface Props {
    /** Markdown content (two-way bindable) */
    value: string;
    /** Whether the editor is read-only */
    readOnly?: boolean;
  }

  let { value = $bindable(), readOnly = false }: Props = $props();

  let element: HTMLDivElement | undefined = $state();
  let editor: Editor | null = $state(null);
  let isInitializing = $state(true);

  // Track the last markdown we set into the editor to avoid round-trip loops
  let lastMarkdownFromEditor = '';
  // Track the last markdown we received from parent to avoid re-processing on our own edits
  let lastMarkdownFromParent = '';

  // Preserve YAML front matter across the markdown→HTML→markdown round-trip.
  // marked doesn't understand front matter and will corrupt the --- delimiters,
  // so we strip it before rendering and re-attach it when converting back.
  let preservedFrontMatter: string | null = null;

  /**
   * Handle TipTap content updates: convert HTML → markdown and emit
   */
  function handleEditorUpdate(html: string) {
    const markdown = processHTMLToMarkdown(html, { preserveAnchors: false });
    // Ensure there's a newline separator between front matter and body
    // (front matter may end at EOF without trailing newline)
    const separator = preservedFrontMatter && !preservedFrontMatter.endsWith('\n') ? '\n' : '';
    const fullMarkdown = preservedFrontMatter ? preservedFrontMatter + separator + markdown : markdown;
    lastMarkdownFromEditor = fullMarkdown;
    value = fullMarkdown;
  }

  /**
   * Initialize the TipTap editor
   */
  async function initializeEditor() {
    if (!element) return;

    // Extract and preserve YAML front matter before processing
    const { frontMatter } = extractFrontMatter(value);
    preservedFrontMatter = frontMatter;

    const html = await processMarkdownToHTML(value, {
      preserveAnchors: false,
      processPrimitives: false,
    });

    lastMarkdownFromParent = value;
    lastMarkdownFromEditor = value;

    const config = createEditorConfig({
      element,
      content: html,
      editable: !readOnly,
      onUpdate: handleEditorUpdate,
      onFilePathClick: (filePath, event) => {
        const openInAdjacentPanel = event.metaKey || event.ctrlKey;
        const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
        const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
        const wsId = selectActiveWorkspaceId.select(getReduxStore().getState());
        if (wsId) {
          getReduxStore().dispatch(
            openWorkspaceFile(wsId, filePath, { openInAdjacentPanel, sourcePanelId }),
          );
        }
      },
      useMarkdown: true,
      enableComments: false,
      enableMentions: false,
      enableNotePrimitives: false,
    });

    editor = new Editor(config);
    isInitializing = false;
  }

  onMount(() => {
    initializeEditor();
  });

  onDestroy(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
      editor = null;
    }
  });

  // When parent changes value (e.g., external file reload), update editor
  $effect(() => {
    const currentValue = value;

    // Skip if this is our own edit echoing back
    if (currentValue === lastMarkdownFromEditor) return;
    // Skip if value hasn't actually changed from what we last loaded
    if (currentValue === lastMarkdownFromParent) return;

    if (editor && !editor.isDestroyed) {
      lastMarkdownFromParent = currentValue;
      // Re-extract front matter in case it changed externally
      const { frontMatter } = extractFrontMatter(currentValue);
      preservedFrontMatter = frontMatter;
      // Re-process markdown → HTML and set into editor
      processMarkdownToHTML(currentValue, {
        preserveAnchors: false,
        processPrimitives: false,
      }).then((html) => {
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(html, { emitUpdate: false });
          lastMarkdownFromEditor = currentValue;
        }
      });
    }
  });

  // Update editability when readOnly changes
  $effect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!readOnly);
    }
  });
</script>

<div class="markdown-file-editor h-full overflow-y-auto">
  {#if isInitializing}
    <div class="p-6 space-y-3 animate-pulse">
      <div class="h-7 bg-muted rounded w-3/4"></div>
      <div class="h-4 bg-muted rounded w-full"></div>
      <div class="h-4 bg-muted rounded w-5/6"></div>
      <div class="h-4 bg-muted rounded w-4/5"></div>
      <div class="h-4 bg-muted rounded w-full"></div>
      <div class="h-4 bg-muted rounded w-2/3"></div>
    </div>
  {/if}
  <div
    bind:this={element}
    class="tiptap-editor-wrapper h-full"
    class:opacity-0={isInitializing}
  ></div>

  {#if editor}
    <BubbleMenu {editor} showNoteActions={false} />
  {/if}
</div>

<style>
  .markdown-file-editor {
    container-type: inline-size;
  }

  .markdown-file-editor :global(.tiptap-editor) {
    padding: 1.5rem 2rem 8rem;
    max-width: 52rem;
    margin: 0 auto;
  }
</style>
