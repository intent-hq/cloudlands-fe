<script lang="ts">
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { selectNoteFontStyle } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { onMount, untrack } from 'svelte';

  interface Props {
    content: string;
    workspaceId: string;
    noteId: string;
    scrollKey: string;
    initialScrollPosition?: number;
    onScrollPositionSave?: (scrollKey: string, scrollTop: number) => void;
  }

  let {
    content,
    workspaceId,
    noteId,
    scrollKey,
    initialScrollPosition,
    onScrollPositionSave,
  }: Props = $props();
  const noteFontStyle = selectNoteFontStyle();

  let scrollContainer: HTMLElement | null = null;
  let renderedContent: HTMLElement | null = null;
  let pendingScrollPosition: number | null = null;
  let restoreFrame: number | null = null;
  let acceptsInitialScrollPosition = true;
  let programmaticScrollPosition: number | null = null;

  function currentScrollPosition(): number {
    return pendingScrollPosition ?? scrollContainer?.scrollTop ?? 0;
  }

  function tryRestoreScrollPosition() {
    restoreFrame = null;
    if (!scrollContainer || pendingScrollPosition === null) return;

    const maximumScrollPosition = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight,
    );
    if (maximumScrollPosition < pendingScrollPosition) return;

    programmaticScrollPosition = pendingScrollPosition;
    scrollContainer.scrollTop = pendingScrollPosition;
    if (Math.abs(scrollContainer.scrollTop - pendingScrollPosition) < 1) {
      pendingScrollPosition = null;
      acceptsInitialScrollPosition = false;
    }
  }

  function cancelScrollRestoration() {
    if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
    restoreFrame = null;
  }

  function scheduleScrollRestoration(scrollPosition?: number) {
    if (typeof scrollPosition === 'number' && scrollPosition > 0) {
      pendingScrollPosition = scrollPosition;
    }
    if (pendingScrollPosition === null || restoreFrame !== null) return;
    restoreFrame = requestAnimationFrame(tryRestoreScrollPosition);
  }

  function handleScroll() {
    if (
      scrollContainer &&
      programmaticScrollPosition !== null &&
      Math.abs(scrollContainer.scrollTop - programmaticScrollPosition) < 1
    ) {
      programmaticScrollPosition = null;
      return;
    }
    programmaticScrollPosition = null;
    acceptsInitialScrollPosition = false;
    pendingScrollPosition = null;
  }

  $effect(() => {
    const activeIdentity = { workspaceId, noteId, scrollKey };
    const saveScrollPosition = untrack(() => onScrollPositionSave);

    untrack(() => {
      cancelScrollRestoration();
      pendingScrollPosition = null;
      acceptsInitialScrollPosition = true;
      if (scrollContainer) {
        programmaticScrollPosition = 0;
        scrollContainer.scrollTop = 0;
      }
    });

    return () => {
      cancelScrollRestoration();
      saveScrollPosition?.(activeIdentity.scrollKey, currentScrollPosition());
    };
  });

  $effect(() => {
    const scrollPosition = initialScrollPosition;
    if (!scrollKey || !acceptsInitialScrollPosition) return;
    if (typeof scrollPosition !== 'number' || scrollPosition <= 0) return;
    scheduleScrollRestoration(scrollPosition);
  });

  onMount(() => {
    const handleSaveScrollPosition = (
      event: CustomEvent<{ callback: (scrollTop: number) => void }>,
    ) => event.detail.callback(currentScrollPosition());
    const handleRestoreScrollPosition = (
      event: CustomEvent<{ scrollPosition: number; noteId?: string }>,
    ) => {
      if (event.detail.noteId && event.detail.noteId !== noteId) return;
      acceptsInitialScrollPosition = false;
      if (event.detail.scrollPosition <= 0) {
        cancelScrollRestoration();
        pendingScrollPosition = null;
        if (scrollContainer) {
          programmaticScrollPosition = 0;
          scrollContainer.scrollTop = 0;
        }
        return;
      }
      scheduleScrollRestoration(event.detail.scrollPosition);
    };

    window.addEventListener('note:save-scroll-position', handleSaveScrollPosition as EventListener);
    window.addEventListener(
      'note:restore-scroll-position',
      handleRestoreScrollPosition as EventListener,
    );

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => scheduleScrollRestoration());
    if (renderedContent) resizeObserver?.observe(renderedContent);

    return () => {
      window.removeEventListener(
        'note:save-scroll-position',
        handleSaveScrollPosition as EventListener,
      );
      window.removeEventListener(
        'note:restore-scroll-position',
        handleRestoreScrollPosition as EventListener,
      );
      resizeObserver?.disconnect();
      cancelScrollRestoration();
    };
  });
</script>

<section
  class="rendered-note-preview h-full min-h-0 overflow-y-auto"
  class:font-serif={$noteFontStyle === 'serif'}
  class:font-mono={$noteFontStyle === 'monospace'}
  role="document"
  aria-label={m.layout_noteTab_renderedPreview_ariaLabel()}
  data-testid="rendered-note-preview"
  bind:this={scrollContainer}
  onscroll={handleScroll}
>
  <div class="mx-auto w-full max-w-4xl px-6 pb-32 pt-6" bind:this={renderedContent}>
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
    font-family: var(--font-code);
  }
</style>
