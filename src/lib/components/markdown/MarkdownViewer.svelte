<script lang="ts">
  /* eslint-disable max-lines */
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import { Table } from '@tiptap/extension-table';
  import { TableRow } from '@tiptap/extension-table-row';
  import { TableHeader } from '@tiptap/extension-table-header';
  import { TableCell } from '@tiptap/extension-table-cell';
  import Image from '@tiptap/extension-image';
  import { safeLowlight } from '$lib/utils/safe-lowlight';
  import { logger } from '$lib/utils/client-logger';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  import { createIntentLink } from '$lib/utils/tiptap-link-extension';
  import { TasksBlock } from '$lib/components/tiptap/TasksBlock';
  import { handleLink } from '$features/navigation/link-handler';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
  import ImageActionsMenu from '$lib/components/ui/ImageActionsMenu.svelte';

  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';

  // Use shared safe lowlight instance (handles unregistered languages gracefully)
  const lowlight = safeLowlight;

  interface Props {
    content: string;
    isStreaming?: boolean;
    className?: string;
    workspaceId?: string;
    onCodeBlockAction?: (action: string, code: string, language?: string) => void;
    onFileClick?: (
      path: string,
      options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) => void;
    taskBlockRenderMode?: 'placeholder' | 'content';
    /** Chat transcript only: render inline workspace-file images as fixed square thumbnails. */
    chatImageThumbnails?: boolean;
  }

  let {
    content,
    isStreaming = false,
    className = '',
    workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined,

    onCodeBlockAction: _onCodeBlockAction,
    onFileClick,
    taskBlockRenderMode = 'placeholder',
    chatImageThumbnails = false,
  }: Props = $props();

  // PERF: Detect content complexity to choose rendering strategy
  // - Simple: plain text, no markdown - render as <p>
  // - Static: has markdown but can use processed HTML without TipTap
  // - Complex: needs TipTap for interactivity (task lists, etc.)

  // Patterns that REQUIRE TipTap for interactivity
  const needsTipTapPatterns = [
    /^\s*[-*]\s*\[[ x]\]/m, // Task lists - TipTap handles checkbox interaction
  ];

  // Patterns that need markdown processing but not TipTap
  const needsProcessingPatterns = [
    // i18n-ignore (scanner false positive: backticks in regex literal confuse the string tracker)
    /```/, // Code blocks (triple backticks)
    /`[^`]+`/, // Inline code (single backticks)
    /\|.*\|/, // Tables
    /\[.*\]\(.*\)/, // Links
    /!\[.*\]\(.*\)/, // Images
    /<[a-z][\s\S]*>/i, // HTML tags
    /^#{1,6}\s/m, // Headers
    /^\s*>\s/m, // Blockquotes
    /\*\*[^*]+\*\*/, // Bold (double asterisks)
    /\*[^*]+\*/, // Italic (single asterisks)
    /_[^_]+_/, // Italic (underscores)
    /~~[^~]+~~/, // Strikethrough
    /^[-*_]{3,}\s*$/m, // Horizontal rules
    /^\s*[-*+]\s/m, // Unordered lists
    /^\s*\d+\.\s/m, // Ordered lists
    // @-mentions and bare file paths that injectMentionSpans converts to mention chips
    /@note\//, // @note/... mentions
    /@context\[/, // @context[...] mentions
    /@\//, // @/absolute/path mentions
    /@[A-Za-z0-9._-]+\/[^\s]*\.[A-Za-z0-9]+/, // @relative/path/file.ext mentions
    /@[A-Za-z0-9._-]+\.[A-Za-z0-9]+/, // @file.ext mentions
    /@auggie-personality-/, // @auggie-personality-* persona mentions
    /intent:\/\//, // intent:// protocol URLs
    /\b[A-Za-z0-9][A-Za-z0-9._-]+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql)\b/, // bare filenames like file.ext
    /\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql)\b/, // bare paths like dir/file.ext
  ];

  const contentComplexity = $derived.by(() => {
    if (!content) return 'simple';
    // Check if needs TipTap interactivity
    if (needsTipTapPatterns.some((pattern) => pattern.test(content))) {
      return 'complex';
    }
    // Check if needs markdown processing
    if (needsProcessingPatterns.some((pattern) => pattern.test(content))) {
      return 'static';
    }
    return 'simple';
  });

  // Track static content element for click handling
  let staticContentElement: HTMLElement | null = $state(null);

  let editorElement: HTMLElement = $state(null!);
  let editor: Editor | null = null;
  let processedContent = $state('');
  let lastProcessedContent = '';
  // The rendered HTML also depends on workspaceId (short-form intent://local/file/
  // image links resolve against it), so it participates in the memoization guard
  let lastProcessedWorkspaceId: string | undefined;

  // PERF: Track streaming state to avoid expensive TipTap updates during streaming
  let isCurrentlyStreaming = false;
  let streamingContentElement: HTMLElement | null = $state(null);

  // PERF: Create throttled update function once (not per streaming session)
  const STREAMING_THROTTLE_MS = 150; // Slightly higher throttle during streaming for better perf
  let lastUpdateTime = 0;
  let pendingUpdateRafId: number | null = null;
  let pendingContent: string | null = null;

  // Process markdown to HTML (full processing with TipTap)
  async function updateContentFull(markdown: string) {
    // Skip if content hasn't actually changed
    if (markdown === lastProcessedContent && workspaceId === lastProcessedWorkspaceId) {
      return;
    }

    if (!markdown) {
      processedContent = '';
      lastProcessedContent = '';
      lastProcessedWorkspaceId = workspaceId;
      return;
    }

    try {
      const html = await processMarkdownToHTML(markdown, {
        allowEmpty: true,
        skipIfHTML: false,
        preserveAnchors: true,
        taskBlockRenderMode,
        workspaceId,
      });
      processedContent = html;
      lastProcessedContent = markdown;
      lastProcessedWorkspaceId = workspaceId;

      // Update editor content if it exists
      if (editor && !editor.isDestroyed) {
        // Use a transaction to batch updates
        editor.commands.setContent(html, { emitUpdate: false });
        // Note: Scroll management is handled by the parent component via followBottom action
        // Do NOT call scrollIntoView here as it overrides user scroll position
      }
    } catch (error) {
      logger.error('Failed to process markdown:', error);
      // Escape HTML for safety — processedContent is injected with {@html}
      const escaped = markdown.replace(
        /[&<>"']/g,
        (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m,
      );
      processedContent = `<p>${escaped}</p>`;
      lastProcessedContent = markdown;
      lastProcessedWorkspaceId = workspaceId;
    }
  }

  // PERF: Lightweight streaming update - uses innerHTML directly instead of TipTap
  async function updateContentStreaming(markdown: string) {
    // Skip if content hasn't actually changed
    if (markdown === lastProcessedContent && workspaceId === lastProcessedWorkspaceId) {
      return;
    }

    if (!markdown) {
      lastProcessedContent = '';
      lastProcessedWorkspaceId = workspaceId;
      if (streamingContentElement) {
        streamingContentElement.innerHTML = '';
      }
      return;
    }

    try {
      const html = await processMarkdownToHTML(markdown, {
        allowEmpty: true,
        skipIfHTML: false,
        preserveAnchors: true,
        taskBlockRenderMode,
        workspaceId,
      });
      lastProcessedContent = markdown;
      lastProcessedWorkspaceId = workspaceId;
      processedContent = html;

      // PERF: During streaming, update innerHTML directly instead of TipTap's setContent
      // This is much faster as it avoids TipTap's internal diffing and transaction system
      if (streamingContentElement) {
        streamingContentElement.innerHTML = html;
      } else if (editor && !editor.isDestroyed) {
        // Fallback to editor if no streaming element
        editor.commands.setContent(html, { emitUpdate: false });
      }
    } catch (error) {
      logger.error('Failed to process streaming markdown:', error);
      if (streamingContentElement) {
        // Escape HTML for safety
        const escaped = markdown.replace(
          /[&<>"']/g,
          (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m,
        );
        streamingContentElement.innerHTML = `<p>${escaped}</p>`;
      }
      lastProcessedContent = markdown;
      lastProcessedWorkspaceId = workspaceId;
    }
  }

  // PERF: Throttled update with RAF batching
  function scheduleStreamingUpdate(markdown: string) {
    pendingContent = markdown;

    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTime;

    // If enough time has passed, update immediately
    if (timeSinceLastUpdate >= STREAMING_THROTTLE_MS) {
      lastUpdateTime = now;
      updateContentStreaming(markdown);
      pendingContent = null;
    } else if (pendingUpdateRafId === null) {
      // Schedule update for after throttle period
      pendingUpdateRafId = requestAnimationFrame(() => {
        pendingUpdateRafId = null;
        if (pendingContent !== null) {
          lastUpdateTime = performance.now();
          updateContentStreaming(pendingContent);
          pendingContent = null;
        }
      });
    }
    // If RAF is already scheduled, the pending update will be used
  }

  // Cleanup pending updates
  function cancelPendingUpdates() {
    if (pendingUpdateRafId !== null) {
      cancelAnimationFrame(pendingUpdateRafId);
      pendingUpdateRafId = null;
    }
    pendingContent = null;
  }

  // Update content when prop changes
  $effect(() => {
    const wasStreaming = isCurrentlyStreaming;
    isCurrentlyStreaming = isStreaming;

    if (isStreaming) {
      // Use throttled streaming update
      scheduleStreamingUpdate(content);
    } else {
      // Clean up pending updates when streaming ends
      if (wasStreaming) {
        cancelPendingUpdates();
      }
      // Direct update when not streaming
      updateContentFull(content);
    }
  });

  // Lightbox state for inline workspace-file images
  let lightboxOpen = $state(false);
  let lightboxImageUrl = $state('');
  let lightboxImageAlt = $state<string | undefined>(undefined);
  let lightboxOpenerElement = $state<HTMLElement | null>(null);

  // Hover overlay: chat-transcript thumbnails get an image actions menu.
  // The images live in {@html}/TipTap-managed DOM, so a single Svelte-rendered
  // trigger is positioned over whichever thumbnail is hovered.
  let hoveredImage = $state<HTMLImageElement | null>(null);
  let hoveredImagePosition = $state({ top: 0, left: 0 });
  let imageActionsOpen = $state(false);
  let imageActionsOverlayElement = $state<HTMLElement | null>(null);

  function handleImageHover(event: MouseEvent): void {
    if (!chatImageThumbnails) return;
    const target = event.target;
    if (
      target instanceof HTMLImageElement &&
      (target.getAttribute('src') || '').startsWith('workspace-file://')
    ) {
      if (hoveredImage === target) return;
      const container = event.currentTarget as HTMLElement;
      const imageRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      hoveredImage = target;
      hoveredImagePosition = {
        top: imageRect.top - containerRect.top + 6,
        left: imageRect.right - containerRect.left - 34,
      };
    } else if (hoveredImage && !imageActionsOpen) {
      // Keep the overlay while the pointer is on the trigger itself.
      if (target instanceof Node && imageActionsOverlayElement?.contains(target)) return;
      hoveredImage = null;
    }
  }

  function handleImageHoverLeave(): void {
    if (!imageActionsOpen) hoveredImage = null;
  }

  // PERF: Single reusable link click handler - shared between TipTap and static content
  // Routes all link clicks through the unified link handler for consistent behavior:
  // - Click → embedded browser panel (for http/https)
  // - Cmd+Click → external browser
  // - intent:// → internal navigation
  function handleLinkClick(event: MouseEvent | KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    // Inline workspace-file images open in the lightbox (unless wrapped in a
    // link, in which case the link wins)
    if (!anchor && target instanceof HTMLImageElement) {
      const src = target.getAttribute('src') || '';
      if (src.startsWith('workspace-file://')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        lightboxImageUrl = src;
        lightboxImageAlt = target.getAttribute('alt') || undefined;
        lightboxOpenerElement = target;
        lightboxOpen = true;
        return;
      }
    }

    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const sourcePanelId = getSourcePanelId(event);
      const owningWorkspaceId = workspaceId ? WorkspaceId(workspaceId) : undefined;

      handleLink(anchor.href, {
        workspaceId: owningWorkspaceId,
        sourcePanelId,
        event,
        rawHref: anchor.getAttribute('href') ?? undefined,
      });
      return;
    }

    // Handle mention chip clicks (file mentions in chat)
    const mentionEl = target.closest('[data-mention]');
    if (mentionEl) {
      const type = mentionEl.getAttribute('data-type');
      const id = mentionEl.getAttribute('data-id') || '';
      const meta = JSON.parse(mentionEl.getAttribute('data-meta') || '{}');

      if (type === 'file') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const filePath = meta.fullPath || meta.path || meta.filename || id;
        logger.debug('[MarkdownViewer] File mention clicked', { filePath, meta });

        // Get source panel ID for same-panel navigation
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });

        // Use onFileClick callback if provided, otherwise use direct navigation
        if (onFileClick) {
          onFileClick(filePath, { openInAdjacentPanel, sourcePanelId });
        } else {
          const wsId = workspaceId;
          if (wsId) {
            appStore.dispatch(
              openWorkspaceFile(wsId, filePath, { openInAdjacentPanel, sourcePanelId }),
            );
          }
        }
      } else if (type === 'note') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const noteId = meta.noteId || id;
        logger.debug('[MarkdownViewer] Note mention clicked', { noteId, meta });

        // Get source panel ID for same-panel navigation
        const sourcePanelId = getSourcePanelId(event);
        const openInAdjacentPanel = isCmdClickModifier({ event });

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
    if (event.key !== 'Enter' || !isCmdClickModifier({ event })) return;
    handleLinkClick(event);
  }

  function getSourcePanelId(event: MouseEvent | KeyboardEvent): string | undefined {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return undefined;
    return target.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId;
  }

  // Store file click handler for cleanup
  let fileClickHandler: ((event: MouseEvent) => void) | null = null;

  // Function to initialize the editor (called when editorElement is available)
  function initializeEditor(element: HTMLElement) {
    // Attach link click handler (using the shared handler function)
    element.addEventListener('click', handleLinkClick, true);
    element.addEventListener('keydown', handleLinkKeydown, true);

    // Create a new TipTap editor for this element
    // NOTE: Editor pooling was disabled because TipTap editors cannot be reliably
    // reattached to new DOM elements after creation. The setOptions({ element })
    // approach doesn't work - the ProseMirror view remains bound to the original element.
    editor = new Editor({
      element: element,
      editable: false,
      content: processedContent,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: false,
        }),
        createIntentLink({
          openOnClick: false,
          HTMLAttributes: {
            class: 'markdown-link cursor-pointer',
          },
        }),
        TaskList.configure({
          HTMLAttributes: {
            class: 'task-list',
          },
        }),
        TaskItem.configure({
          nested: true,
          HTMLAttributes: {
            class: 'task-item',
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
          HTMLAttributes: {
            class: 'code-block',
          },
        }),
        Table.configure({
          resizable: false,
          HTMLAttributes: {
            class: 'note-table',
          },
        }),
        TableRow,
        TableHeader.configure({
          HTMLAttributes: {
            class: 'note-table-header',
          },
        }),
        TableCell.configure({
          HTMLAttributes: {
            class: 'note-table-cell',
          },
        }),
        Image.configure({
          // Inline so a link mark can wrap the image — keeps link-wrapped
          // images following the link (matching the static/streaming paths)
          // instead of TipTap dropping the anchor on parse
          inline: true,
          HTMLAttributes: {
            class: 'markdown-image',
          },
        }),
        TasksBlock,
      ],
      // Disable the buggy 'delete' core extension that emits delete events.
      // It has a bug where it calls nodeAt(newStart - 1) without checking if newStart is 0,
      // causing "Position -1 outside of fragment" errors.
      enableCoreExtensions: {
        delete: false,
      },
      editorProps: {
        handleClick: (_view, _pos, event) => {
          const target = event.target as HTMLElement;
          const anchor = target.closest('a');
          if (anchor?.href?.startsWith('intent://')) {
            return true;
          }
          return false;
        },
      },
    });

    // Set initial content if available
    if (processedContent && editor) {
      editor.commands.setContent(processedContent, { emitUpdate: false });
    }

    // Add click handler for file references
    fileClickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Check if clicked element is a file reference (starts with @ or is in backticks)
      const text = target.textContent || '';

      // Pattern to match file paths
      const filePathPattern = /^@?([\/\w\-\.]+\.\w+)$/;
      const match = text.match(filePathPattern);

      if (match && onFileClick) {
        event.preventDefault();
        const filePath = match[1];
        logger.info('File reference clicked in markdown', { filePath });
        onFileClick(filePath, {
          openInAdjacentPanel: event.metaKey || event.ctrlKey,
          sourcePanelId: getSourcePanelId(event),
        });
      }

      // Also check for code elements that might contain file paths
      if (target.tagName === 'CODE' && text.includes('/')) {
        const cleanPath = text.replace(/^@/, '').replace(/`/g, '');
        if (cleanPath.includes('.') && onFileClick) {
          event.preventDefault();
          logger.info('Code file reference clicked', { cleanPath });
          onFileClick(cleanPath, {
            openInAdjacentPanel: event.metaKey || event.ctrlKey,
            sourcePanelId: getSourcePanelId(event),
          });
        }
      }
    };

    element.addEventListener('click', fileClickHandler);
  }

  // Track if editor has been initialized
  let editorInitialized = false;

  onMount(() => {
    // If editorElement is already available (not streaming), initialize immediately
    if (editorElement && !isStreaming) {
      initializeEditor(editorElement);
      editorInitialized = true;
    }
  });

  // Effect to initialize editor when switching from streaming to non-streaming
  $effect(() => {
    if (editorElement && !isStreaming && !editorInitialized) {
      initializeEditor(editorElement);
      editorInitialized = true;
    }
  });

  onDestroy(() => {
    // Clean up link click handler from TipTap editor element
    if (editorElement) {
      editorElement.removeEventListener('click', handleLinkClick, true);
      editorElement.removeEventListener('keydown', handleLinkKeydown, true);
    }

    // Clean up file click handler
    if (fileClickHandler && editorElement) {
      editorElement.removeEventListener('click', fileClickHandler);
    }

    // Clean up pending streaming updates
    cancelPendingUpdates();

    // Destroy the editor
    if (editor) {
      editor.destroy();
      editor = null;
    }
  });
</script>

<!-- PERF: Use separate rendering paths based on content complexity -->
<!-- streaming: live updates with processed HTML -->
<!-- simple: plain text, no markdown - just <p> -->
<!-- static: processed HTML without TipTap (for links, code blocks, etc.) -->
<!-- complex: full TipTap for interactive content (task lists) -->
{#snippet imageActionsOverlay()}
  {#if chatImageThumbnails && hoveredImage}
    <div
      bind:this={imageActionsOverlayElement}
      class="absolute z-10"
      style="top: {hoveredImagePosition.top}px; left: {hoveredImagePosition.left}px;"
      data-testid="markdown-image-actions-overlay"
    >
      <ImageActionsMenu
        imageUrl={hoveredImage.getAttribute('src') || ''}
        imageName={hoveredImage.getAttribute('alt') || undefined}
        bind:open={imageActionsOpen}
      />
    </div>
  {/if}
{/snippet}

{#if isStreaming}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    class="markdown-viewer streaming-content {className}"
    class:chat-image-thumbnails={chatImageThumbnails}
    bind:this={streamingContentElement}
    onclick={handleLinkClick}
    onkeydown={handleLinkKeydown}
    onmouseover={handleImageHover}
    onmouseleave={handleImageHoverLeave}
  >
    {@html processedContent}
    {@render imageActionsOverlay()}
  </div>
{:else if contentComplexity === 'simple'}
  <!-- PERF: Simple text - render directly without any processing -->
  <div class="markdown-viewer simple-content {className}">
    <p class="whitespace-pre-wrap">{content}</p>
  </div>
{:else if contentComplexity === 'static'}
  <!-- PERF: Static content - use processed HTML without TipTap -->
  <!-- This path handles links, code blocks, etc. without the overhead of TipTap -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
  <div
    role="group"
    class="markdown-viewer static-content {className}"
    class:chat-image-thumbnails={chatImageThumbnails}
    bind:this={staticContentElement}
    onclick={handleLinkClick}
    onkeydown={handleLinkKeydown}
    onmouseover={handleImageHover}
    onmouseleave={handleImageHoverLeave}
  >
    {@html processedContent}
    {@render imageActionsOverlay()}
  </div>
{:else}
  <!-- Complex content - needs TipTap for interactivity (task lists, etc.) -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="markdown-viewer {className}"
    class:chat-image-thumbnails={chatImageThumbnails}
    bind:this={editorElement}
    onmouseover={handleImageHover}
    onmouseleave={handleImageHoverLeave}
  >
    <!-- TipTap appends its ProseMirror view here; the overlay is a sibling. -->
    {@render imageActionsOverlay()}
  </div>
{/if}

{#if lightboxImageUrl}
  <ImageLightbox
    bind:open={lightboxOpen}
    imageUrl={lightboxImageUrl}
    imageName={lightboxImageAlt}
    openerElement={lightboxOpenerElement}
    showActionsMenu={chatImageThumbnails}
  />
{/if}

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

  /* PERF: Streaming content uses contain for rendering isolation */
  .streaming-content {
    contain: layout style;
  }

  /* PERF: Simple content - minimal styling */
  .simple-content {
    contain: layout style;
  }

  .simple-content p {
    margin: 0;
  }

  /* PERF: Static content - processed HTML without TipTap */
  .static-content {
    contain: layout style;
  }

  /* Apply same spacing to static content children */
  .markdown-viewer.static-content > :global(* + *) {
    margin-top: 0.75rem;
  }

  /* ProseMirror container styles */
  .markdown-viewer :global(.ProseMirror) {
    outline: none;
    min-height: 1em;
  }

  /* PERF: Apply same styles to streaming content (direct children) */
  /* Use .markdown-viewer prefix for specificity parity with .ProseMirror rule */
  .markdown-viewer.streaming-content > :global(* + *) {
    margin-top: 0.75rem;
  }

  .markdown-viewer :global(.ProseMirror > * + *) {
    margin-top: 0.75rem;
  }

  /* Typography */
  .markdown-viewer :global(p) {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    text-wrap: pretty;
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
    color: hsl(var(--primary));
  }

  .markdown-viewer :global(a:hover),
  .markdown-viewer :global(a:focus-visible) {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }

  .markdown-viewer :global(.markdown-link:hover) {
    opacity: 0.8;
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

  /* Inline workspace file images open in a lightbox on click */
  .markdown-viewer :global(img[src^='workspace-file://']) {
    cursor: zoom-in;
  }

  /* Chat transcript: inline workspace file images render as fixed square
     bordered thumbnails (cropped), matching ChatImageBlock */
  .markdown-viewer.chat-image-thumbnails :global(img[src^='workspace-file://']) {
    width: 10rem;
    height: 10rem;
    object-fit: cover;
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
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
