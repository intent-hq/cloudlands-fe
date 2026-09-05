<!--
  TaskNotePreview - Hover preview card for linked Task Notes
  Shows first ~5 lines of content with markdown formatting preserved
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  import { createWorkspaceFileVersion } from '$lib/utils/workspace-file-image';
  import type { NoteId } from '$shared/types';

  import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
  import { toStore } from 'svelte/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    noteId: NoteId;
    class?: string;
  }

  let { workspaceId, noteId, class: className = '' }: Props = $props();

  // One cache-busting token per preview instance: re-rendering on note
  // updates keeps workspace image URLs stable.
  const workspaceFileVersion = createWorkspaceFileVersion();

  const workspaceId$ = toStore(() => workspaceId);
  const noteId$ = toStore(() => noteId);
  const note$ = selectNoteById(workspaceId$, noteId$);
  let note = $derived($note$ ?? null);

  // Extract first ~5 lines of content for preview
  let contentPreviewData = $derived.by(() => {
    if (!note?.content) return { markdown: '', hasMore: false };
    const allLines = note.content.split('\n').filter((l) => l.trim());
    const lines = allLines.slice(0, 5);
    const markdown = lines.join('\n');
    return { markdown, hasMore: allLines.length > 5 };
  });

  // Render markdown to HTML
  let renderedHtml = $state('');
  $effect(() => {
    let destroyed = false;
    const md = contentPreviewData.markdown;
    if (md) {
      processMarkdownToHTML(md, {
        allowEmpty: true,
        processPrimitives: false,
        workspaceId,
        workspaceFileVersion,
      }).then((html) => {
        if (destroyed) return;
        renderedHtml = html;
      });
    } else {
      renderedHtml = '';
    }

    return () => {
      destroyed = true;
    };
  });
</script>

<div class="w-72 bg-popover border border-border shadow {className}" role="tooltip">
  <div class="pt-3.5 px-5">
    {#if !note}
      <div class="flex items-center gap-2 text-subtle text-sm">
        <Fa icon={faSpinner} class="animate-spin" />
        <span>{m.tiptap_taskNotePreview_loading_label()}</span>
      </div>
    {:else}
      <!-- Content preview -->
      {#if renderedHtml}
        <div class="max-w-full overflow-hidden flex flex-col">
          <div
            class="relative prose prose-sm max-w-none text-xs flex flex-col max-h-[12rem] overflow-hidden
                   **:text-subtle
                   [&_h1]:text-sm [&_h1]:text-foreground [&_h1]:font-semibold [&_h1]:mb-1 [&_h1]:mt-0
                   [&_h2]:text-sm [&_h2]:text-foreground [&_h2]:font-semibold [&_h2]:mb-0.5 [&_h2]:mt-1
                   [&_h3]:text-xs [&_h3]:text-foreground [&_h3]:font-medium [&_h3]:mb-0.5 [&_h3]:mt-1
                   [&_p]:my-0.5 [&_p]:leading-snug
                   [&_ul]:my-0.5 [&_ul]:ml-0
                   [&_ol]:my-0.5 [&_ol]:ml-0
                   [&_li]:my-0
                   [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-foreground
                   [&_pre]:text-xs [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:my-0.5
                   [&_strong]:font-semibold [&_strong]:text-foreground
                   [&_em]:italic
                   [&_a]:text-primary [&_a]:underline
                   overflow-wrap-anywhere"
          >
            {@html renderedHtml}
            <div
              class="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-popover to-transparent pointer-events-none"
            ></div>
          </div>
        </div>
      {:else}
        <div class="text-sm text-subtle italic">{m.tiptap_taskNotePreview_noContent_label()}</div>
      {/if}
    {/if}
  </div>

  <div class="text-subtle text-xs w-full bg-sidebar/50 py-2 px-5">
    {m.tiptap_taskNotePreview_clickToOpen_label()}
    <br />
    {m.tiptap_taskNotePreview_cmdClick_label()}
  </div>
</div>
