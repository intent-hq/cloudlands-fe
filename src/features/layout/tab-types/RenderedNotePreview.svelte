<script lang="ts">
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { selectNoteFontStyle } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  let { content, workspaceId }: { content: string; workspaceId: string } = $props();
  const noteFontStyle = selectNoteFontStyle();
</script>

<section
  class="rendered-note-preview h-full min-h-0 overflow-y-auto"
  class:font-serif={$noteFontStyle === 'serif'}
  class:font-mono={$noteFontStyle === 'monospace'}
  role="document"
  aria-label={m.layout_noteTab_renderedPreview_ariaLabel()}
  data-testid="rendered-note-preview"
>
  <div class="mx-auto w-full max-w-4xl px-6 pb-32 pt-6">
    <MarkdownViewer {content} {workspaceId} taskBlockRenderMode="content" renderRichFencesAsCode />
  </div>
</section>

<style>
  .font-serif :global(.markdown-viewer) {
    font-family:
      'Source Serif 4 Variable', 'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style',
      'Palatino Linotype', Palatino, Georgia, serif;
    font-size: 1.125rem;
    line-height: 1.48;
  }

  .font-mono :global(.markdown-viewer) {
    font-family: var(--font-mono);
  }
</style>
