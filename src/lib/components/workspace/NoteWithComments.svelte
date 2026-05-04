<script lang="ts">
/* eslint-disable max-lines */
  import BubbleMenu from '$lib/components/tiptap/BubbleMenu.svelte';
  import CommentDialog from '$lib/components/tiptap/CommentDialog.svelte';
  import CommentsSidebar from '$lib/components/tiptap/CommentsSidebar.svelte';
  import LineAttributionGutter from '$lib/components/tiptap/LineAttributionGutter.svelte';
  import NoteVersionHistory from '$lib/components/workspace/NoteVersionHistory.svelte';
  import SuggestionTooltip from '$lib/components/tiptap/SuggestionTooltip.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import Fa from 'svelte-fa';
  import { faSearch, faTimes, faChevronUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import { untrack } from 'svelte';
  import { createTaskAgentStatusMountManager } from './note-with-comments/task-agent-status-mount-manager';
  import { runAssignAgentTaskMenuAction } from './note-with-comments/task-menu-assign-agent-action';
  import { runTaskBreakdownTaskMenuAction } from './note-with-comments/task-menu-task-breakdown-action';
  import {
    createImageDropHandler,
    createImagePasteHandler,
  } from './note-with-comments/image-upload-handlers';
  import {
    discoverTaskMenuPopovers,
    type TaskMenuPopoverData,
  } from './note-with-comments/task-menu-popover-discovery';
  import {
    getTaskAssociationKeysInEditor,
    getTaskTextsInEditor,
    removeAgentFromTasks,
    restoreTaskAgentAssociations,
  } from './note-with-comments/task-item-utils';
  import {
    createScrollToHeadingHandler,
    createScrollToTaskHandler,
  } from './note-with-comments/note-scroll-handlers';
  import TaskMenu from '$lib/components/tiptap/TaskMenu.svelte';
  import NoteMetadataBar from '$lib/components/workspace/NoteMetadataBar.svelte';
  import NoteCodeChangesCard from '$lib/components/workspace/NoteCodeChangesCard.svelte';
  import type { Workspace } from '$shared/types';
  import type { CommentManagerV2 } from '$features/comments/comment-manager-v2';
  import {
    runExternalContentUpdateEffect,
    shouldSafetyNetTrigger,
  } from './note-with-comments/external-update-effect';
  import { applyExternalUpdateHtmlToEditorPreservingCursor } from './note-with-comments/external-update-editor';
  import {
    destroyAndClearCommentManagerV2,
    maybeCreateCommentManagerV2,
  } from './note-with-comments/comment-manager-lifecycle';
  import {
    createOnCommentManagerContentChangedAfterAnchorInsertion,
    createOnCommentManagerContentChangedUpdateLastKnownContent,
  } from './note-with-comments/comment-manager-content-change-handlers';
  import { setupCommentMarkClickHandlerV2 } from './note-with-comments/comment-mark-click-handler';
  import { Editor } from '@tiptap/core';
  import { NoteId } from '$shared/types/branded-ids';
  import { TextSelection } from '@tiptap/pm/state';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectComments } from '$lib/store/slices/comments/comments-selectors';
  import {
    selectCommentAction,
    updateCommentAction,
    clearCommentsAction,
  } from '$lib/store/slices/comments/comments-slice';

  const reduxDispatch = getDispatch();
  import { createEditorConfig } from '$lib/utils/editor-config';
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { isSpecNote } from '$shared/constants/notes';
  import { createLogger } from '$lib/utils/client-logger';

  import {
    restoreNoteVersion,
    updateNoteContent,
    clearNewlyCreatedNoteId,
  } from '$lib/store/slices/workspace-notes/workspace-notes-slice';
  import {
    selectNoteById,
    selectNewlyCreatedNoteId,
  } from '$lib/store/slices/workspace-notes/workspace-notes-selectors';
  import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
  import { setupEditorListeners } from '$lib/utils/editor-listeners';
  import { updateCommentDecorations } from '$lib/components/tiptap/CommentDecorations';
  import {
    AGENT_ASSOCIATIONS_REMOVED_EVENT,
    pruneTaskAgentAssociationsForNote,
    TASK_ASSOCIATION_CHANGED_EVENT,
  } from '$lib/store/slices/task-agent-associations/task-agent-associations-slice';
  import { selectAssociationsForNote } from '$lib/store/slices/task-agent-associations/task-agent-associations-selectors';
  import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';

  import { invoke } from '$lib/electron-bridge';
  import { selectNoteFontStyle } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { selectSpellcheckEnabled } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { selectWorkspaceNavigationHistory } from '$lib/store/slices/workspace-navigation/workspace-navigation-selectors';
  import { openWorkspaceFile } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';
  import { createTiptapTaskListMarked } from '$lib/utils/tiptap-task-list-extension';
  import { track } from '$lib/services/analytics';
  import { dispatchWindowEvent } from '$lib/utils/window-events';

  const logger = createLogger('NoteWithComments');
  const noteFontStyle = selectNoteFontStyle();
  const spellcheckEnabled = selectSpellcheckEnabled();
  const allComments$ = selectComments();

  // --- Markdown paste detection helpers ---

  /**
   * Detects whether plain text contains Markdown formatting.
   * Counts distinct markdown pattern types — requires ≥2 to avoid false positives
   * (e.g. code files that happen to use `#` comments).
   */
  function looksLikeMarkdown(text: string): boolean {
    const patterns = new Set<string>();
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (/^#{1,6}\s/.test(trimmed)) patterns.add('heading');
      if (/^[-*+]\s/.test(trimmed)) patterns.add('unordered-list');
      if (/^\d+\.\s/.test(trimmed)) patterns.add('ordered-list');
      if (/^```/.test(trimmed)) patterns.add('code-fence');
      if (/^>\s/.test(trimmed)) patterns.add('blockquote');
      if (/^[-*]\s\[[ x]\]\s/i.test(trimmed)) patterns.add('task-list');
      if (/^(---|===|\*\*\*|___)\s*$/.test(trimmed)) patterns.add('horizontal-rule');
    }
    if (/\[.+?\]\(.+?\)/.test(text)) patterns.add('link');
    if (/(\*\*|__).+?\1/.test(text)) patterns.add('bold');
    if (/!\[.*?\]\(.+?\)/.test(text)) patterns.add('image');
    return patterns.size >= 2;
  }

  /**
   * Checks whether HTML contains semantic block elements indicating rich formatting
   * from a web source (e.g. copied from a rendered page). If present, we let TipTap
   * handle the paste natively rather than converting text/plain as markdown.
   */
  function hasRichHtmlContent(html: string): boolean {
    return /<(h[1-6]|ul|ol|blockquote|table|img)[\s>]/i.test(html);
  }

  // Singleton marked instance for synchronous markdown → HTML conversion on paste
  let pasteMarkedInstance: ReturnType<typeof createTiptapTaskListMarked> | null = null;
  function getPasteMarkedInstance() {
    if (!pasteMarkedInstance) {
      pasteMarkedInstance = createTiptapTaskListMarked();
    }
    return pasteMarkedInstance;
  }

  const handleImagePaste = createImagePasteHandler({
    getEditor: () => editor,
    getWorkspaceId: () => workspace?.id,
    invoke,
    logger,
  });

  const handleDrop = createImageDropHandler({
    getEditor: () => editor,
    getWorkspaceId: () => workspace?.id,
    invoke,
    logger,
  });

  // Drag state for visual feedback
  let isDragging = $state(false);
  let dragCounter = $state(0);

  function handleDragEnter(event: DragEvent): void {
    event.preventDefault();
    dragCounter++;
    if (event.dataTransfer?.types.includes('Files')) {
      isDragging = true;
    }
  }

  function handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  // Highlight a task at a given position with a flash effect
  function highlightTaskAtPosition(position: number): void {
    if (!editor?.view) return;

    try {
      // Get the DOM element at the position
      const coords = editor.view.coordsAtPos(position);
      if (!coords) return;

      // Find the task item element at this position
      const domAtPos = editor.view.domAtPos(position);
      if (!domAtPos?.node) return;

      // Walk up to find the task item container
      let taskElement: HTMLElement | null = null;
      let current: Node | null = domAtPos.node;
      while (current && current !== element) {
        if (
          current instanceof HTMLElement &&
          current.hasAttribute('data-type') &&
          current.getAttribute('data-type') === 'taskItem'
        ) {
          taskElement = current;
          break;
        }
        current = current.parentNode;
      }

      if (taskElement) {
        taskElement.classList.add('task-highlight-flash');
        setTimeout(() => taskElement?.classList.remove('task-highlight-flash'), 2000);
      }
    } catch (err) {
      logger.debug('[highlightTaskAtPosition] Could not highlight task', err);
    }
  }

  // Props
  let {
    workspace,
    noteId,
    content = '',
    editable = true,
    showSuggestions = true,
    showComments = true,
    shouldFocus = false,
    showVersionHistory = $bindable(false),
    initialScrollPosition,
    onScrollPositionSave,
    onAttachContent: _onAttachContent,
    onagentlaunched,
    onnavigatetoagent,
    isInitialSpecWriteInProgress = false,
    isPanelFocused = false,
  }: {
    workspace: Workspace;
    noteId?: string;
    content?: string;
    editable?: boolean;
    showSuggestions?: boolean;
    showComments?: boolean;
    shouldFocus?: boolean;
    showVersionHistory?: boolean;
    /** Initial scroll position to restore when mounting */
    initialScrollPosition?: number;
    /** Callback to save scroll position before unmounting */
    onScrollPositionSave?: (scrollTop: number) => void;
    onAttachContent?: (event: CustomEvent<{ query: string }>) => void;
    onagentlaunched?: (data: any) => void;
    onnavigatetoagent?: (data: { agentId: string }) => void;
    /** Whether the initial spec write is in progress (coordinator writing first draft) */
    isInitialSpecWriteInProgress?: boolean;
    /** Whether this panel is focused (has DOM focus within panel wrapper) */
    isPanelFocused?: boolean;
  } = $props();

  // Note: _onAttachContent is received but not yet implemented - reserved for future attach content feature

  // Comment dialog state
  let showCommentDialog = $state(false);
  let commentDialogPosition = $state({ x: 0, y: 0 });

  // Search state
  let showSearch = $state(false);
  let searchQuery = $state('');
  let searchInputRef: HTMLInputElement | null = $state(null);
  let currentSearchIndex = $state(0);

  // Find all matches in the editor
  // Find search matches using TreeWalker on the actual DOM
  // This works with custom node views like TaskItem
  // Returns both the count and applies highlights
  function findAndHighlightMatches(
    query: string,
    currentIdx: number,
  ): { count: number; currentRange: Range | null } {
    // Clear existing highlights
    CSS.highlights?.delete('note-search-results');
    CSS.highlights?.delete('note-current-search-result');

    const container = untrack(() => scrollContainer);
    if (!query.trim() || !CSS.highlights) return { count: 0, currentRange: null };

    // Find the ProseMirror editor element
    const editorEl = container?.querySelector('.ProseMirror');
    if (!editorEl) return { count: 0, currentRange: null };

    const lowerQuery = query.toLowerCase();
    const allRanges: Range[] = [];
    let currentRange: Range | null = null;
    let matchIndex = 0;

    // Use TreeWalker to find all text nodes in the editor
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const parent = node.parentElement;
      // Skip script, style, and other non-content elements
      if (parent && !['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
        const text = node.textContent || '';
        const lowerText = text.toLowerCase();
        let index = lowerText.indexOf(lowerQuery);

        while (index !== -1) {
          try {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + query.length);

            if (matchIndex === currentIdx) {
              currentRange = range;
            } else {
              allRanges.push(range);
            }
            matchIndex++;
          } catch {
            // Range creation might fail, ignore
          }
          index = lowerText.indexOf(lowerQuery, index + 1);
        }
      }
    }

    // Create highlights
    if (allRanges.length > 0 || currentRange) {
      if (allRanges.length > 0) {
        const searchHighlight = new Highlight(...allRanges);
        CSS.highlights.set('note-search-results', searchHighlight);
      }
      if (currentRange) {
        const currentSearchHighlight = new Highlight(currentRange);
        CSS.highlights.set('note-current-search-result', currentSearchHighlight);
      }
    }

    return { count: matchIndex, currentRange };
  }

  // Total match count (updated by findAndHighlightMatches)
  let searchMatchCount = $state(0);

  // Scroll a table wrapper horizontally to reveal a search match range
  function scrollTableWrapperToRange(range: Range) {
    let node: Node | null = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const tableWrapper = (node as HTMLElement)?.closest?.('.tableWrapper');
    if (!tableWrapper) return;

    const rangeRect = range.getBoundingClientRect();
    const wrapperRect = tableWrapper.getBoundingClientRect();

    // If match is outside the visible area of the wrapper, scroll to center it
    if (rangeRect.left < wrapperRect.left || rangeRect.right > wrapperRect.right) {
      const matchLeftRelative = rangeRect.left - wrapperRect.left + tableWrapper.scrollLeft;
      tableWrapper.scrollTo({
        left: Math.max(0, matchLeftRelative - wrapperRect.width / 2 + rangeRect.width / 2),
        behavior: 'smooth',
      });
    }
  }

  // Scroll the outer container vertically and any table wrapper horizontally
  function scrollToRange(range: Range, container: HTMLElement) {
    requestAnimationFrame(() => {
      try {
        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const elementOffsetTop = rect.top - containerRect.top + container.scrollTop;
        const targetScrollTop = elementOffsetTop - containerRect.height / 2;

        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });

        // Also scroll table wrapper horizontally if the match is in a wide table
        scrollTableWrapperToRange(range);
      } catch {
        // Range might be invalid, ignore
      }
    });
  }

  // Navigate to a search match and apply highlights
  function navigateToMatch(matchIndex: number) {
    const query = untrack(() => searchQuery);
    const container = untrack(() => scrollContainer);
    const count = untrack(() => searchMatchCount);

    if (!query.trim() || count === 0) return;

    // Wrap around
    let wrappedIndex = matchIndex % count;
    if (wrappedIndex < 0) wrappedIndex += count;
    currentSearchIndex = wrappedIndex;

    // Find matches and apply highlights, get the current range for scrolling
    const { currentRange } = findAndHighlightMatches(query, wrappedIndex);

    // Scroll the current match into view
    if (currentRange && container) {
      scrollToRange(currentRange, container);
    }
  }

  // Handle search input changes - called from the oninput handler
  function handleSearchInput() {
    const query = untrack(() => searchQuery);
    currentSearchIndex = 0;

    // Find and highlight matches, get the count
    const { count, currentRange } = findAndHighlightMatches(query, 0);
    searchMatchCount = count;

    // Scroll to first match if any
    if (currentRange) {
      const container = untrack(() => scrollContainer);
      if (container) {
        scrollToRange(currentRange, container);
      }
    }
  }

  // Scroll to a specific match (wraps around at boundaries)
  function scrollToMatch(index: number) {
    navigateToMatch(index);
  }

  // Clear CSS highlights when closing search
  function clearSearchHighlights() {
    CSS.highlights?.delete('note-search-results');
    CSS.highlights?.delete('note-current-search-result');
  }

  // Handle search keyboard shortcuts
  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showSearch = false;
      searchQuery = '';
      searchMatchCount = 0;
      clearSearchHighlights();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        scrollToMatch(currentSearchIndex - 1);
      } else {
        scrollToMatch(currentSearchIndex + 1);
      }
    }
  }

  // Handle Cmd+F only when this panel is focused
  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      // Only open search if this panel is focused
      if (isPanelFocused) {
        e.preventDefault();
        showSearch = true;
        // Focus the search input after it renders
        setTimeout(() => searchInputRef?.focus(), 0);
      }
    }
  }

  // State
  let element: HTMLElement = $state(null!);
  let scrollContainer: HTMLElement = $state(null!);
  let externalUpdateVersion = $state(0);

  let editor: Editor = $state(null!);
  let selectedSuggestion: any = $state(null);
  let tooltipPosition = $state({ x: 0, y: 0 });
  // Task menu state - track discovered task buttons
  let taskMenuData = $state<TaskMenuPopoverData[]>([]);
  let cleanupFn: (() => void) | null = null;
  let cleanupCommentClickHandler: (() => void) | null = null;

  const taskAgentStatusMountManager = createTaskAgentStatusMountManager({
    getRootElement: () => element,
    onViewAgent: (agentId) => {
      onnavigatetoagent?.({ agentId });
    },
  });
  let headingScrollHandler: ((e: any) => void) | null = null;
  let taskScrollHandler: ((e: any) => void) | null = null;

  // Content size limit — notes above this threshold are shown as plain text
  // to prevent the markdown processing pipeline from freezing the UI.
  const MAX_NOTE_CONTENT_SIZE = 200 * 1024; // 200KB
  let isTooLargeForRichEditor = $state(false);
  let plainTextFallbackContent = $state('');

  let isInitialized = $state(false);
  let isInitializing = $state(true);

  // Streaming-in animation state: triggers a cascading reveal
  // when a newly created note first loads
  let isStreamingIn = $state(false);

  // CRITICAL: Destruction flag to prevent async callbacks from accessing reactive state after destruction.
  // This prevents "N is not a function" errors when Svelte's reactive system tries to call
  // nullified internal functions. This MUST be set FIRST in onDestroy, before any other cleanup.
  // This is NOT reactive ($state) intentionally - we want to read it without triggering reactive tracking.
  let isComponentDestroyed = false;

  // Track content updates
  let isUpdatingFromExternal = false;
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEditTrackTime = 0;
  let isUserTyping = false;
  let userTypingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isRecoverySave = false;
  // Track if user has made actual edits since last save/external update
  // This is more reliable than comparing content (which can differ due to HTML→Markdown conversion)
  let hasUserEditedSinceLastSave = false;

  // Comment manager
  let commentManager: CommentManagerV2 | null = $state(null);

  // Container resize tracking

  // Reactive note content - this will update when the store changes
  let lastDerivedContent: string | null = null;

  // Writable stores mirror prop values so the Redux selector re-evaluates
  // when workspace.id or noteId changes (same pattern as file-tree-view / AgentSubscriptions).
  const workspaceIdStore = writable(workspace?.id ?? '');
  const noteIdStore = writable(noteId ?? '');
  $effect(() => { workspaceIdStore.set(workspace?.id ?? ''); });
  $effect(() => { noteIdStore.set(noteId ?? ''); });

  // Get the current note for task metadata (reactive via Redux selector)
  const currentNote$ = selectNoteById(workspaceIdStore, noteIdStore);
  const currentNote = $derived($currentNote$ ?? null);

  // Reactive selector subscriptions at component init time

  let currentNoteContent = $derived.by(() => {
    // Secondary trigger: externalUpdateVersion forces re-eval as a fallback
    void externalUpdateVersion;

    // Primary reactivity: derive from the reactive selector
    if (currentNote && currentNote.workspaceId === workspace?.id) {
      const derived = currentNote.content || '';
      if (derived !== lastDerivedContent) {
        logger.debug('[NoteWithComments] Derived note content updated', {
          noteId,
          length: derived.length,
        });
        lastDerivedContent = derived;
      }
      return derived;
    }

    // Fallback for when note isn't in store yet
    const fallback = content || '';
    if (fallback !== lastDerivedContent) {
      logger.debug('[NoteWithComments] Derived content fallback', {
        noteId,
        hasCurrentNote: !!currentNote,
        fallbackLength: fallback.length,
      });
      lastDerivedContent = fallback;
    }
    return fallback;
  });

  // Check if there are any active comments to display

  $effect(() => {
    const workspaceId = workspace?.id;
    if (!noteId || !workspaceId) {
      return;
    }

    const handleContentUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.workspaceId !== workspaceId || detail.noteId !== noteId) {
        return;
      }

      const updatedContent = detail.content as string;
      const source = detail.source as 'agent' | 'external';

      logger.info('[NoteWithComments] Received store content update', {
        noteId: detail.noteId,
        updatedLength: updatedContent?.length ?? 0,
        previousVersion: externalUpdateVersion,
        source,
        isUserTyping,
      });

      // Agent updates should be trusted - clear the user edit flag so the update is accepted
      if (source === 'agent') {
        logger.info('[NoteWithComments] Agent update - clearing hasUserEditedSinceLastSave', {
          noteId: detail.noteId,
        });
        hasUserEditedSinceLastSave = false;
      }

      externalUpdateVersion = externalUpdateVersion + 1;
    };

    window.addEventListener('note-content-update', handleContentUpdate);

    return () => {
      window.removeEventListener('note-content-update', handleContentUpdate);
    };
  });

  // Register markdown paste handler in capture phase so it fires BEFORE
  // ProseMirror's handler on the contenteditable child. This prevents double
  // paste: without capture, ProseMirror inserts plain text first, then our
  // bubbling-phase handler would insert rich HTML on top.
  $effect(() => {
    if (!element) return;

    const markdownPasteHandler = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;

      const text = clipboardData.getData('text/plain');
      const html = clipboardData.getData('text/html');

      // If the clipboard has rich HTML (headings, lists, tables, etc.),
      // let TipTap handle the paste natively — it already does a good job.
      const isRichHtml = html && hasRichHtmlContent(html);

      if (!isRichHtml && text && looksLikeMarkdown(text) && editor && !editor.isDestroyed) {
        // Stop the event from reaching ProseMirror's handler entirely
        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          const markedInst = getPasteMarkedInstance();
          const processedHtml = markedInst.parse(text) as string;
          editor.chain().focus().insertContent(processedHtml).run();
        } catch (err) {
          logger.error('[NoteWithComments] Markdown paste conversion failed', err);
          editor.chain().focus().insertContent(text).run();
        }
      }
    };

    element.addEventListener('paste', markdownPasteHandler, { capture: true });
    return () => {
      element.removeEventListener('paste', markdownPasteHandler, { capture: true });
    };
  });

  let hasActiveComments = $derived.by(() => {
    // Only reserve space for comments if:
    // 1. Comments feature is enabled (showComments is true)
    // 2. There are actual comments to display (not resolved and not replies)
    if (!showComments) return false;

    const activeComments = $allComments$.filter((c) => c.status !== 'resolved' && !c.parentId);
    return activeComments.length > 0;
  });

  // Debounce content updates
  function debounceUpdate() {
    if (isInitializing || isUpdatingFromExternal) {
      return;
    }

    isUserTyping = true;
    hasUserEditedSinceLastSave = true;

    if (userTypingTimeout) {
      clearTimeout(userTypingTimeout);
    }

    userTypingTimeout = setTimeout(() => {
      isUserTyping = false;
    }, 1000);

    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
    }

    saveDebounceTimer = setTimeout(() => {
      saveEditorContent();
    }, 1000);
  }

  /**
   * Save the current editor content to the store and backend.
   * Called both by debounce timer and on cleanup to prevent data loss.
   */
  async function saveEditorContent() {
    if (!editor || !workspace?.id || !noteId) return;

    // Check if this is a recovery save at the start
    const wasRecoverySave = isRecoverySave;
    if (wasRecoverySave) {
      isRecoverySave = false; // Clear flag at start of recovery save
      logger.debug('[NoteWithComments] Processing recovery save');
    }
    try {
      const htmlContent = editor.getHTML();

      const markdownContent = processHTMLToMarkdown(htmlContent, {
        preserveAnchors: true,
      });

      // Check if content actually changed
      if (markdownContent === lastKnownContent) {
        // No actual change, skip update to prevent cursor jump
        return;
      }

      // Update last known content when user saves
      lastKnownContent = markdownContent;
      // NOTE: We intentionally do NOT set hasUserEditedSinceLastSave = false here.
      // This flag should only be cleared when an external update is successfully applied,
      // not when the debounce save fires. This prevents stale external updates from
      // overwriting recent editor changes (e.g., when multiple tasks are delegated rapidly).

      // Update note content via Redux dispatch
      {
        const note = selectNoteById.select(getReduxStore().getState(), workspace.id, noteId);
        if (note) {
          reduxDispatch(updateNoteContent(workspace.id, noteId, markdownContent));

          // Track note edit (throttled to at most once every 30s during continuous editing)
          try {
            const now = Date.now();
            if (now - lastEditTrackTime >= 30_000) {
              lastEditTrackTime = now;
              const noteType = note.metadata?.task ? 'task' : 'regular';
              track('Edited Note', { note_type: noteType, note_id: noteId });
            }
          } catch {
            // Analytics tracking should not break note editing
          }
        }
      }

      // Note: Comment anchor recovery is handled by the backend in notes.service.ts
      // before saving to disk. Frontend recovery is disabled via ENABLE_MAIN_PROCESS_RECOVERY flag.
    } catch (error) {
      logger.error('[NoteWithComments] Error saving content', error);
    }
  }

  // Handle suggestion click
  function handleSuggestionClick(suggestion: any) {
    selectedSuggestion = suggestion;
    if (editor && editor.view) {
      const { from } = editor.state.selection;
      const rect = editor.view.coordsAtPos(from);
      tooltipPosition = { x: rect.left, y: rect.top };
    }
  }

  function syncTaskAgentAssociations() {
    if (!editor || editor.isDestroyed || !workspace?.id || !noteId) return;

    const associations = selectAssociationsForNote.select(
      getReduxStore().getState(),
      workspace.id,
      noteId,
    );
    const currentTaskKeys = getTaskAssociationKeysInEditor(editor);
    const currentTaskTextCounts = getTaskTextsInEditor(editor).reduce<Record<string, number>>((counts, taskText) => {
      counts[taskText] = (counts[taskText] ?? 0) + 1;
      return counts;
    }, {});
    const associationTextCounts = associations.reduce<Record<string, number>>((counts, association) => {
      counts[association.taskText] = (counts[association.taskText] ?? 0) + 1;
      return counts;
    }, {});
    const hasAmbiguousDuplicateAssociations = Object.entries(associationTextCounts).some(
      ([taskText, count]) => count > (currentTaskTextCounts[taskText] ?? 0),
    );
    if (hasAmbiguousDuplicateAssociations || associations.some((association) => association.taskKey
      ? !currentTaskKeys.includes(association.taskKey)
      : !currentTaskKeys.includes(association.taskText))) {
      reduxDispatch(pruneTaskAgentAssociationsForNote(workspace.id, noteId, currentTaskKeys));
      return;
    }

    restoreTaskAgentAssociations(editor, associations, logger);
  }

  async function handleTaskMenuAction(
    action: string,
    taskData: any,
    options?: { skipSave?: boolean },
  ) {
    if (action === 'assign-agent') {
      const state = getReduxStore().getState();
      const parentNote = noteId ? selectNoteById.select(state, workspace.id, noteId) : null;
      const model = selectWorkspaceDefaultModel.select(state, workspace.id);
      return runAssignAgentTaskMenuAction({
        editor,
        workspace,
        noteId,
        taskData,
        options,
        parentNoteTitle: parentNote?.title || 'parent note',
        model,
        debounceUpdate,
        storeDispatch: reduxDispatch,
        dispatch: (type, detail) => {
          if (type === 'agentLaunched') {
            onagentlaunched?.(detail);
          }
        },
        logger,
      });
    } else if (action === 'task-breakdown') {
      return runTaskBreakdownTaskMenuAction({
        workspace,
        noteId,
        taskData,
        model: selectWorkspaceDefaultModel.select(getReduxStore().getState(), workspace.id),
        dispatch: (type, detail) => {
          if (type === 'agentLaunched') {
            onagentlaunched?.(detail);
          }
        },
        logger,
      });
    }
  }

  /**
   * Popover Discovery System
   *
   * This function implements a dynamic discovery pattern for Popover API integration:
   *
   * 1. **Discovery**: Scans the TipTap editor DOM for task menu buttons
   * 2. **Data Extraction**: Reads task data from button attributes (stored by CustomTaskItem)
   * 3. **Reactive Rendering**: Updates Svelte state to trigger TaskMenu component rendering
   *
   * Why this approach:
   * - TipTap creates/destroys task buttons dynamically as content changes
   * - Popover API requires matching id/popovertarget pairs in the DOM
   * - This bridges the gap between TipTap's dynamic content and Svelte's reactive rendering
   *
   * Alternative approaches considered:
   * - Manual DOM manipulation: Less maintainable, harder to debug
   * - TipTap plugins: More complex, tighter coupling
   * - MutationObserver: Overkill for this use case, performance overhead
   * - Polling interval: Wasteful, runs even when content doesn't change
   *
   * This event-driven approach triggers discovery only when content actually changes,
   * providing optimal performance and immediate responsiveness.
   */
  function setupTaskMenuPopovers() {
    if (!element) return;

    taskMenuData = discoverTaskMenuPopovers(element);
  }

  // Handle add comment button click
  function handleAddCommentClick() {
    if (editor && editor.view) {
      const { from } = editor.state.selection;
      const rect = editor.view.coordsAtPos(from);
      // Get the editor container's position for better alignment
      const editorRect = editor.view.dom.getBoundingClientRect();
      // Position the dialog to the right of the editor content
      commentDialogPosition = {
        x: editorRect.right - 360, // Position near the right edge, accounting for dialog width
        y: rect.top,
      };
    }
    showCommentDialog = true;
  }

  // Handle comment submission
  async function handleCommentSubmit(event: CustomEvent<{ content: string; type: string }>) {
    const { content, type } = event.detail;

    if (commentManager) {
      await commentManager.addComment(content, type as any);
    }
    showCommentDialog = false;
  }

  // Handle resolve comment
  async function handleResolveComment(commentId: string) {
    if (commentManager) {
      await commentManager.resolveComment(commentId);
    }
  }

  // Handle reply to comment
  async function handleReplyToComment(commentId: string, content: string) {
    if (commentManager) {
      await commentManager.replyToComment(commentId, content);
    }
  }

  // Handle restore version
  //
  // Restore a note to a specific version via saga.
  // The saga calls notesClient.restoreVersion and dispatches handleExternalNoteUpdate,
  // which triggers the existing external content update flow (note-content-update event →
  // externalUpdateVersion increment → runExternalContentUpdateEffect).
  function handleRestoreVersion(versionId: string) {
    if (!noteId || !workspace?.id) {
      logger.warn('[RestoreVersion] Cannot restore version: missing noteId or workspace');
      return;
    }

    logger.info('[RestoreVersion] Dispatching restoreNoteVersion', {
      noteId,
      versionId,
      workspaceId: workspace.id,
    });

    // Mark that we're expecting an external update (from the restore operation)
    // This prevents the "newer writes in flight" logic from rejecting the restore
    isUpdatingFromExternal = true;

    // Dispatch to saga — the saga will call notesClient.restoreVersion and
    // dispatch handleExternalNoteUpdate, which flows through the existing
    // external update system to update the editor
    reduxDispatch(restoreNoteVersion(workspace.id, noteId, versionId));

    // Safety: clear flag after timeout in case restore fails or doesn't trigger an update
    setTimeout(() => {
      if (isUpdatingFromExternal) {
        logger.warn('[RestoreVersion] Safety timeout: clearing isUpdatingFromExternal flag');
        isUpdatingFromExternal = false;
      }
    }, 5000);

    // Close the version history view
    showVersionHistory = false;
  }

  // Initialize editor
  async function initializeEditor() {
    if (!element) return;

    let goalContent = '';
    if (noteId && workspace?.id) {
      {
        const storeNote = selectNoteById.select(getReduxStore().getState(), workspace.id, noteId);
        if (storeNote && storeNote.workspaceId === workspace.id) {
          goalContent = storeNote.content || '';
        }
      }
      // Fallback to content prop if note not found in store yet
      // This handles race conditions where the component mounts before the store is fully initialized
      if (!goalContent && content) {
        logger.debug('[NoteWithComments] Using content prop as fallback (note not yet in store)', {
          noteId,
          workspaceId: workspace.id,
          contentPropLength: content.length,
        });
        goalContent = content;
      }
    } else {
      goalContent = content || '';
    }

    // Initialize last known content
    lastKnownContent = goalContent;

    logger.info('[NoteWithComments] initializeEditor: resolving goalContent', {
      noteId,
      workspaceId: workspace?.id,
      goalContentLength: goalContent.length,
      source: goalContent === content ? 'content-prop' : 'redux-store',
      hasElement: !!element,
    });

    // Compute placeholder based on whether this is the spec note and initial spec write is in progress

    // Guard: if content exceeds the safe size limit, show plain text fallback
    // instead of running the expensive markdown processing pipeline
    if (goalContent.length > MAX_NOTE_CONTENT_SIZE) {
      logger.warn(
        '[NoteWithComments] Content exceeds MAX_NOTE_CONTENT_SIZE, using plain text fallback',
        {
          noteId,
          contentLength: goalContent.length,
          limit: MAX_NOTE_CONTENT_SIZE,
        },
      );
      isTooLargeForRichEditor = true;
      plainTextFallbackContent = goalContent;
      isInitializing = false;
      isInitialized = true;
      return;
    }

    isTooLargeForRichEditor = false;

    // Create editor immediately with empty content so the user sees the editor chrome
    // right away instead of a blank screen while markdown processing runs
    const isLargeContent = goalContent.length > 5000;

    const config = createEditorConfig({
      element,
      content: isLargeContent
        ? ''
        : await processMarkdownToHTML(goalContent, { preserveAnchors: true }),
      editable,
      workspace, // Pass workspace for mention support
      onUpdate: () => {
        debounceUpdate();
        // Discover and create TaskMenu popovers for any new task items
        setupTaskMenuPopovers();
        syncTaskAgentAssociations();
      },
      onSelectionUpdate: (selectedText) => {
        // Get the note title from store if available, otherwise use noteId
        const note = noteId
          ? selectNoteById.select(getReduxStore().getState(), workspace.id, noteId)
          : null;
        const noteLabel = note?.title || noteId || 'Note';

        if (selectedText) {
        } else {
          // Deselection is handled below via the custom event dispatch
        }
        // Dispatch custom event with note info for ChatPanel to pick up
        // This handles both selection and deselection (when editor is focused)
        if (typeof window !== 'undefined') {
          dispatchWindowEvent('editor:selection-change', {
            text: selectedText,
            file: noteLabel,
            language: 'markdown',
            source: 'note',
          });
        }
      },
      onSuggestionClick: handleSuggestionClick,
      onCommentClick: (commentId) => {
        logger.info('[NoteWithComments] Comment clicked (V2)', { commentId });
        reduxDispatch(selectCommentAction(commentId));
      },
      onFilePathClick: (filePath, event) => {
        logger.info('[NoteWithComments] File path clicked', { filePath });
        const openInAdjacentPanel = event.metaKey || event.ctrlKey;
        const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
        const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
        const wsId = workspace?.id;
        if (wsId) {
          getReduxStore().dispatch(
            openWorkspaceFile(wsId, filePath, { openInAdjacentPanel, sourcePanelId }),
          );
        }
      },
      useMarkdown: true,
      copySelectionAsMarkdown: true,
      enableComments: showComments,
      enableMentions: true, // Enable mentions in notes
      enableNotePrimitives: true, // Enable note primitives for ws-block support
    });

    editor = new Editor(config);

    logger.debug('[NoteWithComments] Editor created successfully', {
      noteId,
      hasView: !!editor.view,
      isEmpty: editor.isEmpty,
    });

    // For large content: process markdown in background and update the editor
    // This lets the editor appear immediately while heavy processing continues
    if (isLargeContent) {
      const processedContent = await processMarkdownToHTML(goalContent, {
        preserveAnchors: true,
      });
      if (editor && !editor.isDestroyed) {
        // Use requestIdleCallback to defer the heavy setContent call.
        // This gives the browser time to paint the empty editor chrome first,
        // preventing the "frozen" feeling for large notes. The timeout ensures
        // content loads within 300ms even if the browser is busy.
        await new Promise<void>((resolve) => {
          const applyContent = () => {
            if (editor && !editor.isDestroyed) {
              editor.commands.setContent(processedContent, { emitUpdate: false });
              // Re-discover task menu popovers since content changed but onUpdate was suppressed
              setupTaskMenuPopovers();
            }
            resolve();
          };
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(applyContent, { timeout: 300 });
          } else {
            // Fallback for environments without requestIdleCallback
            setTimeout(applyContent, 0);
          }
        });
        logger.debug(
          '[NoteWithComments] Deferred content loaded into editor via requestIdleCallback',
          {
            noteId,
            processedContentLength: processedContent.length,
          },
        );
      }
    }

    // Focus the editor if requested (e.g., when creating a new note)
    if (shouldFocus && editable) {
      // Wait for editor to be fully initialized before focusing
      setTimeout(() => {
        try {
          if (editor && !editor.isDestroyed && editor.view) {
            editor.commands.focus('end');
          }
        } catch {
          // Editor view may not be fully mounted yet - safe to ignore
        }
      }, 100);
    }

    // Add click handler for comment marks (wait for view to be ready)
    cleanupCommentClickHandler?.();
    cleanupCommentClickHandler = showComments
      ? setupCommentMarkClickHandlerV2({
          editor,
          store: getReduxStore(),
          logger,
          noteId,
        })
      : null;

    // Initialize comment manager
    commentManager = await maybeCreateCommentManagerV2({
      showComments,
      workspaceId: workspace?.id,
      noteId,
      editor,
      onContentChanged: createOnCommentManagerContentChangedAfterAnchorInsertion({
        getEditor: () => editor,
        processHTMLToMarkdown,
        getLastSaveTimestamp: () => lastSaveTimestamp,
        getLastKnownContent: () => lastKnownContent,
        setLastKnownContent: (content) => {
          lastKnownContent = content;
        },
        logger,
      }),
    });

    // Restore task-agent associations from persisted Redux state
    if (workspace?.id && noteId) {
      // Small delay to ensure editor is fully ready
      setTimeout(() => {
        if (editor && !editor.isDestroyed) {
          syncTaskAgentAssociations();
        }
      }, 100);
    }

    // Setup event listeners
    cleanupFn = setupEditorListeners({
      editor,
      showSuggestions,
      workspaceId: workspace?.id,
    });

    // Listen for in-note heading navigation requests
    headingScrollHandler = createScrollToHeadingHandler({
      getEditor: () => editor,
      getElement: () => element as any,
    });
    window.addEventListener('note:scroll-to-heading', headingScrollHandler as any);

    // Listen for scroll-to-task requests (from agent task pill clicks)
    taskScrollHandler = createScrollToTaskHandler({
      getEditor: () => editor,
      getElement: () => element as any,
      getNoteId: () => noteId,
      highlightTaskAtPosition,
      logger,
    });
    window.addEventListener('scroll-to-task', taskScrollHandler as any);

    // Set up initial task menu popover management
    setupTaskMenuPopovers();
    // Set up observer for task agent status containers
    taskAgentStatusMountManager.start();

    // Store cleanup function
    const originalCleanup = cleanupFn;
    cleanupFn = () => {
      if (originalCleanup) originalCleanup();
      // Note: spec-comments-updated listeners are now handled in the component-level effect
      if (headingScrollHandler) {
        window.removeEventListener('note:scroll-to-heading', headingScrollHandler as any);
        headingScrollHandler = null;
      }
      if (taskScrollHandler) {
        window.removeEventListener('scroll-to-task', taskScrollHandler as any);
        taskScrollHandler = null;
      }
      cleanupCommentClickHandler?.();
      cleanupCommentClickHandler = null;
      if (editor) {
        editor.destroy();
      }
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
    };
  }

  // Cleanup
  function cleanup() {
    // Flush any pending save BEFORE destroying the editor
    // This prevents data loss when switching to version view or navigating away
    // Must happen before cleanupFn() which destroys the editor
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
      // Save immediately if there might be pending changes
      if (editor && !editor.isDestroyed) {
        saveEditorContent();
      }
    }
    if (userTypingTimeout) {
      clearTimeout(userTypingTimeout);
      userTypingTimeout = null;
    }

    taskAgentStatusMountManager.destroy();

    if (cleanupFn) {
      cleanupFn();
    }

    commentManager = destroyAndClearCommentManagerV2(commentManager);
    if (headingScrollHandler) {
      window.removeEventListener('note:scroll-to-heading', headingScrollHandler as any);
      headingScrollHandler = null;
    }
    if (taskScrollHandler) {
      window.removeEventListener('scroll-to-task', taskScrollHandler as any);
      taskScrollHandler = null;
    }

    cleanupCommentClickHandler?.();
    cleanupCommentClickHandler = null;

    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  }

  // Track last known content to avoid unnecessary updates
  // NOTE: These are NOT $state to avoid triggering reactive loops when updated in effects
  let lastKnownContent: string = '';
  let lastNoteId: string | undefined = undefined;
  let lastSaveTimestamp: string | null = null; // Track when last save happened

  // Non-reactive dedupe guard for the safety-net effect.
  // Tracks the last Redux content snapshot that was already synced to externalUpdateVersion,
  // so the effect doesn't re-fire after its own increment.
  let lastSafetyNetSyncedContent: string | undefined = undefined;

  // Debounce reinitialize to prevent rapid successive calls
  let reinitializeTimeout: ReturnType<typeof setTimeout> | null = null;

  // Watch for note changes and reinitialize editor
  $effect(() => {
    // Read noteId reactively
    const currentNoteId = noteId;

    // Compare with non-reactive lastNoteId
    if (currentNoteId !== lastNoteId) {
      // Clear any pending reinitialize from previous rapid changes
      if (reinitializeTimeout) {
        clearTimeout(reinitializeTimeout);
        reinitializeTimeout = null;
      }

      logger.debug('[NoteWithComments] Note ID changed, scheduling reinitialize', {
        oldNoteId: lastNoteId,
        newNoteId: currentNoteId,
      });

      // Update tracking variables (non-reactive, won't trigger re-runs)
      lastNoteId = currentNoteId;
      lastKnownContent = '';
      hasUserEditedSinceLastSave = false;
      lastSafetyNetSyncedContent = undefined;

      // Clear comments from previous note and reset decorations immediately
      reduxDispatch(clearCommentsAction());
      if (editor) {
        try {
          updateCommentDecorations(editor.view);
        } catch {}
      }

      // Tear down previous comment manager so it doesn't hold stale noteIds
      commentManager = destroyAndClearCommentManagerV2(commentManager);

      // If editor exists and note changed, reinitialize
      if (editor && isInitialized) {
        const newContent = currentNoteContent;

        // Guard: if new note content exceeds the safe size limit, show plain text fallback
        if (newContent.length > MAX_NOTE_CONTENT_SIZE) {
          logger.warn(
            '[NoteWithComments] Switched to note exceeding MAX_NOTE_CONTENT_SIZE, using plain text fallback',
            {
              noteId,
              contentLength: newContent.length,
              limit: MAX_NOTE_CONTENT_SIZE,
            },
          );
          isTooLargeForRichEditor = true;
          plainTextFallbackContent = newContent;
          lastKnownContent = newContent;
          isInitializing = false;
          isUpdatingFromExternal = false;
          return;
        }
        isTooLargeForRichEditor = false;

        isInitializing = true;
        isUpdatingFromExternal = true;

        // Clear the editor and set new content
        processMarkdownToHTML(newContent, {
          preserveAnchors: true,
        }).then(async (newHtmlContent) => {
          if (!editor || editor.isDestroyed) return;

          const onContentChanged = createOnCommentManagerContentChangedUpdateLastKnownContent({
            getEditor: () => editor,
            processHTMLToMarkdown,
            setLastKnownContent: (content) => {
              lastKnownContent = content;
            },
          });

          // Save cursor position before updating
          const cursorPos = editor.state.selection.$head.pos;

          // Mark this as an external update to prevent orphan checks
          const didUpdate = applyExternalUpdateHtmlToEditorPreservingCursor({
            editor,
            html: newHtmlContent,
            cursorPos,
            createTextSelection: TextSelection.create,
            logger,
          });

          lastKnownContent = newContent;

          if (!didUpdate) {
            // Content is the same, no need to update
            commentManager = await maybeCreateCommentManagerV2({
              showComments,
              workspaceId: workspace?.id,
              noteId,
              editor,
              onContentChanged,
            });

            // Ensure flags are cleared even when no update is needed.
            setTimeout(() => {
              isInitializing = false;
              isUpdatingFromExternal = false;
            }, 200);
            return;
          }

          // Restore task-agent associations after note switch
          syncTaskAgentAssociations();

          // After content is set, initialize comment manager for the new note
          commentManager = await maybeCreateCommentManagerV2({
            showComments,
            workspaceId: workspace?.id,
            noteId,
            editor,
            onContentChanged,
          });

          setTimeout(() => {
            isInitializing = false;
            isUpdatingFromExternal = false;
          }, 200);
        });
      }
    }
  });

  // Watch for external content changes and update editor
  $effect(() => {
    const updateVersion = externalUpdateVersion;

    void runExternalContentUpdateEffect({
      updateVersion,
      // CRITICAL: Pass destruction check to prevent async callbacks from accessing
      // reactive state after component destruction, avoiding "N is not a function" errors
      isDestroyed: () => isComponentDestroyed,
      getEditor: () => editor as any,
      getIsInitialized: () => isInitialized,
      getIsUserTyping: () => isUserTyping,
      getCurrentNoteContent: () => currentNoteContent,
      getLastKnownContent: () => lastKnownContent,
      setLastKnownContent: (value) => {
        lastKnownContent = value;
      },
      getHasUserEditedSinceLastSave: () => hasUserEditedSinceLastSave,
      setHasUserEditedSinceLastSave: (value) => {
        hasUserEditedSinceLastSave = value;
      },
      getIsUpdatingFromExternal: () => isUpdatingFromExternal,
      setIsUpdatingFromExternal: (value) => {
        isUpdatingFromExternal = value;
      },
      getWorkspaceId: () => workspace?.id,
      getNoteId: () => noteId,
      getTaskAgentAssociations: () => {
        if (!workspace?.id || !noteId) return [];
        return selectAssociationsForNote.select(getReduxStore().getState(), workspace.id, noteId);
      },
      getCommentManager: () => commentManager,
      processMarkdownToHTML,
      processHTMLToMarkdown,
      createTextSelection: TextSelection.create,
      logger,
    });
  });

  // Safety-net effect: If the CustomEvent mechanism fails to fire,
  // this watches Redux content directly and queues the existing
  // external-update pipeline by incrementing externalUpdateVersion.
  $effect(() => {
    // Read currentNoteContent reactively — this is $derived from the Redux selector
    const reduxContent = currentNoteContent;
    // Also track note identity so we reset when switching notes
    const currentId = noteId;

    if (
      shouldSafetyNetTrigger({
        reduxContent,
        lastKnownContent,
        lastSafetyNetSyncedContent,
        isInitialized,
        isUserTyping,
        hasUserEditedSinceLastSave,
        isUpdatingFromExternal,
      })
    ) {
      logger.info('[NoteWithComments] Safety-net: Redux content diverged from lastKnownContent', {
        noteId: currentId,
        reduxContentLength: reduxContent?.length ?? 0,
        lastKnownContentLength: lastKnownContent?.length ?? 0,
      });

      // Record what we synced so we don't re-fire for the same snapshot
      lastSafetyNetSyncedContent = reduxContent;

      // Queue the existing external-update pipeline
      externalUpdateVersion = externalUpdateVersion + 1;
    }
  });

  // // Watch for editable prop changes and update editor
  // $effect(() => {
  //   // Read editable reactively to trigger effect when it changes
  //   const isEditable = editable;

  //   // Update editor's editable state if editor exists
  //   if (editor && !editor.isDestroyed) {
  //     editor.setEditable(isEditable);
  //     logger.debug('[NoteWithComments] Updated editor editable state', {
  //       noteId,
  //       editable: isEditable,
  //     });
  //   }
  // });

  // Watch for isInitialSpecWriteInProgress changes to update placeholder via data attribute
  // TipTap's Placeholder extension doesn't support dynamic updates, so we use CSS to show
  // different placeholder text based on a data attribute on the editor element
  $effect(() => {
    // Read the prop to track it reactively
    const isWriting = isInitialSpecWriteInProgress;
    const isSpec = noteId ? isSpecNote(noteId) : false;

    // Update editor's data attribute if editor exists and this is the spec note
    if (editor && !editor.isDestroyed && isSpec) {
      const editorElement = editor.view.dom;
      if (editorElement) {
        if (isWriting) {
          editorElement.setAttribute('data-initial-spec-write', 'true');
        } else {
          editorElement.removeAttribute('data-initial-spec-write');
        }
        logger.debug('[NoteWithComments] Updated editor data attribute for placeholder', {
          noteId,
          isInitialSpecWriteInProgress: isWriting,
        });
      }
    }
  });

  // Reactively set spellcheck on the editor element based on user preference
  $effect(() => {
    const isEnabled = $spellcheckEnabled;
    if (editor && !editor.isDestroyed) {
      const editorElement = editor.view.dom;
      if (editorElement) {
        editorElement.setAttribute('spellcheck', String(isEnabled));
      }
    }
  });

  onDestroy(() => {
    // Save scroll position before unmounting
    if (scrollContainer && onScrollPositionSave) {
      onScrollPositionSave(scrollContainer.scrollTop);
    }

    // CRITICAL: Set destruction flag FIRST, before any other cleanup.
    // This prevents async callbacks (like processMarkdownToHTML().then(...))
    // from accessing reactive state after destruction, which would cause
    // "N is not a function" errors in Svelte's reactive system.
    isComponentDestroyed = true;

    taskAgentStatusMountManager.destroy();
    // Clean up reinitialize timeout
    if (reinitializeTimeout) {
      clearTimeout(reinitializeTimeout);
      reinitializeTimeout = null;
    }
  });

  // Lifecycle
  onMount(() => {
    isInitializing = true;

    // Listen for agent deletion events to clean up task assignments
    const handleAgentRemoved = (
      event: CustomEvent<{ agentId: string; noteId: string; workspaceId: string }>,
    ) => {
      const {
        agentId: removedAgentId,
        noteId: removedNoteId,
        workspaceId: removedWorkspaceId,
      } = event.detail;
      // Only handle if this is for our note
      if (
        editor &&
        !editor.isDestroyed &&
        removedNoteId === noteId &&
        removedWorkspaceId === workspace?.id
      ) {
        removeAgentFromTasks(editor, removedAgentId, logger);
      }
    };
    window.addEventListener(AGENT_ASSOCIATIONS_REMOVED_EVENT, handleAgentRemoved as EventListener);

    const handleTaskAssociationChanged = () => {
      syncTaskAgentAssociations();
    };
    window.addEventListener(TASK_ASSOCIATION_CHANGED_EVENT, handleTaskAssociationChanged);

    // Listen for scroll position save requests (before navigation)
    const handleSaveScrollPosition = (
      event: CustomEvent<{ callback: (scrollTop: number) => void }>,
    ) => {
      if (scrollContainer) {
        event.detail.callback(scrollContainer.scrollTop);
      }
    };
    window.addEventListener('note:save-scroll-position', handleSaveScrollPosition as EventListener);

    // Listen for scroll position restore requests (after navigation)
    const handleRestoreScrollPosition = (
      event: CustomEvent<{ scrollPosition: number; noteId?: string }>,
    ) => {
      // Only restore if this is for our note (or no noteId specified)
      if (event.detail.noteId && event.detail.noteId !== noteId) return;

      if (scrollContainer && typeof event.detail.scrollPosition === 'number') {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = event.detail.scrollPosition;
            logger.debug('[NoteWithComments] Restored scroll position', {
              noteId,
              scrollPosition: event.detail.scrollPosition,
            });
          }
        });
      }
    };
    window.addEventListener(
      'note:restore-scroll-position',
      handleRestoreScrollPosition as EventListener,
    );

    // Listen for panel:focus-content events (from panel keyboard navigation)
    const handlePanelFocusContent = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only focus if this event is for our note
      if (detail?.tabType === 'note' && detail?.noteId === noteId) {
        // Focus the editor if it's available and editable
        // Use requestAnimationFrame to ensure DOM is fully updated
        if (editor && !editor.isDestroyed && editable) {
          requestAnimationFrame(() => {
            try {
              if (editor && !editor.isDestroyed && editor.view) {
                editor.view.focus();
                editor.commands.focus('end');
              }
            } catch {
              // Editor view may not be fully mounted yet - safe to ignore
            }
          });
        }
      }
    };
    window.addEventListener('panel:focus-content', handlePanelFocusContent as EventListener);

    // Check for pending scroll position from navigation history or initial prop
    const checkAndRestoreScrollPosition = () => {
      // First, try to restore from initialScrollPosition prop (for tab re-mounting)
      if (typeof initialScrollPosition === 'number' && initialScrollPosition > 0) {
        requestAnimationFrame(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = initialScrollPosition;
            logger.debug('[NoteWithComments] Restored scroll position from prop', {
              noteId,
              scrollPosition: initialScrollPosition,
            });
          }
        });
        return;
      }

      // Fall back to navigation history
      if (!workspace?.id || !noteId) return;

      const navigation = selectWorkspaceNavigationHistory.select(
        getReduxStore().getState(),
        workspace.id,
      );
      // Get the current navigation entry
      const currentEntry = navigation.history[navigation.currentIndex];
      if (
        currentEntry?.type === 'note' &&
        currentEntry.id === noteId &&
        typeof currentEntry.scrollPosition === 'number'
      ) {
        // Wait for DOM to be ready
        requestAnimationFrame(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = currentEntry.scrollPosition!;
            logger.debug('[NoteWithComments] Restored scroll position from navigation history', {
              noteId,
              scrollPosition: currentEntry.scrollPosition,
            });
          }
        });
      }
    };

    // Defer editor initialization to next tick for better perceived performance
    requestAnimationFrame(() => {
      initializeEditor()
        .then(() => {
          // Use requestAnimationFrame instead of setTimeout for smoother transition
          requestAnimationFrame(() => {
            isInitializing = false;
            isInitialized = true;

            // Trigger streaming-in animation when a note was just created
            if (
              noteId &&
              selectNewlyCreatedNoteId.select(getReduxStore().getState(), workspace.id) === noteId
            ) {
              isStreamingIn = true;
              // Clear the store flag so it doesn't re-trigger
              reduxDispatch(clearNewlyCreatedNoteId(workspace.id));
              // Clear the animation flag after the animation completes
              setTimeout(() => {
                isStreamingIn = false;
              }, 900);
            }

            // Check for pending scroll position after editor is fully ready
            checkAndRestoreScrollPosition();

            // IMPORTANT: Check if store content changed while we were initializing
            // This handles the race condition where an agent update arrives during initialization
            // Since externalUpdateVersion may not have been incremented (subscription not ready),
            // we need to manually trigger an update check
            const storeContent = currentNoteContent;
            logger.info('[NoteWithComments] Post-init check', {
              noteId,
              storeContentLength: storeContent?.length ?? 0,
              lastKnownContentLength: lastKnownContent?.length ?? 0,
              storeContentIsUndefined: storeContent === undefined,
              contentsDiffer: storeContent !== lastKnownContent,
            });
            if (storeContent !== undefined && storeContent !== lastKnownContent) {
              logger.info(
                '[NoteWithComments] Store content differs after init, triggering update',
                {
                  noteId,
                  storeContentLength: storeContent.length,
                  lastKnownContentLength: lastKnownContent?.length ?? 0,
                },
              );
              // Increment to trigger the external update effect
              externalUpdateVersion = externalUpdateVersion + 1;
            }

            // Delayed re-check: catches the case where loadWorkspaceNotesSucceeded fires
            // AFTER initializeEditor completes. Redux state may not be populated yet at
            // the instant we check above, so we try again after a short delay.
            const initNoteId = noteId;
            setTimeout(() => {
              if (isComponentDestroyed) return;
              if (noteId !== initNoteId) return; // Note switched, skip
              const delayedContent = currentNoteContent;
              logger.info('[NoteWithComments] Delayed re-check (500ms post-init)', {
                noteId,
                delayedContentLength: delayedContent?.length ?? 0,
                lastKnownContentLength: lastKnownContent?.length ?? 0,
                delayedContentIsUndefined: delayedContent === undefined,
                contentsDiffer: delayedContent !== lastKnownContent,
              });
              if (
                delayedContent !== undefined &&
                delayedContent !== lastKnownContent &&
                !isUserTyping &&
                !hasUserEditedSinceLastSave
              ) {
                logger.info(
                  '[NoteWithComments] Delayed re-check: content diverged, triggering update',
                  {
                    noteId,
                    delayedContentLength: delayedContent.length,
                    lastKnownContentLength: lastKnownContent?.length ?? 0,
                  },
                );
                externalUpdateVersion = externalUpdateVersion + 1;
              }
            }, 500);
          });
        })
        .catch((err) => {
          // Log full error details for debugging
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? err.stack : undefined;
          logger.error('Failed to initialize editor:', {
            error: errorMessage,
            stack: errorStack,
            errorObject: err,
          });
          isInitializing = false;
          isInitialized = true; // Mark as initialized even on error to prevent infinite loading
        });
    });

    return () => {
      window.removeEventListener(
        AGENT_ASSOCIATIONS_REMOVED_EVENT,
        handleAgentRemoved as EventListener,
      );
      window.removeEventListener(TASK_ASSOCIATION_CHANGED_EVENT, handleTaskAssociationChanged);
      window.removeEventListener(
        'note:save-scroll-position',
        handleSaveScrollPosition as EventListener,
      );
      window.removeEventListener(
        'note:restore-scroll-position',
        handleRestoreScrollPosition as EventListener,
      );
      window.removeEventListener('panel:focus-content', handlePanelFocusContent as EventListener);
      cleanup();
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div
  class="workspace-spec-with-comments h-full overflow-hidden flex flex-col px-0 note-font-{$noteFontStyle}"
  role="application"
  aria-label="Space specification editor"
  tabindex="-1"
>
  <!-- Search Bar -->
  {#if showSearch}
    <div
      class="absolute top-2 right-4 z-50 flex items-center gap-2 bg-background border border-border rounded-lg shadow-lg px-3 py-2"
      transition:fade={{ duration: 150 }}
    >
      <Fa icon={faSearch} class="w-3 h-3 text-ghost" />
      <input
        bind:this={searchInputRef}
        bind:value={searchQuery}
        type="text"
        placeholder="Find in note..."
        class="w-48 bg-transparent border-0 text-sm focus:outline-none placeholder:text-muted-foreground/50"
        onkeydown={handleSearchKeydown}
        oninput={handleSearchInput}
      />
      {#if searchQuery}
        <span class="text-xs text-subtle whitespace-nowrap">
          {searchMatchCount > 0 ? `${currentSearchIndex + 1} / ${searchMatchCount}` : 'No matches'}
        </span>
        <button
          type="button"
          class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={() => scrollToMatch(currentSearchIndex - 1)}
          disabled={searchMatchCount === 0}
          title="Previous match (Shift+Enter)"
        >
          <Fa icon={faChevronUp} class="w-3 h-3" />
        </button>
        <button
          type="button"
          class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={() => scrollToMatch(currentSearchIndex + 1)}
          disabled={searchMatchCount === 0}
          title="Next match (Enter)"
        >
          <Fa icon={faChevronDown} class="w-3 h-3" />
        </button>
      {/if}
      <button
        type="button"
        class="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onclick={() => {
          showSearch = false;
          searchQuery = '';
          searchMatchCount = 0;
          clearSearchHighlights();
        }}
      >
        <Fa icon={faTimes} class="w-3 h-3" />
      </button>
    </div>
  {/if}

  <!-- Editor Container -->
  <div class="editor-container flex relative flex-1 overflow-hidden">
    <!-- Version History View -->
    <section
      class="flex-1 pt-6 overflow-y-auto"
      id="version-history-content"
      class:hidden={!showVersionHistory}
    >
      <NoteVersionHistory
        {workspace}
        {noteId}
        currentContent={currentNoteContent}
        visible={showVersionHistory}
        onRestore={handleRestoreVersion}
      />
    </section>

    <!-- Editor Content with relative positioning for comments -->
    <section
      bind:this={scrollContainer}
      class="relative flex-1 pt-6 overflow-y-auto"
      id="editor-content"
      class:hidden={showVersionHistory}
    >
      <!-- Note Metadata Bar (task status, etc.) -->
      {#if currentNote && noteId}
        <NoteMetadataBar workspaceId={workspace.id} note={currentNote} />

        <!-- Code Changes Card (shows files changed by assigned agents) -->
        <NoteCodeChangesCard workspaceId={workspace.id} note={currentNote} />
      {/if}

      <!-- Wrapper for editor and comments that scrolls together -->
      <div
        class="positioning-relative-container relative min-h-full"
        class:with-comments={hasActiveComments}
      >
        <!-- Line Attribution Gutter (PoC) -->
        {#if editor && noteId}
          <LineAttributionGutter
            {editor}
            workspaceId={workspace.id}
            noteId={NoteId(noteId)}
            markdown={currentNoteContent}
          />
        {/if}

        <!-- Loading skeleton shown while editor content is being processed -->
        {#if isInitializing}
          <div class="w-full p-4 space-y-4">
            <Skeleton class="h-8 w-3/4" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-5/6" />
            <Skeleton class="h-4 w-4/5" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-5/6" />
          </div>
        {/if}

        <!-- Plain text fallback for notes that exceed the rich editor size limit -->
        {#if isTooLargeForRichEditor}
          <div class="w-full p-4">
            <div
              class="mb-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-4 py-2 text-sm text-yellow-800 dark:text-yellow-200"
            >
              This note is too large for the rich editor ({Math.round(
                plainTextFallbackContent.length / 1024,
              )}KB). Showing as plain text.
            </div>
            <pre
              class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">{plainTextFallbackContent}</pre>
          </div>
        {/if}

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          bind:this={element}
          class="tiptap-editor-wrapper justify-center pb-32!"
          class:pointer-events-none={!editable}
          class:with-comments={hasActiveComments}
          class:is-dragging={isDragging}
          class:opacity-0={isInitializing || isTooLargeForRichEditor}
          class:absolute={isInitializing || isTooLargeForRichEditor}
          class:invisible={isTooLargeForRichEditor}
          class:streaming-in={isStreamingIn}
          onpaste={handleImagePaste}
          ondrop={handleDrop}
          ondragenter={handleDragEnter}
          ondragleave={handleDragLeave}
          ondragover={handleDragOver}
        ></div>

        <!-- Suggestion Tooltip -->
        {#if selectedSuggestion}
          <SuggestionTooltip
            suggestion={selectedSuggestion}
            x={tooltipPosition.x}
            y={tooltipPosition.y}
            onAccept={() => {
              selectedSuggestion = null;
            }}
            onReject={() => {
              selectedSuggestion = null;
            }}
          />
        {/if}

        <!-- Bubble Menu for formatting and comments -->
        {#if editor}
          <BubbleMenu
            {editor}
            {workspace}
            {noteId}
            onAddComment={handleAddCommentClick}
            onAgentLaunched={(agentData) => onagentlaunched?.(agentData)}
          />
        {/if}

        <!-- Comment Dialog -->
        {#if showCommentDialog}
          <CommentDialog
            x={commentDialogPosition.x}
            y={commentDialogPosition.y}
            onSubmit={handleCommentSubmit}
            onClose={() => (showCommentDialog = false)}
          />
        {/if}

        <!-- Comments Layer (inside scrollable wrapper) -->
        {#if showComments && editor && hasActiveComments && commentManager}
          <CommentsSidebar
            {editor}
            {workspace}
            editorWrapper={element}
            comments={$allComments$}
            onResolve={handleResolveComment}
            onAccept={(id) => reduxDispatch(updateCommentAction(id, { status: 'accepted' }))}
            onReject={(id) => reduxDispatch(updateCommentAction(id, { status: 'rejected' }))}
            onReply={handleReplyToComment}
          />
        {/if}
      </div>

      <!-- Task Menu (moved outside clipping containers) -->
    </section>
  </div>
</div>

<!-- Task Menu Popovers - Rendered based on discovered task buttons -->
{#each taskMenuData as menuData (menuData.id)}
  <TaskMenu
    id={menuData.id}
    anchorName={menuData.anchorName}
    onSelectAction={(action) => handleTaskMenuAction(action, menuData.taskData)}
  />
{/each}

<style>
  .workspace-spec-with-comments {
    background: var(--color-background);
    color: var(--color-text);
  }

  .hidden {
    display: none !important;
  }

  .editor-container {
    background: var(--color-background);
  }

  #editor-content,
  #version-history-content {
    display: flex;
    flex-direction: column;
    overflow-x: hidden;

    /* Container query context so wide elements (images, tables, code blocks)
       can use 100cqw to fill the full editor width beyond the prose column */
    container-type: inline-size;

    /* Shared layout values for content alignment */
    --content-max-width: 60rem;
    --content-gutter-left: 3rem;
  }

  .positioning-relative-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100%;
    align-self: center;
    width: 100%;
    max-width: var(--content-max-width);
    padding-left: var(--content-gutter-left);
    padding-right: var(--content-gutter-left);
  }

  .positioning-relative-container.with-comments {
    max-width: calc(60rem + 2rem + 360px);
  }

  :global(.tiptap-editor-wrapper) {
    display: flex;
    flex-direction: column;
    padding: 0;
    flex-grow: 1;
    width: 100%;
    transition: padding-right 0.3s ease;
  }

  :global(.tiptap-editor-wrapper.with-comments) {
    padding-right: 360px; /* Make room for comments sidebar (320px width + 40px gap) */
  }

  /* Drag and drop visual feedback for images */
  :global(.tiptap-editor-wrapper.is-dragging) {
    outline: 2px dashed hsl(var(--primary));
    outline-offset: -2px;
    background-color: hsl(var(--primary) / 0.05);
  }

  /* Note image styling — enhanced for breakout layout */
  :global(.note-image) {
    max-width: 100%;
    height: auto;
    border-radius: 0.5rem;
    margin: 1.5rem 0;
    /* Subtle shadow for images that break out of text column */
    box-shadow: 0 1px 3px 0 hsl(var(--foreground) / 0.04);
  }

  /* Highlight for comment marks */
  :global(.comment-highlight) {
    cursor: pointer;
    transition: all 0.2s ease;
  }

  :global(.comment-highlight:hover) {
    opacity: 0.8 !important;
  }

  :global(.comment-node) {
    background-color: rgba(255, 193, 7, 0.1);
    border-radius: 4px;
    padding: 2px 4px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  :global(.comment-node:hover) {
    background-color: rgba(255, 193, 7, 0.2);
  }

  :global(.comment-node.selected) {
    background-color: rgba(255, 193, 7, 0.3);
    border: 1px solid rgba(255, 193, 7, 0.5);
  }

  /* Streaming-in reveal animation for newly created notes */
  :global(.tiptap-editor-wrapper.streaming-in) {
    animation: note-stream-in 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *) {
    animation: note-child-fade-up 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  /* Stagger children for a cascading reveal */
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(1)) {
    animation-delay: 0ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(2)) {
    animation-delay: 40ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(3)) {
    animation-delay: 80ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(4)) {
    animation-delay: 120ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(5)) {
    animation-delay: 160ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(6)) {
    animation-delay: 200ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(7)) {
    animation-delay: 240ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(8)) {
    animation-delay: 280ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(9)) {
    animation-delay: 320ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(10)) {
    animation-delay: 360ms;
  }
  :global(.tiptap-editor-wrapper.streaming-in .ProseMirror > *:nth-child(n + 11)) {
    animation-delay: 400ms;
  }

  @keyframes note-stream-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes note-child-fade-up {
    from {
      opacity: 0;
      transform: translateY(8px);
      filter: blur(2px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  /* Flash animation for task highlight when navigating from agent pill */
  :global(.task-highlight-flash) {
    animation: task-flash 2s ease-out;
  }

  @keyframes task-flash {
    0% {
      background-color: rgba(59, 130, 246, 0.3);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
    }
    50% {
      background-color: rgba(59, 130, 246, 0.15);
      box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.3);
    }
    100% {
      background-color: transparent;
      box-shadow: none;
    }
  }

  /* CSS Custom Highlight API styles for search */
  ::highlight(note-search-results) {
    background-color: hsl(var(--primary) / 0.2);
    color: inherit;
  }

  ::highlight(note-current-search-result) {
    background-color: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
</style>
