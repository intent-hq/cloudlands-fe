<script lang="ts">
  import './markdown-math.css';
  import { folderSidebarTarget, readMentionChip } from '$lib/services/mentions/chip';
  import { locateItemInSidebarRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { canLoadMediaUrl, filterFileMedia } from '$lib/utils/media-provenance';
  import { classifyMarkdownContent } from '$lib/utils/markdown-content-complexity';
  import { getAllContexts, onDestroy } from 'svelte';
  import { logger } from '$lib/utils/client-logger';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  import { handleLink } from '$features/navigation/link-handler';
  import { noteUrl } from '$shared/constants/intent-links';
  import { relabelNoteChipsInHtml } from '$lib/utils/note-mention-label';
  import { storeNoteTitleLookup } from '$lib/utils/store-note-title-lookup';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import MarkdownMediaPreview from './MarkdownMediaPreview.svelte';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';
  import ChatVideoBlock from '$lib/components/chat/ChatVideoBlock.svelte';
  import { splitWorkspaceVideoMarkdown } from '$lib/utils/workspace-file-video';
  import RecursiveMarkdownViewer from './MarkdownViewer.svelte';
  import { supportsImageActions } from '$lib/utils/image-actions';
  import {
    imageActionsHaveFocus,
    imageActionsPosition,
    imageAtTarget,
    isActionableImage,
  } from './markdown-image-dom';
  import { createWorkspaceFileVersion } from '$lib/utils/workspace-file-image';
  import { stampMarkdownImageDimensions } from '$lib/utils/markdown-image-dimensions';
  import type { TextBlockMedia } from '$shared/types/content-block';
  import { markdownDiagrams } from './markdown-diagrams';
  import { markdownMediaFallbacks } from './markdown-media-fallbacks';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { CHIEF_WORKSPACE_ID, WorkspaceId } from '$shared/types/branded-ids';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  interface Props {
    content: string;
    isStreaming?: boolean;
    className?: string;
    workspaceId?: string;
    relativeMediaBase?: string; // File viewer: workspace dir that relative images resolve from.
    onCodeBlockAction?: (action: string, code: string, language?: string) => void;
    /** File-only policy; external web and note links remain usable. */
    canOpenFile?: () => boolean;
    /** Reactive authority for automatically loaded file media. */
    allowFileMedia?: boolean;
    onFileClick?: (
      path: string,
      options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) => void;
    taskBlockRenderMode?: 'placeholder' | 'content';
    /** Chat transcript only: cap images at half the viewport and thumbnail unsized workspace files. */
    chatImageThumbnails?: boolean;
    /** Open all http(s) links directly in the external browser (e.g. release notes). */
    forceExternalLinks?: boolean;
    /** Show rich fenced blocks as source when no TipTap node views are mounted. */
    renderRichFencesAsCode?: boolean;
    /** Mount read-only diagrams while keeping other rich fences as visible source. */
    renderDiagrams?: boolean;
    /** GitHub-style embedded HTML, still sanitized before rendering. */
    allowSanitizedHtml?: boolean;
    /** PROTOCOL §7.1 dimensions keyed by Markdown src; reserve image space while loading. */
    media?: TextBlockMedia;
  }
  let {
    content,
    isStreaming = false,
    className = '',
    workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined,
    relativeMediaBase,
    onCodeBlockAction: _onCodeBlockAction,
    onFileClick,
    canOpenFile,
    allowFileMedia = true,
    taskBlockRenderMode = 'placeholder',
    chatImageThumbnails = false,
    forceExternalLinks = false,
    renderRichFencesAsCode = false,
    renderDiagrams = false,
    allowSanitizedHtml = false,
    media,
  }: Props = $props();

  const workspaceFileVersion = createWorkspaceFileVersion();
  const diagramContext = getAllContexts();

  const mediaSegments = $derived(splitWorkspaceVideoMarkdown(content, workspaceId));
  const hasVideoSegments = $derived(mediaSegments.some((segment) => segment.type === 'video'));
  const markdownContent = $derived(
    !hasVideoSegments && mediaSegments.length === 1 && mediaSegments[0].type === 'markdown'
      ? mediaSegments[0].content
      : content,
  );

  const contentComplexity = $derived(classifyMarkdownContent(markdownContent));

  let staticContentElement: HTMLElement | null = $state(null);
  let processedContent = $state('');
  function canUseMedia(url: string) {
    return canLoadMediaUrl(url, allowFileMedia && canOpenFile?.() !== false);
  }
  // Recheck live authority on publication as well as reactive placement changes.
  // Filtering happens in an inert template, before any media enters the live DOM.
  const renderedContent = $derived(
    filterFileMedia(processedContent, allowFileMedia && canOpenFile?.() !== false),
  );
  // Note chips show the note's current title at render time; an unchanged
  // label keeps the same string, so {@html} does not re-render.
  const labeledContent = $derived(
    relabelNoteChipsInHtml(renderedContent, workspaceId, storeNoteTitleLookup),
  );
  // Keep a stable root while media fallbacks replace child nodes.
  const contentHtml = $derived(`<div class="markdown-content">${labeledContent}</div>`);
  // Ignore obsolete worker results, including after streaming ends or unmount.
  let renderVersion = 0;
  const STREAMING_THROTTLE_MS = 150;
  let lastUpdateTime = -Infinity;
  let pendingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingUpdate: (() => void) | null = null;

  async function updateContent(
    markdown: string,
    options: Parameters<typeof processMarkdownToHTML>[1],
    imageMedia: TextBlockMedia | undefined,
    version: number,
  ) {
    try {
      const html = await processMarkdownToHTML(markdown, { ...options, readOnly: true });
      if (version !== renderVersion) return;
      // Svelte owns the HTML and overlay anchors; never replace its container manually.
      processedContent = stampMarkdownImageDimensions(
        html,
        imageMedia,
        options?.workspaceId,
        options?.relativeMediaBase,
      );
    } catch (error) {
      if (version !== renderVersion) return;
      logger.error('Failed to process markdown:', error);
      // Escape HTML for safety — processedContent is injected with {@html}.
      const escaped = markdown.replace(
        /[&<>"']/g,
        (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m,
      );
      processedContent = `<p>${escaped}</p>`;
    }
  }

  function flushStreamingUpdate() {
    if (!pendingUpdate) return;
    const remaining = STREAMING_THROTTLE_MS - (performance.now() - lastUpdateTime);
    if (remaining > 0) {
      pendingUpdateTimer = setTimeout(() => {
        pendingUpdateTimer = null;
        flushStreamingUpdate();
      }, remaining);
      return;
    }
    const update = pendingUpdate;
    pendingUpdate = null;
    lastUpdateTime = performance.now();
    update();
  }

  function cancelPendingUpdates() {
    if (pendingUpdateTimer !== null) {
      clearTimeout(pendingUpdateTimer);
      pendingUpdateTimer = null;
    }
    pendingUpdate = null;
    lastUpdateTime = -Infinity;
  }

  $effect(() => {
    // Capture dependencies before yielding; new input invalidates in-flight work.
    const markdown = markdownContent;
    const options = {
      allowEmpty: true,
      skipIfHTML: false,
      preserveAnchors: true,
      taskBlockRenderMode,
      workspaceId,
      relativeMediaBase:
        relativeMediaBase ?? (workspaceId && workspaceId !== CHIEF_WORKSPACE_ID ? '' : undefined),
      renderRichFencesAsCode: renderRichFencesAsCode || renderDiagrams,
      processPrimitives: !renderDiagrams,
      allowSanitizedHtml,
      renderMath: !isStreaming,
      workspaceFileVersion,
    };
    const imageMedia = media;
    const version = ++renderVersion;
    const update = () => void updateContent(markdown, options, imageMedia, version);

    if (isStreaming) {
      pendingUpdate = update;
      if (pendingUpdateTimer === null) flushStreamingUpdate();
    } else {
      cancelPendingUpdates();
      update();
    }
  });

  let mediaPreview: MarkdownMediaPreview | undefined = $state();

  // One shared actions trigger follows the hovered/focused image in {@html} DOM.
  let hoveredImage = $state<HTMLImageElement | null>(null);
  let hoveredImagePosition = $state({ top: 0, right: 0 });
  let imageActionsOpen = $state(false);
  let imageActionsMenu: ImageActionsMenu | undefined = $state();
  let imageActionsOverlayElement = $state<HTMLElement | null>(null);

  function handleImageInteraction(event: MouseEvent | FocusEvent): void {
    // Pointer movement must not replace the keyboard-focused image's actions.
    if (
      event.type === 'mouseover' &&
      imageActionsHaveFocus(hoveredImage, imageActionsOverlayElement)
    )
      return;
    const target = event.target;
    const image = imageAtTarget(target);
    if (image && isActionableImage(image) && canUseMedia(image.getAttribute('src') || '')) {
      if (hoveredImage === image) return;
      hoveredImage = image;
      hoveredImagePosition = imageActionsPosition(image, event.currentTarget as HTMLElement);
    } else if (hoveredImage && !imageActionsOpen) {
      // Keep the overlay while the pointer is on the trigger itself.
      if (target instanceof Node && imageActionsOverlayElement?.contains(target)) return;
      hoveredImage = null;
    }
  }

  function handleImageHoverLeave(): void {
    if (!imageActionsOpen && !imageActionsHaveFocus(hoveredImage, imageActionsOverlayElement)) {
      hoveredImage = null;
    }
  }

  function handleImageContextMenu(event: MouseEvent): void {
    const image = imageAtTarget(event.target);
    if (!image || !isActionableImage(image) || !canUseMedia(image.getAttribute('src') || ''))
      return;
    event.preventDefault();
    event.stopPropagation();
    handleImageInteraction(event);
    imageActionsOpen = true;
  }

  function mediaFallbacks(node: HTMLElement) {
    return markdownMediaFallbacks(node, {
      getWorkspaceId: () => workspaceId,
      canUseMedia,
      onMediaRemoved: (media) => {
        if (hoveredImage === media) hoveredImage = null;
      },
    });
  }

  // PERF: Single reusable link click handler - shared between streaming and static content
  // Route anchor clicks through the unified link handler.
  function handleLinkClick(event: MouseEvent | KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    // Supported inline images open in the lightbox unless wrapped in a link (the link wins).
    if (!anchor && target instanceof HTMLImageElement) {
      const src = target.getAttribute('src') || '';
      if (supportsImageActions(src) && canUseMedia(src)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        mediaPreview?.openImage(target);
        return;
      }
    }

    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (mediaPreview?.openAsset(anchor)) return;

      const sourcePanelId = getSourcePanelId(event);
      const owningWorkspaceId = workspaceId ? WorkspaceId(workspaceId) : undefined;

      handleLink(anchor.href, {
        workspaceId: owningWorkspaceId,
        canOpenFile,
        sourcePanelId,
        event,
        rawHref: anchor.getAttribute('href') ?? undefined,
        ...(forceExternalLinks ? { forceExternal: true } : {}),
      });
      return;
    }

    // Handle mention chip clicks (file mentions in chat)
    const chip = readMentionChip(target.closest('[data-mention]'));
    if (chip) {
      const { type, meta } = chip;

      if (type === 'file' && chip.filePath) {
        if (canOpenFile?.() === false) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const filePath = chip.filePath;
        logger.debug('[MarkdownViewer] File mention clicked', { filePath, meta });

        // Get source panel ID for same-panel navigation
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });

        // Use onFileClick callback if provided, otherwise use direct navigation
        if (onFileClick) {
          onFileClick(filePath, { line: chip.line, openInAdjacentPanel, sourcePanelId });
        } else {
          const wsId = workspaceId;
          if (wsId) {
            appStore.dispatch(
              openWorkspaceFile(wsId, filePath, {
                line: chip.line,
                openInAdjacentPanel,
                sourcePanelId,
              }),
            );
          }
        }
      } else if (chip.folderPath !== undefined) {
        if (canOpenFile?.() === false || !workspaceId) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        appStore.dispatch(
          locateItemInSidebarRequested(workspaceId, folderSidebarTarget(chip.folderPath)),
        );
      } else if (type === 'note' && chip.note) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const noteId = chip.note.id;
        logger.debug('[MarkdownViewer] Note mention clicked', { noteId, meta });

        // Get source panel ID for same-panel navigation
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });

        // Cross-workspace note chips carry their workspace in meta.
        if (chip.note.workspaceId && chip.note.workspaceId !== workspaceId) {
          handleLink(noteUrl(noteId, chip.note.workspaceId), {
            workspaceId: workspaceId ? WorkspaceId(workspaceId) : undefined,
            sourcePanelId,
            event,
          });
          return;
        }

        const wsIdNote = workspaceId;
        if (wsIdNote) {
          appStore.dispatch(
            openWorkspaceNote(wsIdNote, noteId, {
              openInAdjacentPanel,
              sourcePanelId,
            }),
          );
        }
      }
    }
  }

  function handleLinkKeydown(event: KeyboardEvent): void {
    handleImageCopy(event);
    if (event.defaultPrevented) return;
    if (
      event.target instanceof HTMLImageElement &&
      isActionableImage(event.target) &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      handleLinkClick(event);
      return;
    }
    if (event.key !== 'Enter' || !isCmdClickModifier({ event })) return;
    handleLinkClick(event);
  }

  function handleImageCopy(event: KeyboardEvent | ClipboardEvent): void {
    const image = imageAtTarget(event.target);
    if (!image || !isActionableImage(image) || !canUseMedia(image.getAttribute('src') || ''))
      return;
    imageActionsMenu?.handleCopy(event, image.getAttribute('src') || '');
  }

  function getSourcePanelId(event: MouseEvent | KeyboardEvent): string | undefined {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return undefined;
    return target.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId;
  }

  onDestroy(() => {
    renderVersion += 1;
    cancelPendingUpdates();
  });
