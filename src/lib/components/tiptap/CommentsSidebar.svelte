<script lang="ts">
  import { slide } from 'svelte/transition';
  import ResponsiveCommentThread from './comments/ResponsiveCommentThread.svelte';
  import type { CommentV2 } from '$features/comments/comments-v2.store.svelte';
  import { commentsStoreV2 } from '$features/comments/comments-v2.store.svelte';
  import type { Editor } from '@tiptap/core';
  import { createLogger } from '$lib/utils/client-logger';
  import { findCommentAnchors } from '$lib/components/tiptap/CommentAnchor';

  const logger = createLogger('CommentsSidebar');

  // Use V2 comment type
  type AnyComment = CommentV2;

  import type { Workspace } from '$shared/types';

  interface Props {
    comments: AnyComment[];
    editor?: Editor;
    editorWrapper?: HTMLElement;
    workspace?: Workspace;
    onResolve?: (commentId: string) => void;
    onAccept?: (commentId: string) => void;
    onReject?: (commentId: string) => void;
    onReply?: (commentId: string, content: string) => void;
    onMarkUnread?: (commentId: string) => void;
    onEdit?: (commentId: string) => void;
    onCopyLink?: (commentId: string) => void;
    onDelete?: (commentId: string) => void;
  }

  let {
    comments = [],
    editor,
    editorWrapper,
    workspace,
    onResolve,
    onAccept,
    onReject,
    onReply,
    onMarkUnread,
    onEdit,
    onCopyLink,
    onDelete,
  }: Props = $props();

  // Use a reactive state for reply content, ensuring values are never undefined
  let replyContentStore = $state<Record<string, string>>({});
  let replyInputRefs = $state<Record<string, { focus: () => void }>>({});
  let commentPositions = $state<Record<string, number>>({});
  let orphanedComments = $state<Set<string>>(new Set());
  let selectedCommentId: string | null = $state(null);
  let focusedCommentId: string | null = $state(null);
  let justFocused = false; // Flag to prevent immediate unfocus after focusing
  let displayMode: 'full' | 'compact' | 'icon' = $state('full');

  // Track editor wrapper rect changes for proper positioning
  // Note: wrapperRect is assigned but not read - kept for potential future use
  let _wrapperRect: DOMRect | null = $state(null);
  // Note: currentScrollTop is assigned but not read - kept for potential future use
  let _currentScrollTop = 0;

  // Simple wrapper rect tracking for positioning
  $effect(() => {
    const targetElement = editorWrapper || editor?.view?.dom;

    if (targetElement) {
      const updateRect = () => {
        _wrapperRect = targetElement.getBoundingClientRect();

        // Simple responsive mode based on container width
        const container = targetElement.closest('.workspace-spec-with-comments');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const width = containerRect.width;

          // Simple thresholds for display modes
          if (width < 600) {
            displayMode = 'icon';
          } else if (width < 800) {
            displayMode = 'compact';
          } else {
            displayMode = 'full';
          }

          // Update editor padding based on display mode
          const editorWrapper = targetElement.closest('.tiptap-editor-wrapper');
          if (editorWrapper && editorWrapper instanceof HTMLElement) {
            if (displayMode === 'icon') {
              editorWrapper.style.paddingRight = '80px';
            } else if (displayMode === 'compact') {
              editorWrapper.style.paddingRight = '160px';
            } else {
              editorWrapper.style.paddingRight = '260px';
            }
          }

          // Recalculate positions when display mode changes
          calculateSimplePositions();
        }
      };

      updateRect();

      const resizeObserver = new ResizeObserver(updateRect);
      resizeObserver.observe(targetElement);

      const container = targetElement.closest('.workspace-spec-with-comments');
      if (container) {
        resizeObserver.observe(container);
      }

      return () => {
        resizeObserver.disconnect();
        const editorWrapper = targetElement.closest('.tiptap-editor-wrapper');
        if (editorWrapper && editorWrapper instanceof HTMLElement) {
          editorWrapper.style.paddingRight = '';
        }
      };
    }
  });

  // Note: We removed the effect that recalculated positions when wrapperRect changed
  // because it caused an infinite update loop. Position recalculation now happens
  // only via updateCommentPositions() which is already debounced.

  // Initialize reply content for all comments
  $effect(() => {
    // Ensure all comments have reply content initialized in the store
    comments.forEach((comment) => {
      if (!(comment.id in replyContentStore)) {
        replyContentStore[comment.id] = '';
      }
    });

    // Trigger initial position calculation when comments change
    if (comments.length > 0) {
      updateCommentPositions();
    }
  });
  let isInitialLoad: boolean = $state(true);
  let updatePositionTimer: NodeJS.Timeout | null = null;

  // Filter out resolved comments and replies (replies are shown nested under parent)
  // IMPORTANT: Deduplicate by comment.id to prevent each_key_duplicate errors
  // Even though the store uses Map, this provides defense-in-depth protection
  const activeComments = $derived.by(() => {
    const seen = new Set<string>();
    const result: AnyComment[] = [];
    for (const c of comments) {
      if (c.status !== 'resolved' && !c.parentId && c.id && !seen.has(c.id)) {
        seen.add(c.id);
        result.push(c);
      }
    }
    return result;
  });

  // Helper to get all replies for a comment (including resolved ones for display)
  function getReplies(commentId: string) {
    return comments.filter((c) => c.parentId === commentId);
  }

  let lastCommentId: string | null = $state(null);

  $effect(() => {
    logger.debug('[CommentsSidebar] Comments received', {
      totalComments: comments.length,
      activeComments: activeComments.length,
    });
  });

  // Simple positioning: just move comments down when they overlap
  function calculateSimplePositions() {
    if (!activeComments.length) return;

    const sortedComments = [...activeComments].sort((a, b) => {
      const posA = commentPositions[a.id] || 0;
      const posB = commentPositions[b.id] || 0;
      return posA - posB;
    });

    let lastBottom = 0;
    const minSpacing = 10; // Minimum space between comments
    const collapsedHeight = 47;
    const expandedHeight = 47; // Rough estimate for expanded comments

    sortedComments.forEach((comment) => {
      const basePos = commentPositions[comment.id] || 100;
      const isExpanded = focusedCommentId === comment.id;
      const height = isExpanded ? expandedHeight : collapsedHeight;

      // If this comment would overlap with the previous one, push it down
      const minTop = lastBottom + minSpacing;
      const adjustedPos = Math.max(basePos, minTop + height / 2);

      // Store the adjusted position
      commentPositions[comment.id] = adjustedPos;
      lastBottom = adjustedPos + height / 2;
    });
  }

  // Calculate Y positions for comments based on their highlighted text
  // This needs to update on scroll and editor changes
  function updateCommentPositions() {
    if (!editor || !editor.view) {
      return;
    }

    // Debounce position updates to prevent jittering
    if (updatePositionTimer) {
      clearTimeout(updatePositionTimer);
    }

    updatePositionTimer = setTimeout(
      () => {
        // Double-check that editor view is still available when timeout executes
        if (editor && editor.view) {
          updateCommentPositionsImmediate();
        }
      },
      isInitialLoad ? 300 : 50,
    ); // Longer delay on initial load
  }

  function updateCommentPositionsImmediate() {
    if (!editor || !editor.view) {
      // If editor is not available, position comments in a default stack
      const newPositions: Record<string, number> = {};
      activeComments.forEach((comment, index) => {
        newPositions[comment.id] = 100 + index * 150;
      });
      commentPositions = newPositions;
      orphanedComments = new Set(activeComments.map((c) => c.id));
      return;
    }

    // Try to access the editor DOM element safely
    let editorElement: HTMLElement;
    try {
      editorElement = editor.view.dom;
    } catch (e) {
      logger.debug('[CommentsSidebar] Editor view not available', { error: e });
      // Fallback positioning
      const newPositions: Record<string, number> = {};
      activeComments.forEach((comment, index) => {
        newPositions[comment.id] = 100 + index * 150;
      });
      commentPositions = newPositions;
      orphanedComments = new Set(activeComments.map((c) => c.id));
      return;
    }

    // Additional safety check
    if (!editorElement) {
      // Fallback positioning
      const newPositions: Record<string, number> = {};
      activeComments.forEach((comment, index) => {
        newPositions[comment.id] = 100 + index * 150;
      });
      commentPositions = newPositions;
      orphanedComments = new Set(activeComments.map((c) => c.id));
      return;
    }

    const newPositions: Record<string, number> = {};
    const newOrphaned = new Set<string>();

    // Get the scrollable container to calculate relative positions
    const scrollContainer = editorElement.closest('#editor-content');
    const elementRect = editorElement.getBoundingClientRect();
    const containerRect = scrollContainer?.getBoundingClientRect() || elementRect;

    activeComments.forEach((comment) => {
      const { doc } = editor.state;
      let found = false;

      // Look for anchor nodes (new comment system)
      const anchors = findCommentAnchors(doc, comment.id);

      // Use start position for range comments, or point position for point comments
      // Add 1 to get the position after the anchor node (which has no height)
      const anchorPos =
        anchors.start !== undefined
          ? anchors.start + 1
          : anchors.point !== undefined
            ? anchors.point + 1
            : undefined;

      if (anchorPos !== undefined) {
        try {
          // Check view is available before calling coordsAtPos
          if (!editor.view) {
            throw new Error('Editor view not available');
          }
          const coords = editor.view.coordsAtPos(anchorPos);

          // coordsAtPos returns viewport-relative coordinates
          // For absolute positioning within the scrollable container,
          // we need to add the scroll offset to get the document position
          const scrollTop = scrollContainer?.scrollTop || 0;
          const viewportRelative = coords.top;
          const containerTop = containerRect.top;

          // Calculate position relative to the scrollable container's content
          // This gives us the absolute position within the scrollable area
          const position = viewportRelative - containerTop + scrollTop;

          newPositions[comment.id] = position;
          found = true;
        } catch (e) {
          logger.error('[CommentsSidebar] Position calculation failed', {
            commentId: comment.id,
            error: e,
          });
        }
      }

      if (!found) {
        // Mark as orphaned and position at a default location
        newOrphaned.add(comment.id);
        const index = activeComments.indexOf(comment);
        newPositions[comment.id] = 100 + index * 150; // Stack them vertically
      }
    });

    orphanedComments = newOrphaned;
    commentPositions = newPositions;

    // Recalculate simple positions with overlap detection
    calculateSimplePositions();
  }

  // Setup editor event listeners for position updates (runs once when editor changes)
  $effect(() => {
    if (!editor) return;

    const updateHandler = () => {
      updateCommentPositions();
    };

    // Initial position calculation
    updateCommentPositions();

    editor.on('update', updateHandler);
    editor.on('selectionUpdate', updateHandler);

    return () => {
      editor.off('update', updateHandler);
      editor.off('selectionUpdate', updateHandler);
    };
  });

  // Listen for scroll events on the editor container
  $effect(() => {
    if (!editor || !editor.view) return;

    // Try to access the editor DOM element safely
    let editorElement: HTMLElement;
    try {
      editorElement = editor.view.dom;
    } catch (e) {
      logger.debug('[CommentsSidebar] Editor view not available for scroll listener', { error: e });
      return;
    }

    if (!editorElement) return;

    const editorContainer = editorElement.closest('.overflow-y-auto');
    if (!editorContainer) return;

    const handleScroll = () => {
      // Update the current scroll position
      _currentScrollTop = editorContainer.scrollTop || 0;
      updateCommentPositions();
    };

    // Use requestAnimationFrame for smoother updates
    const throttledScroll = () => {
      requestAnimationFrame(handleScroll);
    };

    editorContainer.addEventListener('scroll', throttledScroll);
    window.addEventListener('resize', throttledScroll);

    return () => {
      editorContainer.removeEventListener('scroll', throttledScroll);
      window.removeEventListener('resize', throttledScroll);
    };
  });

  // Add global event listeners for unfocus behavior
  $effect(() => {
    // Add click outside listener
    document.addEventListener('click', handleClickOutside);

    // Add escape key listener
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  });

  // Track last comment ID (for future use if needed)
  $effect(() => {
    if (activeComments.length > 0) {
      const newestComment = activeComments[activeComments.length - 1];
      if (newestComment.id !== lastCommentId) {
        lastCommentId = newestComment.id;
      }
    }
  });

  // Reset initial load flag after a delay
  $effect(() => {
    if (isInitialLoad && editor) {
      const timer = setTimeout(() => {
        isInitialLoad = false;
        logger.debug('[CommentsSidebar] Initial load complete');
      }, 1500);

      return () => clearTimeout(timer);
    }
  });

  // Watch for selected comment from the store
  $effect(() => {
    const selected = commentsStoreV2.selectedComment?.id ?? null;

    // Only update if the selected comment actually changed
    if (selected && selected !== selectedCommentId) {
      logger.debug('[CommentsSidebar] Store selected comment changed', {
        selected,
        previous: selectedCommentId,
      });

      selectedCommentId = selected;

      // Focus the selected comment
      focusedCommentId = selected;

      // Recalculate positions when focus changes
      calculateSimplePositions();

      // Scroll the comment into view if needed
      setTimeout(() => {
        const element = document.querySelector(`[data-comment-id="${selected}"]`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          logger.debug('[CommentsSidebar] Scrolled comment into view', { selected });
        } else {
          logger.warn('[CommentsSidebar] Could not find element to scroll', { selected });
        }
      }, 100);
    }
  });

  function focusComment(commentId: string) {
    // Only expand, don't collapse on click
    if (focusedCommentId !== commentId) {
      focusedCommentId = commentId;
      justFocused = true;
      // Initialize reply content if it doesn't exist
      if (!(commentId in replyContentStore)) {
        replyContentStore[commentId] = '';
      }

      // After focusing, check if we need to adjust the scroll position
      // to ensure the expanded comment is fully visible
      setTimeout(() => {
        const commentElement = document.querySelector(
          `[data-comment-id="${commentId}"]`,
        ) as HTMLElement;
        const scrollContainer = document.querySelector('#editor-content') as HTMLElement;

        if (commentElement && scrollContainer) {
          const commentRect = commentElement.getBoundingClientRect();
          const containerRect = scrollContainer.getBoundingClientRect();

          // Check if comment is going above the container
          if (commentRect.top < containerRect.top + 10) {
            // Scroll up to make the comment visible
            const scrollAmount = containerRect.top - commentRect.top + 20;
            scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollAmount);
          }
          // Check if comment is going below the container
          else if (commentRect.bottom > containerRect.bottom - 10) {
            // Scroll down to make the comment visible
            const scrollAmount = commentRect.bottom - containerRect.bottom + 20;
            scrollContainer.scrollTop = scrollContainer.scrollTop + scrollAmount;
          }
        }

        // Recalculate positions after potential scroll
        calculateSimplePositions();
      }, 50);

      // Reset the flag after a short delay
      setTimeout(() => {
        justFocused = false;
      }, 100);
    }
    logger.debug('[CommentsSidebar] Focus comment', {
      commentId,
      focused: focusedCommentId === commentId,
    });
  }

  function unfocusComment() {
    if (focusedCommentId) {
      logger.debug('[CommentsSidebar] Unfocusing comment', { commentId: focusedCommentId });
      focusedCommentId = null;
      // Recalculate positions when unfocusing
      calculateSimplePositions();
    }
  }

  // Handle click outside to unfocus
  function handleClickOutside(event: MouseEvent) {
    // Don't unfocus if we just focused a comment
    if (justFocused) {
      return;
    }

    // Check if click is outside any comment card
    const target = event.target as HTMLElement;
    const isInsideComment = target.closest('[data-comment-id]');
    const isInsidePortal = target.closest('.portal-container');

    // Only unfocus if click is outside both comment and portal
    if (!isInsideComment && !isInsidePortal && focusedCommentId) {
      unfocusComment();
    }
  }

  // Handle escape key to unfocus
  function handleEscapeKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && focusedCommentId) {
      event.preventDefault();
      unfocusComment();
    }
  }

  $effect(() => {
    // Focus reply input when its thread is focused
    Object.entries(replyInputRefs).forEach(([id, input]) => {
      if (focusedCommentId === id && input) {
        setTimeout(() => input.focus(), 0);
      }
    });
  });
