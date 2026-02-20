<script lang="ts">
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
  import { safeLowlight } from '$lib/utils/safe-lowlight';
  import { logger } from '$lib/utils/client-logger';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  import { createIntentLink } from '$lib/utils/tiptap-link-extension';
  import { TasksBlock } from '$lib/components/tiptap/TasksBlock';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';

  // Use shared safe lowlight instance (handles unregistered languages gracefully)
  const lowlight = safeLowlight;

  interface Props {
    content: string;
    isStreaming?: boolean;
    className?: string;
    onCodeBlockAction?: (action: string, code: string, language?: string) => void;
    onFileClick?: (path: string) => void;
  }

  let {
    content,
    isStreaming = false,
    className = '',
    onCodeBlockAction: _onCodeBlockAction,
    onFileClick,
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
    if (markdown === lastProcessedContent) {
      return;
    }

    if (!markdown) {
      processedContent = '';
      lastProcessedContent = '';
      return;
    }

    try {
      const html = await processMarkdownToHTML(markdown, {
        allowEmpty: true,
        skipIfHTML: false,
        preserveAnchors: true,
      });
      processedContent = html;
      lastProcessedContent = markdown;

      // Update editor content if it exists
      if (editor && !editor.isDestroyed) {
        // Use a transaction to batch updates
        editor.commands.setContent(html, { emitUpdate: false });
        // Note: Scroll management is handled by the parent component via followBottom action
        // Do NOT call scrollIntoView here as it overrides user scroll position
      }
    } catch (error) {
      logger.error('Failed to process markdown:', error);
      processedContent = `<p>${markdown}</p>`;
      lastProcessedContent = markdown;
    }
  }

  // PERF: Lightweight streaming update - uses innerHTML directly instead of TipTap
  async function updateContentStreaming(markdown: string) {
    // Skip if content hasn't actually changed
    if (markdown === lastProcessedContent) {
      return;
    }

    if (!markdown) {
      lastProcessedContent = '';
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
      });
      lastProcessedContent = markdown;
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

  // PERF: Single reusable link click handler - shared between TipTap and static content
  // Routes all link clicks through the unified link handler for consistent behavior:
  // - Click → embedded browser panel (for http/https)
  // - Cmd+Click → external browser
  // - intent:// → internal navigation
  function handleLinkClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const wsId = workspaceStore.current?.id;
      if (wsId) {
        handleLink(anchor.href, {
          workspaceId: WorkspaceId(wsId),
          event,
        });
      }
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
        const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
        const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
        const openInAdjacentPanel = event.metaKey || event.ctrlKey;

        // Use onFileClick callback if provided, otherwise use direct navigation
        if (onFileClick) {
          onFileClick(filePath);
        } else {
          // Fallback: dispatch workspace:open-file event
          window.dispatchEvent(
            new CustomEvent('workspace:open-file', {
              detail: { path: filePath, openInAdjacentPanel, sourcePanelId },
            }),
          );
        }
      } else if (type === 'note') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const noteId = meta.noteId || id;
        logger.debug('[MarkdownViewer] Note mention clicked', { noteId, meta });

        // Get source panel ID for same-panel navigation
        const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
        const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
        const openInAdjacentPanel = event.metaKey || event.ctrlKey;

        // Dispatch workspace:open-note event
        window.dispatchEvent(
          new CustomEvent('workspace:open-note', {
            detail: { noteId, openInAdjacentPanel, sourcePanelId },
          }),
        );
      }
    }
  }

  // Store file click handler for cleanup
  let fileClickHandler: ((event: MouseEvent) => void) | null = null;

  // Function to initialize the editor (called when editorElement is available)
  function initializeEditor(element: HTMLElement) {
    // Attach link click handler (using the shared handler function)
    element.addEventListener('click', handleLinkClick, true);

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
        onFileClick(filePath);
      }

      // Also check for code elements that might contain file paths
      if (target.tagName === 'CODE' && text.includes('/')) {
        const cleanPath = text.replace(/^@/, '').replace(/`/g, '');
        if (cleanPath.includes('.') && onFileClick) {
          event.preventDefault();
          logger.info('Code file reference clicked', { cleanPath });
          onFileClick(cleanPath);
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
{#if isStreaming}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="markdown-viewer streaming-content {className}" bind:this={streamingContentElement} onclick={handleLinkClick}>
    {@html processedContent}
  </div>
{:else if contentComplexity === 'simple'}
  <!-- PERF: Simple text - render directly without any processing -->
  <div class="markdown-viewer simple-content {className}">
    <p class="whitespace-pre-wrap">{content}</p>
  </div>
{:else if contentComplexity === 'static'}
  <!-- PERF: Static content - use processed HTML without TipTap -->
  <!-- This path handles links, code blocks, etc. without the overhead of TipTap -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="markdown-viewer static-content {className}"
    bind:this={staticContentElement}
    onclick={handleLinkClick}
  >
    {@html processedContent}
  </div>
{:else}
  <!-- Complex content - needs TipTap for interactivity (task lists, etc.) -->
  <div class="markdown-viewer {className}" bind:this={editorElement}></div>
{/if}

<style>
  .markdown-viewer {
    position: relative;
    width: 100%;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--color-text);
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
  }

  .markdown-viewer :global(strong) {
    font-weight: 700;
  }

  .markdown-viewer :global(h1),
  .markdown-viewer :global(h2),
  .markdown-viewer :global(h3),
  .markdown-viewer :global(h4),
  .markdown-viewer :global(h5),
  .markdown-viewer :global(h6) {
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
    font-weight: 600;
    line-height: 1.25;
  }

  .markdown-viewer :global(h1) {
    font-size: 1.25rem;
    letter-spacing: -0.02em;
  }

  .markdown-viewer :global(h2) {
    font-size: 1rem;
    letter-spacing: -0.016em;
  }

  .markdown-viewer :global(h3) {
    font-size: 1rem;
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
    background: var(--color-muted);
    cursor: default;
    pointer-events: none; /* Read-only */
    position: relative;
    flex-shrink: 0;
  }

  .markdown-viewer :global(.task-item input[type='checkbox']:checked) {
    background: var(--color-foreground);
  }

  .markdown-viewer :global(.task-item input[type='checkbox']:checked::after) {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0.3rem;
    height: 0.5rem;
    border: solid var(--color-background);
    border-width: 0 2px 2px 0;
    transform: translate(-45%, -60%) rotate(45deg);
  }

  /* Code */
  .markdown-viewer :global(code:not(.code-block code)) {
    background: hsla(var(--muted) / 0.4);
    color: var(--color-muted-foreground);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.9em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  }

  /* Code blocks */
  .markdown-viewer :global(.code-block) {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 1rem;
    overflow-x: auto;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
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
  .markdown-viewer :global(.markdown-link) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .markdown-viewer :global(.markdown-link:hover) {
    text-decoration-thickness: 2px;
    opacity: 0.8;
  }

  /* Blockquotes */
  .markdown-viewer :global(blockquote) {
    border-left: 3px solid var(--color-primary);
    padding-left: 1rem;
    margin: 0.75rem 0;
    color: var(--color-text-secondary);
    font-style: italic;
  }

  /* Tables */
  .markdown-viewer :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    overflow: auto;
    display: block;
  }

  .markdown-viewer :global(th),
  .markdown-viewer :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.5rem;
    text-align: left;
    word-break: auto-phrase;
    white-space: normal;
  }

  .markdown-viewer :global(th) {
    background: hsl(var(--muted) / 0.3);
    font-weight: 600;
  }

  .markdown-viewer :global(tr:hover) {
    background: var(--color-surface-1);
  }

  /* Horizontal rule */
  .markdown-viewer :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1.5rem 0;
  }

  /* Images */
  .markdown-viewer :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 0.375rem;
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
    border: 2px solid var(--color-muted-foreground);
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
      var(--color-muted-foreground) 25%,
      transparent 50%,
      var(--color-muted-foreground) 75%
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
