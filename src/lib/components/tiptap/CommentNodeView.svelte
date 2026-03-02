<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCommentDots,
    faCodePullRequest,
    faSquarePen,
    faCircleQuestion,
    faPaperPlane,
  } from '@fortawesome/free-solid-svg-icons';
  import { formatDistanceToNow } from 'date-fns';

  /**
   * CommentBubble Component
   * Displays a single comment in a bubble format
   * Used by CommentsSidebar and other comment displays
   */

  interface Props {
    commentId: string;
    author?: string;
    type?: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
    content?: string;
    status?: 'open' | 'resolved' | 'accepted' | 'rejected' | 'pending';
    createdAt?: string;
    updatedAt?: string;
    onResolve?: (commentId: string) => void;
    onAccept?: (commentId: string) => void;
    onReject?: (commentId: string) => void;
    onReply?: (commentId: string, replyContent: string) => void;
  }

  let {
    commentId,
    author = 'Unknown',
    type = 'comment',
    content = '',
    status = 'open',
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString(),
    onResolve,
    onAccept,
    onReject,
    onReply,
  }: Props = $props();

  const typeConfig = {
    comment: { label: 'Comment', icon: faCommentDots },
    suggestion: { label: 'Suggestion', icon: faCodePullRequest },
    'change-request': { label: 'Change Request', icon: faSquarePen },
    question: { label: 'Question', icon: faCircleQuestion },
    session: { label: 'Agent Session', icon: faPaperPlane },
  };

  let showReplyBox = $state(false);
  let replyContent = $state('');
  let isDismissed = $state(false);

  const typeInfo = typeConfig[type as keyof typeof typeConfig] || typeConfig.comment;
  const isResolved = status === 'resolved';

  function handleResolve() {
    onResolve?.(commentId);
    // Auto-dismiss after resolve
    setTimeout(() => {
      isDismissed = true;
    }, 300);
  }

  function handleReply() {
    if (replyContent.trim()) {
      // Call the onReply handler if provided
      onReply?.(commentId, replyContent.trim());
      replyContent = '';
      showReplyBox = false;
    }
  }

  function handleAccept() {
    onAccept?.(commentId);
    setTimeout(() => {
      isDismissed = true;
    }, 300);
  }

  function handleReject() {
    onReject?.(commentId);
    setTimeout(() => {
      isDismissed = true;
    }, 300);
  }
</script>

<!-- Comment Bubble -->
{#if !isDismissed}
  <div
    class="comment-bubble p-3 rounded-lg border transition-all {isResolved
      ? 'opacity-60'
      : ''} bg-card border-border text-foreground"
    data-comment-id={commentId}
  >
    <!-- Header -->
    <div class="flex items-baseline gap-2 mb-2">
      <Fa icon={typeInfo.icon} size="sm" class="text-ghost shrink-0" />
      <span class="font-semibold text-sm">{typeInfo.label}</span>
      <span class="text-xs text-subtle">
        {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
      </span>
      {#if isResolved}
        <span class="text-xs font-medium text-success ml-auto">Resolved</span>
      {/if}
    </div>

    <!-- Author -->
    <div class="text-xs text-subtle mb-2">
      {author}
    </div>

    <!-- Content -->
    <p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground mb-3">
      {content}
    </p>

    <!-- Actions -->
    {#if !isResolved}
      <div class="flex flex-wrap gap-2 mt-3">
        {#if type === 'suggestion'}
          <button
            class="text-xs px-3 py-1 rounded bg-success/20 text-success-foreground hover:bg-success/30 transition-colors"
            onclick={handleAccept}
          >
            Accept
          </button>
          <button
            class="text-xs px-3 py-1 rounded bg-destructive/20 text-destructive-foreground hover:bg-destructive/30 transition-colors"
            onclick={handleReject}
          >
            Reject
          </button>
        {/if}

        <button
          class="text-xs px-3 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          onclick={() => (showReplyBox = !showReplyBox)}
        >
          Reply
        </button>
        <button
          class="text-xs px-3 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          onclick={handleResolve}
        >
          Resolve
        </button>
      </div>
    {/if}

    <!-- Reply box (shown on focus/click) -->
    {#if showReplyBox}
      <div class="mt-3 pt-3 border-t border-border space-y-2">
        <textarea
          bind:value={replyContent}
          placeholder="Write a reply..."
          class="w-full p-2 text-xs rounded border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          rows="2"
        ></textarea>
        <div class="flex gap-2">
          <button
            class="text-xs px-3 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
            onclick={handleReply}
          >
            Send
          </button>
          <button
            class="text-xs px-3 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            onclick={() => (showReplyBox = false)}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(.comment-bubble) {
    white-space: normal;
    word-wrap: break-word;
    width: 320px;
    max-width: 90vw;
  }
</style>