</script>

<!-- Floating Comments Layer - Uses absolute positioning within scrollable container -->
<div class="comments-container">
  {#each activeComments as comment (comment.id)}
    {#if commentPositions[comment.id] !== undefined}
      {@const replies = getReplies(comment.id)}
      {@const baseTop = commentPositions[comment.id]}
      {@const isFocused = focusedCommentId === comment.id}
      {@const horizontalOffset = isFocused ? -50 : 0}
      <!-- Calculate adjusted top position to prevent overflow -->
      {@const adjustedTop = (() => {
        if (isFocused) {
          // When focused/expanded, ensure the comment doesn't go above viewport
          // Keep a minimum of 10px from the top
          return Math.max(10, baseTop - 20);
        } else {
          // When collapsed, center on the anchor point
          return baseTop - 20;
        }
      })()}

      <!-- Position comments absolutely within the container -->
      <div
        class="absolute pointer-events-auto outline-none focus:outline-none bg-background comment-thread-container"
        class:w-auto={displayMode === 'icon' || displayMode === 'compact'}
        class:w-64={displayMode === 'compact'}
        class:w-68={displayMode === 'full'}
        class:is-focused={isFocused}
        style="top: {adjustedTop}px; right: {-10 - horizontalOffset}px; z-index: {isFocused
          ? 20
          : 10}; transition: right 0.3s ease-in-out, top 0.3s ease-in-out;"
        role="button"
        tabindex="0"
        data-comment-id={comment.id}
        onkeydown={(e) => {
          // Only handle when this container itself has focus, not child elements
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focusComment(comment.id);
          }
        }}
        onclick={(e) => {
          e.stopPropagation();
          // Only focus if not already focused (to expand collapsed comments)
          if (focusedCommentId !== comment.id) {
            focusComment(comment.id);
          }
        }}
      >
        <div transition:slide={{ axis: 'y', duration: 200 }}>
          <ResponsiveCommentThread
            {comment}
            {replies}
            {displayMode}
            isCollapsed={focusedCommentId !== comment.id}
            orphaned={orphanedComments.has(comment.id)}
            focused={focusedCommentId === comment.id}
            depth={0}
            offset={0}
            hasConnectionLine={false}
            replyValue={replyContentStore[comment.id] || ''}
            onReplyValueChange={(value) => {
              replyContentStore[comment.id] = value;
            }}
            onShow={() => focusComment(comment.id)}
            onClose={() => (focusedCommentId = null)}
            onReply={(content) => {
              onReply?.(comment.id, content);
              // Clear the reply content after sending
              replyContentStore[comment.id] = '';
            }}
            onAccept={() => onAccept?.(comment.id)}
            onReject={() => onReject?.(comment.id)}
            onResolve={() => onResolve?.(comment.id)}
            onMarkUnread={() => onMarkUnread?.(comment.id)}
            onEdit={() => onEdit?.(comment.id)}
            onCopyLink={() => onCopyLink?.(comment.id)}
            onDelete={() => onDelete?.(comment.id)}
            registerReplyInput={(el) => (replyInputRefs[comment.id] = el)}
            {workspace}
          />
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* Container for absolutely positioned comments */
  .comments-container {
    position: absolute;
    top: 0;
    right: 0;
    pointer-events: none;
    z-index: 10;
  }

  .comments-container > * {
    pointer-events: auto;
  }

  :global(.line-clamp-2) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Responsive comment animations */
  :global(.comment-thread-container) {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Constrain expanded comments to prevent overflow */
  :global(.comment-thread-container.is-focused) {
    max-height: calc(100vh - 80px);
    overflow: visible;
  }

  /* Responsive breakpoints for comment display */
  @media (max-width: 768px) {
    :global(.comment-thread-container.full-mode) {
      max-width: 260px !important;
    }
  }

  @media (max-width: 640px) {
    :global(.comment-thread-container.full-mode) {
      max-width: 160px !important;
    }
  }

  @media (max-width: 480px) {
    :global(.comment-thread-container.full-mode) {
      max-width: 200px !important;
    }
  }
</style>
