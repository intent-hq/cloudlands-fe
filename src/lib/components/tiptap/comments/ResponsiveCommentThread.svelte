<script lang="ts">
  import Fa from 'svelte-fa';
  import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
  import { Button } from '$lib/components/ui/button';
  import type { Workspace } from '$shared/types';
  import { slide, fade } from 'svelte/transition';
  import { spring } from 'svelte/motion';
  import InitialsAvatar from './InitialsAvatar.svelte';
  import UnifiedCommentThread from './UnifiedCommentThread.svelte';
  import {
    faComment,
    faCheck,
    faEdit,
    faTimes,
    faReply,
    faEllipsisV,
    faLightbulb,
    faExclamationTriangle,
    faCircleQuestion,
    faPaperPlane,
  } from '@fortawesome/free-solid-svg-icons';
  
// Type definitions
  interface CommentLike {
    id: string;
    author?: string;
    content?: string;
    createdAt?: string;
    status?: 'open' | 'resolved' | 'accepted' | 'rejected' | string;
    type?: CommentType;
    agentId?: string;
  }

  type CommentType = 'comment' | 'suggestion' | 'change-request' | 'question' | 'session' | string;
  type DisplayMode = 'full' | 'compact' | 'icon';

  // Helper to check if comment is a session comment with agentId

  interface Props {
    comment: CommentLike;
    replies?: CommentLike[];
    displayMode?: DisplayMode;
    orphaned?: boolean;
    focused?: boolean;
    isCollapsed?: boolean;
    depth?: number; // Stacking depth for overlapping comments
    offset?: number; // Horizontal offset for stacking
    hasConnectionLine?: boolean;
    replyValue?: string;
    onReplyValueChange?: (value: string) => void;
    onReply?: (content: string) => void;
    onAccept?: () => void;
    onReject?: () => void;
    onResolve?: () => void;
    onMarkUnread?: () => void;
    onEdit?: () => void;
    onCopyLink?: () => void;
    onDelete?: () => void;
    onShow?: () => void;
    onClose?: () => void;
    registerReplyInput?: (el: any) => void;
    workspace?: Workspace;
  }

  let {
    comment,
    replies = [],
    displayMode = 'full',
    orphaned = false,
    focused = false,
    isCollapsed = false,
    depth = 0,
    offset = 0,
    hasConnectionLine = false,
    replyValue = '',
    onReplyValueChange,
    onReply,
    onAccept,
    onReject,
    onResolve,
    onMarkUnread,
    onEdit,
    onCopyLink,
    onDelete,
    onShow,
    onClose,
    registerReplyInput,
    workspace,
  }: Props = $props();

  // Container width detection for responsive mode
  let containerEl: HTMLElement;
  let containerWidth = $state(400);

  // Auto-detect display mode based on container width
  let autoDisplayMode = $derived.by(() => {
    if (containerWidth < 200) return 'icon';
    if (containerWidth < 320) return 'compact';
    return 'full';
  });

  // Use the provided displayMode directly - parent component handles responsive behavior
  let effectiveDisplayMode = $derived(displayMode || autoDisplayMode);

  // Observe container width
  $effect(() => {
    if (!containerEl) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth = entry.contentRect.width;
      }
    });

    observer.observe(containerEl);

    return () => observer.disconnect();
  });

  // Animation for position changes
  const position = spring(
    { x: offset, y: 0 },
    {
      stiffness: 0.2,
      damping: 0.8,
    },
  );

  $effect(() => {
    position.set({ x: offset, y: 0 });
  });

  // Hide hover card when focused changes
  $effect(() => {
    if (focused) {
      showHoverCard = false;
      clearTimeout(hoverTimeout);
    }
  });

  function formatTimestamp(dateStr?: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const days = differenceInDays(new Date(), d);
    return days >= 1 ? format(d, 'MMM d') : formatDistanceToNow(d, { addSuffix: true });
  }

  // Truncate content for tooltips
  function truncateContent(text: string, maxLength = 100): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  // Get comment type icon
  function getCommentIcon(type?: CommentType) {
    switch (type) {
      case 'suggestion':
        return faLightbulb;
      case 'change-request':
        return faEdit;
      case 'question':
        return faCircleQuestion;
      case 'issue':
        return faExclamationTriangle;
      case 'session':
        return faPaperPlane;
      default:
        return faComment;
    }
  }

  // Get comment type color class
  function getCommentColor(type?: CommentType, status?: string) {
    if (status === 'resolved') return 'type-resolved';
    if (status === 'accepted') return 'type-accepted';
    if (status === 'rejected') return 'type-rejected';

    switch (type) {
      case 'suggestion':
        return 'type-suggestion';
      case 'change-request':
        return 'type-change-request';
      case 'question':
        return 'type-question';
      case 'issue':
        return 'type-issue';
      default:
        return 'type-comment';
    }
  }

  let showHoverCard = $state(false);
  let hoverTimeout: NodeJS.Timeout;

  function handleMouseEnter() {
    if (effectiveDisplayMode === 'icon' && !focused) {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        showHoverCard = true;
      }, 300);
    }
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimeout);
    if (effectiveDisplayMode === 'icon' && !focused) {
      hoverTimeout = setTimeout(() => {
        showHoverCard = false;
      }, 200);
    }
  }