</script>

<!-- Streaming/static Markdown use processed HTML; simple text bypasses processing. -->
{#snippet imageActionsOverlay()}
  {#if hoveredImage && canUseMedia(hoveredImage.getAttribute('src') || '')}
    <div
      bind:this={imageActionsOverlayElement}
      class="image-actions-overlay absolute z-10"
      style="top: {hoveredImagePosition.top}px; right: {hoveredImagePosition.right}px;"
      data-testid="markdown-image-actions-overlay"
    >
      <ImageActionsMenu
        bind:this={imageActionsMenu}
        imageUrl={hoveredImage.getAttribute('src') || ''}
        imageName={hoveredImage.getAttribute('alt') || undefined}
        bind:open={imageActionsOpen}
      />
    </div>
  {/if}
{/snippet}

{#if hasVideoSegments}
  <div class="markdown-video-segments {className}">
    {#each mediaSegments as segment}
      {#if segment.type === 'video'}
        <ChatVideoBlock
          {allowFileMedia}
          {canOpenFile}
          source={segment.source}
          name={segment.name}
          poster={segment.poster}
        />
      {:else}
        <RecursiveMarkdownViewer
          content={segment.content}
          {isStreaming}
          {workspaceId}
          {relativeMediaBase}
          onCodeBlockAction={_onCodeBlockAction}
          {onFileClick}
          {canOpenFile}
          {allowFileMedia}
          {taskBlockRenderMode}
          {chatImageThumbnails}
          {forceExternalLinks}
          {renderRichFencesAsCode}
          {renderDiagrams}
          {allowSanitizedHtml}
          {media}
        />
      {/if}
    {/each}
  </div>
{:else if isStreaming}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    class="markdown-viewer streaming-content {className}"
    class:chat-image-thumbnails={chatImageThumbnails}
    use:mediaFallbacks
    use:markdownDiagrams={{ enabled: renderDiagrams, workspaceId, context: diagramContext }}
    onclick={handleLinkClick}
    onkeydown={handleLinkKeydown}
    oncopy={handleImageCopy}
    oncontextmenu={handleImageContextMenu}
    onmouseover={handleImageInteraction}
    onfocusin={handleImageInteraction}
    onmouseleave={handleImageHoverLeave}
  >
    {@html contentHtml}
    {@render imageActionsOverlay()}
  </div>
{:else if contentComplexity === 'simple' && !allowSanitizedHtml}
  <div class="markdown-viewer simple-content {className}">
    <p class="whitespace-pre-wrap">{markdownContent}</p>
  </div>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    class="markdown-viewer static-content {className}"
    class:chat-image-thumbnails={chatImageThumbnails}
    bind:this={staticContentElement}
    use:mediaFallbacks
    use:markdownDiagrams={{ enabled: renderDiagrams, workspaceId, context: diagramContext }}
    onclick={handleLinkClick}
    onkeydown={handleLinkKeydown}
    oncopy={handleImageCopy}
    oncontextmenu={handleImageContextMenu}
    onmouseover={handleImageInteraction}
    onfocusin={handleImageInteraction}
    onmouseleave={handleImageHoverLeave}
  >
    {@html contentHtml}
    {@render imageActionsOverlay()}
  </div>
{/if}

<MarkdownMediaPreview bind:this={mediaPreview} {workspaceId} {canUseMedia} />

<style>
  .markdown-viewer {
    position: relative;
    width: 100%;
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
    font-weight: var(--text-body-weight);
    letter-spacing: var(--text-body-tracking);
    color: hsl(var(--foreground));
  }

  /* Isolate layout and style work for each Markdown surface. */
  .streaming-content,
  .simple-content,
  .static-content {
    contain: layout style;
  }

  .simple-content p {
    margin: 0;
  }

  .markdown-viewer :global(.markdown-content > * + *) {
    margin-top: 0.75rem;
  }

  /* Typography */
  .markdown-viewer :global(p) {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    text-wrap: pretty;
  }

  .markdown-viewer :global(.markdown-video) {
    display: block;
    width: 100%;
    max-width: 42rem;
    aspect-ratio: 16 / 9;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    background: black;
    object-fit: contain;
  }

  .markdown-viewer.chat-image-thumbnails :global(.markdown-video) {
    cursor: pointer;
  }

  .markdown-viewer :global(strong) {
    font-weight: var(--text-body-strong-weight);
  }

  .markdown-viewer :global(h1),
  .markdown-viewer :global(h2),
  .markdown-viewer :global(h3),
  .markdown-viewer :global(h4),
  .markdown-viewer :global(h5),
  .markdown-viewer :global(h6) {
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    color: hsl(var(--foreground));
    font-weight: var(--text-title-weight);
    text-wrap: balance;
  }

  .markdown-viewer :global(h1) {
    font-size: var(--text-display-size);
    line-height: var(--text-display-line-height);
    letter-spacing: var(--text-display-tracking);
  }

  .markdown-viewer :global(h2) {
    font-size: var(--text-title-size);
    line-height: var(--text-title-line-height);
    letter-spacing: var(--text-title-tracking);
  }

  .markdown-viewer :global(h3),
  .markdown-viewer :global(h4),
  .markdown-viewer :global(h5),
  .markdown-viewer :global(h6) {
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
    letter-spacing: var(--text-body-tracking);
  }

  .markdown-viewer :global(h1:first-child),
  .markdown-viewer :global(h2:first-child),
  .markdown-viewer :global(h3:first-child),
  .markdown-viewer :global(h4:first-child),
  .markdown-viewer :global(h5:first-child),
  .markdown-viewer :global(h6:first-child) {
    margin-top: 0;
  }

  /* Lists */
  .markdown-viewer :global(ul),
  .markdown-viewer :global(ol) {
    padding-left: 1.5rem;
    margin: 0.5rem 0;
  }

  .markdown-viewer :global(ul) {
    list-style: disc;
  }
  .markdown-viewer :global(ol) {
    list-style: decimal;
  }

  .markdown-viewer :global(li) {
    margin: 0.25rem 0;
  }

  /* Task lists */
  .markdown-viewer :global(.task-list) {
    list-style: none;
    padding-left: 0;
  }

  .markdown-viewer :global(.task-item) {
    display: flex;
    align-items: flex-start;
    padding: 0.125rem 0;
  }

  .markdown-viewer :global(.task-item input[type='checkbox']) {
    appearance: none;
    width: 1.125rem;
    height: 1.125rem;
    margin-right: 0.5rem;
    margin-top: 0.125rem;
    border: none;
    border-radius: 0.3125rem;
    background: hsl(var(--muted));
    cursor: default;
    pointer-events: none; /* Read-only */
    position: relative;
    flex-shrink: 0;
  }

  .markdown-viewer :global(.task-item input[type='checkbox']:checked) {
    background: hsl(var(--foreground));
  }

  .markdown-viewer :global(.task-item input[type='checkbox']:checked::after) {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0.3rem;
    height: 0.5rem;
    border: solid hsl(var(--background));
    border-width: 0 2px 2px 0;
    transform: translate(-45%, -60%) rotate(45deg);
  }

  /* Code */
  .markdown-viewer :global(code:not(.code-block code)) {
    background: hsl(var(--muted) / 0.4);
    color: hsl(var(--muted-foreground));
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.9em;
    font-family: var(--font-code);
  }

  /* Code blocks */
  .markdown-viewer :global(.code-block) {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 1rem;
    overflow-x: auto;
    font-family: var(--font-code);
    font-size: var(--text-code-size);
    line-height: var(--text-code-line-height);
    letter-spacing: var(--text-code-tracking);
    position: relative;
  }

  .markdown-viewer :global(.code-block code) {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
  }

  /* Syntax highlighting - Dark mode (default) */
  .markdown-viewer :global(.hljs-comment),
  .markdown-viewer :global(.hljs-quote) {
    color: #6b7280 !important;
    font-style: italic;
  }

  .markdown-viewer :global(.hljs-keyword),
  .markdown-viewer :global(.hljs-selector-tag),
  .markdown-viewer :global(.hljs-subst) {
    color: #c084fc !important;
  }

  .markdown-viewer :global(.hljs-number),
  .markdown-viewer :global(.hljs-literal),
  .markdown-viewer :global(.hljs-variable),
  .markdown-viewer :global(.hljs-template-variable),
  .markdown-viewer :global(.hljs-tag .hljs-attr) {
    color: #fbbf24 !important;
  }

  .markdown-viewer :global(.hljs-string),
  .markdown-viewer :global(.hljs-doctag) {
    color: #86efac !important;
  }

  .markdown-viewer :global(.hljs-title),
  .markdown-viewer :global(.hljs-section),
  .markdown-viewer :global(.hljs-selector-id) {
    color: #60a5fa !important;
    font-weight: bold;
  }

  /* Light mode syntax highlighting */
  :global(.light) .markdown-viewer :global(.hljs-comment),
  :global(.light) .markdown-viewer :global(.hljs-quote) {
    color: #374151 !important;
    font-style: italic;
  }

  :global(.light) .markdown-viewer :global(.hljs-keyword),
  :global(.light) .markdown-viewer :global(.hljs-selector-tag),
  :global(.light) .markdown-viewer :global(.hljs-subst) {
    color: #5b21b6 !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-number),
  :global(.light) .markdown-viewer :global(.hljs-literal),
  :global(.light) .markdown-viewer :global(.hljs-variable),
  :global(.light) .markdown-viewer :global(.hljs-template-variable),
  :global(.light) .markdown-viewer :global(.hljs-tag .hljs-attr) {
    color: #92400e !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-string),
  :global(.light) .markdown-viewer :global(.hljs-doctag) {
    color: #047857 !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-title),
  :global(.light) .markdown-viewer :global(.hljs-section),
  :global(.light) .markdown-viewer :global(.hljs-selector-id) {
    color: #1e40af !important;
    font-weight: bold;
  }

  /* Additional token types for completeness */
  .markdown-viewer :global(.hljs-attr),
  .markdown-viewer :global(.hljs-attribute) {
    color: #c084fc !important;
  }

  .markdown-viewer :global(.hljs-built_in) {
    color: #60a5fa !important;
  }

  .markdown-viewer :global(.hljs-class) {
    color: #fde047 !important;
  }

  .markdown-viewer :global(.hljs-function) {
    color: #60a5fa !important;
  }

  .markdown-viewer :global(.hljs-params) {
    color: #fca5a5 !important;
  }

  .markdown-viewer :global(.hljs-type) {
    color: #60a5fa !important;
  }

  .markdown-viewer :global(.hljs-meta) {
    color: #6b7280 !important;
  }

  .markdown-viewer :global(.hljs-symbol),
  .markdown-viewer :global(.hljs-bullet) {
    color: #fbbf24 !important;
  }

  /* Light mode additional tokens */
  :global(.light) .markdown-viewer :global(.hljs-attr),
  :global(.light) .markdown-viewer :global(.hljs-attribute) {
    color: #5b21b6 !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-built_in) {
    color: #1e40af !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-class) {
    color: #92400e !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-function) {
    color: #1e40af !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-params) {
    color: #b91c1c !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-type) {
    color: #1e40af !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-meta) {
    color: #374151 !important;
  }

  :global(.light) .markdown-viewer :global(.hljs-symbol),
  :global(.light) .markdown-viewer :global(.hljs-bullet) {
    color: #92400e !important;
  }

  /* Links */
  .markdown-viewer :global(a) {
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .markdown-viewer :global(.markdown-link) {
    color: hsl(var(--primary-ink));
  }

  .markdown-viewer :global(a:hover),
  .markdown-viewer :global(a:focus-visible) {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }

  .markdown-viewer :global(.markdown-link:hover) {
    opacity: 0.8;
  }

  /* Keep sentence punctuation visually attached to inline intent-link pills. */
  .markdown-viewer :global(.mention-chip) {
    margin-inline: 0;
    padding-inline: 0.25rem;
  }

  /* Blockquotes */
  .markdown-viewer :global(blockquote) {
    border-left: 1px solid hsl(var(--border));
    padding-left: 1rem;
    margin: 0.75rem 0;
    color: hsl(var(--muted-foreground));
    font-style: normal;
  }

  /* Tables */
  .markdown-viewer :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    overflow: auto;
    display: block;
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }

  .markdown-viewer :global(th),
  .markdown-viewer :global(td) {
    border: 1px solid hsl(var(--border));
    padding: 0.5rem;
    text-align: left;
    word-break: auto-phrase;
    white-space: normal;
  }

  .markdown-viewer :global(th) {
    background: hsl(var(--muted) / 0.3);
    font-weight: var(--text-body-strong-weight);
  }

  .markdown-viewer :global(tr:hover) {
    background: hsl(var(--muted));
  }

  /* Horizontal rule */
  .markdown-viewer :global(hr) {
    border: none;
    border-top: 1px solid hsl(var(--border));
    margin: 1.5rem 0;
  }

  /* Images */
  .markdown-viewer :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
  }

  /* Only unlinked, supported images open in the lightbox. */
  .markdown-viewer :global(img[role='button']) {
    cursor: zoom-in;
  }

  .markdown-viewer.chat-image-thumbnails :global(img) {
    max-height: 50vh;
    object-fit: contain;
  }

  .markdown-viewer.chat-image-thumbnails :global(.markdown-image-frame) {
    max-width: min(100%, calc(50vh * var(--image-aspect-ratio)));
  }

  /* Chat transcript: inline workspace file images render as fixed square
     bordered thumbnails (cropped), matching ChatImageBlock. Images sized from
     the text block's media sidecar keep their own frame instead. */
  .markdown-viewer.chat-image-thumbnails
    :global(img[src^='workspace-file://']:not([data-image-sized])) {
    width: min(10rem, 50vh);
    height: min(10rem, 50vh);
    object-fit: cover;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
  }

  /* Reserved box for images with daemon-probed dimensions: the frame takes
     the final layout size (aspect-ratio + width set inline from width/height
     attrs) before any bytes arrive, showing a bordered icon + path placeholder
     until the image loads. */
  .markdown-viewer :global(.markdown-image-frame) {
    position: relative;
    display: block;
    max-width: 100%;
    overflow: hidden;
    border-radius: 0.5rem;
  }

  .markdown-viewer :global(.markdown-image-frame > img) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    object-fit: contain;
    border-radius: 0;
  }

  .markdown-viewer :global(.markdown-image-frame[data-loaded='false'] > img) {
    opacity: 0;
  }

  .markdown-viewer :global(.markdown-image-frame-placeholder) {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
  }

  /* Task Block - Skeleton loader styled like final checkbox state */
  .markdown-viewer :global(.task-block-pending) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
    padding: 0.25rem 0;
  }

  .markdown-viewer :global(.task-block-checkbox) {
    width: 1rem;
    height: 1rem;
    border-radius: 0.25rem;
    border: 2px solid hsl(var(--muted-foreground));
    opacity: 0.3;
    cursor: default;
    flex-shrink: 0;
  }

  .markdown-viewer :global(.task-block-title-skeleton) {
    height: 1rem;
    width: 60%;
    max-width: 200px;
    background: linear-gradient(
      90deg,
      hsl(var(--muted-foreground)) 25%,
      transparent 50%,
      hsl(var(--muted-foreground)) 75%
    );
    background-size: 200% 100%;
    opacity: 0.15;
    border-radius: 0.25rem;
    animation: task-skeleton-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes task-skeleton-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }

  /*
   * NOTE: Removed streaming animation that was causing flickering.
   * The animation was re-triggering on every content update during streaming,
   * causing the text to flash/flicker repeatedly.
   */

  /* Dark mode adjustments (uses .dark class on html element) */
  :global(.dark) .markdown-viewer :global(code:not(.code-block code)) {
    background: rgba(255, 255, 255, 0.04);
  }

  :global(.dark) .markdown-viewer :global(.code-block) {
    background: rgba(0, 0, 0, 0.3);
    border-color: rgba(255, 255, 255, 0.04);
  }

  /* Monospace mode: Headings same size as body text (mimics monospace notes) */
  :global(.agent-font-monospace) .markdown-viewer :global(h1),
  :global(.agent-font-monospace) .markdown-viewer :global(h2),
  :global(.agent-font-monospace) .markdown-viewer :global(h3),
  :global(.agent-font-monospace) .markdown-viewer :global(h4),
  :global(.agent-font-monospace) .markdown-viewer :global(h5),
  :global(.agent-font-monospace) .markdown-viewer :global(h6) {
    font-size: 0.92rem;
    font-weight: 500;
    margin: 1em 0 0 0;
    color: hsl(var(--muted-foreground) / 0.6);
    letter-spacing: normal;
  }

  /* Monospace mode: First heading has no top margin */
  :global(.agent-font-monospace) .markdown-viewer :global(h1:first-child),
  :global(.agent-font-monospace) .markdown-viewer :global(h2:first-child),
  :global(.agent-font-monospace) .markdown-viewer :global(h3:first-child),
  :global(.agent-font-monospace) .markdown-viewer :global(h4:first-child),
  :global(.agent-font-monospace) .markdown-viewer :global(h5:first-child),
  :global(.agent-font-monospace) .markdown-viewer :global(h6:first-child) {
    margin-top: 0;
  }

  /* Monospace mode: Lists with tighter spacing */
  :global(.agent-font-monospace) .markdown-viewer :global(ul),
  :global(.agent-font-monospace) .markdown-viewer :global(ol) {
    margin: 0;
    padding: 0;
    margin-block: 0;
  }

  :global(.agent-font-monospace) .markdown-viewer :global(li) {
    margin: 0;
    padding: 0;
    margin-block: 0;
    margin-left: 1rem;
  }

  /* Monospace mode: Inline code same size as body, minimal styling */
  :global(.agent-font-monospace) .markdown-viewer :global(code:not(.code-block code)) {
    font-size: 0.92rem;
    font-family: inherit;
    background: transparent;
    padding: 0;
    border-radius: 0;
    color: hsl(var(--accent-foreground));
  }
</style>