</script>

<div
  bind:this={containerEl}
  class="comment-thread-container"
  class:icon-mode={effectiveDisplayMode === 'icon'}
  class:compact-mode={effectiveDisplayMode === 'compact'}
  class:full-mode={effectiveDisplayMode === 'full'}
  class:focused
  class:collapsed={isCollapsed && effectiveDisplayMode !== 'icon'}
  style="transform: translateX({$position.x}px); z-index: {10 - depth};"
  role="group"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
>
  {#if hasConnectionLine}
    <div class="connection-line" transition:fade={{ duration: 200 }}></div>
  {/if}

  {#if effectiveDisplayMode === 'icon' && !focused}
    <!-- Icon-only mode when not focused -->
    <button
      class="icon-button {getCommentColor(comment.type, comment.status)}"
      class:has-replies={replies.length > 0}
      onclick={() => onShow?.()}
      aria-label="{comment.author}: {truncateContent(comment.content || '')}"
    >
      <div class="icon-wrapper">
        <Fa icon={getCommentIcon(comment.type)} size="sm" />
        {#if replies.length > 0}
          <span class="reply-badge">{replies.length}</span>
        {/if}
      </div>
    </button>

    <!-- Hover card for icon mode -->
    {#if showHoverCard}
      <div
        class="hover-card"
        transition:slide={{ axis: 'x', duration: 200 }}
        role="group"
        onmouseenter={() => clearTimeout(hoverTimeout)}
        onmouseleave={handleMouseLeave}
      >
        <div class="hover-card-header">
          <InitialsAvatar name={comment.author || '?'} size={20} />
          <span class="author">{comment.author}</span>
          <span class="timestamp">{formatTimestamp(comment.createdAt)}</span>
        </div>
        <div class="hover-card-content">
          <div class="hover-message-text">
            {truncateContent(comment.content || '', 150)}
          </div>
        </div>
        {#if replies.length > 0}
          <div class="hover-card-footer">
            {replies.length}
            {replies.length === 1 ? 'reply' : 'replies'}
          </div>
        {/if}
      </div>
    {/if}
  {:else if effectiveDisplayMode === 'compact' && !focused}
    <!-- Compact mode -->
    <div
      class="compact-container {getCommentColor(comment.type, comment.status)}"
      role="button"
      tabindex="0"
      onclick={() => !focused && onShow?.()}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          !focused && onShow?.();
        }
      }}
    >
      <div class="compact-header">
        <InitialsAvatar name={comment.author || '?'} size={20} />
        <span class="compact-author">{comment.author}</span>
        {#if !focused}
          <Button
            variant="ghost-light"
            size="icon-xs"
            onclick={(e) => {
              e.stopPropagation();
              onShow?.();
            }}
          >
            <Fa icon={faEllipsisV} size="xs" />
          </Button>
        {/if}
      </div>

      <div class="compact-content">
        {#if focused}
          <div class="full-text">{comment.content}</div>
          <div class="compact-actions">
            <Button size="xs" variant="ghost" onclick={() => onResolve?.()}>
              <Fa icon={faCheck} size="xs" /> Resolve
            </Button>
            <Button size="xs" variant="ghost" onclick={() => onClose?.()}>
              <Fa icon={faTimes} size="xs" />
            </Button>
          </div>
        {:else}
          <div class="truncated-text">
            {truncateContent(comment.content || '', 60)}
          </div>
        {/if}
      </div>

      {#if replies.length > 0 && !focused}
        <div class="compact-replies">
          <Fa icon={faReply} size="xs" />
          <span>{replies.length}</span>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Full mode OR focused in icon/compact mode - use UnifiedCommentThread -->
    <UnifiedCommentThread
      {comment}
      {replies}
      {isCollapsed}
      {orphaned}
      {focused}
      {replyValue}
      {onReplyValueChange}
      {onShow}
      {onClose}
      {onReply}
      {onAccept}
      {onReject}
      {onResolve}
      {onMarkUnread}
      {onEdit}
      {onCopyLink}
      {onDelete}
      {registerReplyInput}
      {workspace}
    />
  {/if}

  {#if depth > 0}
    <div class="depth-indicator" style="opacity: {0.3 + depth * 0.2}">
      {depth}
    </div>
  {/if}
</div>

<style>
  .comment-thread-container {
    position: relative;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Icon mode styles - Clean and minimal */
  .icon-mode {
    width: 36px;
    height: 36px;
  }

  .icon-button {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--background);
    border: 2px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .icon-button:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    border-color: var(--primary);
  }

  .icon-button.orphaned {
    opacity: 0.6;
    border-style: dashed;
  }

  .icon-button.resolved {
    background: var(--success-bg, #f0f9ff);
    border-color: var(--success, #10b981);
  }

  .icon-button.has-replies::after {
    content: '';
    position: absolute;
    top: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    background: var(--primary);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--background);
  }

  .reply-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--primary);
    color: white;
    font-size: 11px;
    min-width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border-radius: 8px;
    font-weight: 600;
    box-shadow: 0 0 0 2px var(--background);
  }

  /* Hover card styles - Elegant and informative */
  .hover-card {
    position: absolute;
    right: calc(100% + 10px);
    top: -4px;
    width: 280px;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 1000;
    backdrop-filter: blur(10px);
    pointer-events: all;
  }

  .hover-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }

  .hover-card-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hover-card-header .author {
    font-weight: 600;
    font-size: 13px;
    color: var(--foreground);
  }

  .hover-card-header .timestamp {
    font-size: 11px;
    color: var(--muted-foreground);
    opacity: 0.7;
  }

  .hover-card-header .timestamp {
    font-size: 11px;
    color: var(--muted-foreground);
    margin-left: auto;
  }

  .hover-card-content {
    font-size: 12px;
    line-height: 1.5;
    color: var(--foreground);
  }

  .hover-message-text {
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
    white-space: pre-wrap;
  }

  .hover-card-footer {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted-foreground);
  }

  /* Compact mode styles */
  .compact-container {
    background: var(--background);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    width: 100%;
    min-width: 180px;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .compact-container:hover {
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
  }

  .compact-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .compact-author {
    font-size: 12px;
    font-weight: 500;
    flex: 1;
  }

  .compact-content {
    font-size: 11px;
    line-height: 1.4;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
    white-space: pre-wrap;
  }

  .truncated-text {
    color: var(--muted-foreground);
  }

  .compact-replies {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted-foreground);
  }

  .compact-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }

  /* Connection line for displaced comments */
  .connection-line {
    position: absolute;
    left: -20px;
    top: 50%;
    width: 20px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--border));
  }

  .connection-line::before {
    content: '';
    position: absolute;
    left: 0;
    top: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--border);
  }

  /* Depth indicator */
  .depth-indicator {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 16px;
    height: 16px;
    background: var(--muted);
    color: var(--muted-foreground);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: bold;
  }

  /* Focus and collapse states */
  .focused {
    width: 300px;
    max-width: 300px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    z-index: 20 !important;
  }

  .collapsed:not(.icon-mode) {
    opacity: 0.8;
  }

  /* Comment type-specific colors */
  .type-suggestion {
    --type-color: #3b82f6;
    --type-bg: #eff6ff;
    --type-border: #93c5fd;
  }

  .type-change-request {
    --type-color: #f97316;
    --type-bg: #fff7ed;
    --type-border: #fdba74;
  }

  .type-question {
    --type-color: #a855f7;
    --type-bg: #faf5ff;
    --type-border: #d8b4fe;
  }

  .type-issue {
    --type-color: #ef4444;
    --type-bg: #fef2f2;
    --type-border: #fca5a5;
  }

  .type-session {
    --type-color: #0ea5e9;
    --type-bg: #f0f9ff;
    --type-border: #7dd3fc;
  }

  /* Apply type colors to components */
  .icon-button.type-suggestion,
  .icon-button.type-change-request,
  .icon-button.type-question,
  .icon-button.type-issue {
    /* background: var(--type-bg); */
    border-color: var(--type-border);
  }

  .icon-button .icon-wrapper {
    color: var(--type-color, var(--foreground));
  }

  .compact-container.type-suggestion,
  .compact-container.type-change-request,
  .compact-container.type-question,
  .compact-container.type-issue {
    /* background: var(--type-bg); */
    border-color: var(--type-border);
  }
</style>
