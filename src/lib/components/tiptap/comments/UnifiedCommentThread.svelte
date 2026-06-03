<script lang="ts">
  import {
  faArrowUp,
  faAt,
  faPaperclip,
} from '@fortawesome/free-solid-svg-icons';
  import AgentPeekCard from './AgentPeekCard.svelte';
  import Comment from './Comment.svelte';
  import Fa from 'svelte-fa';
  import InitialsAvatar from './InitialsAvatar.svelte';
  import TipTapEditor from '$lib/components/chat/input/TipTapEditor.svelte';
  import type { Workspace } from '$shared/types';
  import { Button } from '$lib/components/ui/button';
  import { slide } from 'svelte/transition';

  import {
  processMarkdownToHTML,
  processHTMLToMarkdown,
} from '$lib/utils/markdown-processor';

  import { selectCommentById } from '$store/renderer/slices/comments/comments-selectors';
  import { updateCommentAction } from '$store/renderer/slices/comments/comments-slice';
  import { store as appStore } from '$store/renderer/store';

  type CommentType = 'comment' | 'suggestion' | 'change-request' | 'question' | string;

  interface CommentLike {
    id: string;
    author?: string;
    type?: CommentType;
    content?: string;
    createdAt?: string;
    status?: 'open' | 'resolved' | 'accepted' | 'rejected' | string;
    agentId?: string;
  }

  interface ReplyLike extends CommentLike {}

  // Helper to check if comment is a session comment with agentId
  function isSessionCommentWithAgent(
    comment: CommentLike,
  ): comment is CommentLike & { agentId: string } {
    return comment.type === 'session' && !!comment.agentId;
  }

  interface Props {
    comment: CommentLike;
    replies?: ReplyLike[];
    orphaned?: boolean;
    focused?: boolean;
    isCollapsed?: boolean;
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
    registerReplyInput?: (el: { focus: () => void }) => void;
    workspace?: Workspace;
    showType?: boolean;
  }

  let {
    comment,
    replies = [],
    orphaned = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    focused = false,
    isCollapsed = false,
    replyValue = '',
    onReplyValueChange,
    onReply,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onAccept,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onReject,
    onResolve,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onMarkUnread,
    onEdit,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onCopyLink,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDelete,
    onShow,
    onClose,
    registerReplyInput,
    workspace,
    showType = true,
  }: Props = $props();

  let replyEditor: any = $state(null);
  $effect(() => {
    if (replyEditor && registerReplyInput) {
      registerReplyInput(replyEditor);
    }
  });

  // Editing a reply
  let editingReplyId: string | null = $state(null);
  let replyEditEditor: any = $state(null);
  let replyEditHTML = $state('');

  async function beginEditReply(replyId: string) {
    editingReplyId = replyId;
    const reply = replies.find((r) => r.id === replyId);
    const html = await Promise.resolve(
      processMarkdownToHTML(reply?.content || '', { allowEmpty: true }),
    );
    replyEditHTML = html || '';
  }

  async function saveEditReply() {
    const id = editingReplyId;
    if (!id) return cancelEditReply();
    try {
      const html = replyEditEditor?.getHTML?.() ?? '';
      const md = processHTMLToMarkdown(html, { preserveAnchors: false }).trim();
      if (!md) return cancelEditReply();
      const v2 = selectCommentById.select(appStore.state, id);
      if (v2) {
        appStore.dispatch(updateCommentAction(id, { content: md }));
      }
    } finally {
      editingReplyId = null;
      replyEditHTML = '';
      replyEditEditor = null;
    }
  }

  function cancelEditReply() {
    editingReplyId = null;
    replyEditHTML = '';
    replyEditEditor = null;
  }

  // Rendered HTML and plain-text for truncation
  $effect(() => {
    let destroyed = false;
    const content = comment.content || '';
    Promise.resolve(processMarkdownToHTML(content, { allowEmpty: true })).then((h) => {
      if (destroyed) return;
      try {
        const d = document.createElement('div');
        d.innerHTML = h || '';
      } catch {}
    });

    return () => {
      destroyed = true;
    };
  });

  // Reply HTML cache per reply.id
  let replyHtmls = $state<Record<string, string>>({});
  $effect(() => {
    let destroyed = false;
    replies?.forEach((r) => {
      Promise.resolve(processMarkdownToHTML(r.content || '', { allowEmpty: true })).then((h) => {
        if (destroyed) return;
        replyHtmls[r.id] = h || '';
      });
    });

    return () => {
      destroyed = true;
    };
  });
  async function submitReply() {
    const text = replyValue?.trim();
    if (!text) return;
    try {
      const html = replyEditor?.getHTML?.() ?? '';
      const md = processHTMLToMarkdown(html, { preserveAnchors: false });
      const out = (md || text).trim();
      if (out) onReply?.(out);
    } finally {
      onReplyValueChange?.('');
      replyEditor?.clear?.();
    }
  }
</script>

<!-- Check if this is a session comment with agent -->
{#if isSessionCommentWithAgent(comment)}
  <!-- Use AgentPeekCard for session comments -->
  <AgentPeekCard agentId={comment.agentId} {isCollapsed} commentCreatedAt={comment.createdAt} />
{:else}
  <!-- Unified container with consistent styling -->
  <div
    class="flex flex-col bg-background rounded w-full transition-all duration-200 border border-border"
    class:max-w-[380px]={!isCollapsed}
    class:max-h-[400px]={!isCollapsed}
    class:overflow-hidden={!isCollapsed}
    class:cursor-pointer={isCollapsed}
  >
    <!-- Main content area -->
    <div
      class="px-1.5 py-1.5"
      class:py-2={!isCollapsed}
      class:pb-1={!isCollapsed}
      class:flex-1={!isCollapsed}
      class:overflow-y-auto={!isCollapsed}
      class:custom-scrollbar={!isCollapsed}
    >
      <!-- Main comment with consistent structure -->
      <Comment
        {comment}
        {workspace}
        {isCollapsed}
        showTimeline={!isCollapsed && replies.length > 0}
        showActions={true}
        showResolveButton={true}
        showCloseButton={!!onClose}
        {showType}
        {onEdit}
        {onResolve}
        {onClose}
      />

      <!-- Show replies count in collapsed state -->
      {#if isCollapsed && replies.length > 0}
        <div class="ml-8">
          <button
            class="text-ui text-muted-foreground hover:text-foreground mt-1"
            onclick={(e) => {
              e.stopPropagation();
              onShow?.();
            }}
            type="button"
          >
            Show {replies.length}
            {replies.length === 1 ? 'reply' : 'replies'}
          </button>
        </div>
      {/if}

      {#if orphaned && !isCollapsed}
        <div class="ml-8">
          <span
            class="text-xs text-amber-600 mt-1 inline-block"
            title="Comment text not found in document">(unlinked)</span
          >
        </div>
      {/if}

      <!-- Replies (only shown when expanded) -->
      {#if !isCollapsed && replies.length > 0}
        <div class="pt-1.5 flex flex-col gap-1.5" transition:slide={{ axis: 'y', duration: 200 }}>
          {#each replies as reply, index (reply.id)}
            <div transition:slide={{ axis: 'y', duration: 200 }}>
              <Comment
                comment={reply}
                {workspace}
                showTimeline={true}
                isLastInThread={index === replies.length - 1}
                showActions={true}
                showResolveButton={false}
                showCloseButton={false}
                {showType}
                size="compact"
                externalIsEditing={editingReplyId === reply.id}
                externalEditHTML={replyEditHTML}
                bind:externalEditEditor={replyEditEditor}
                onBeginEdit={(id) => beginEditReply(id)}
                onSaveEdit={saveEditReply}
                onCancelEdit={cancelEditReply}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Footer: reply row (only shown when expanded) -->
    {#if !isCollapsed}
      <div
        class="px-3 py-1.5 border-t border-border"
        transition:slide={{ axis: 'y', duration: 200 }}
      >
        <div class="flex items-center gap-px">
          <InitialsAvatar name="A" size={24} class="shrink-0" />
          <div class="flex-1 rounded px-1 py-1">
            <TipTapEditor
              bind:this={replyEditor}
              value={replyValue}
              placeholder="Reply..."
              minHeight={32}
              maxHeight={160}
              {workspace}
              onUpdate={(text) => onReplyValueChange?.(text)}
              onSubmit={() => submitReply()}
            />
          </div>
          <Button variant="ghost-light" size="icon-sm" tooltip="Attach">
            <Fa icon={faPaperclip} size="sm" class="text-ghost" />
          </Button>
          <Button
            variant="ghost-light"
            size="icon-sm"
            tooltip="Mention"
            onclick={() => replyEditor?.insertAtSymbol?.()}
          >
            <Fa icon={faAt} size="sm" class="text-ghost" />
          </Button>
          <Button
            variant="ghost-light"
            size="icon-sm"
            class="rounded-full bg-muted text-foreground hover:bg-muted/80"
            tooltip="Send"
            onclick={() => submitReply()}
          >
            <Fa icon={faArrowUp} size="sm" />
          </Button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  :global(.comment-content p) {
    margin: 0;
  }
  :global(.comment-content ul),
  :global(.comment-content ol) {
    margin: 0;
  }

  /* Remove focus outline from TipTap editor in reply input */
  :global(.bg-gray-50\/50 .ProseMirror:focus) {
    outline: none !important;
  }

  :global(.bg-gray-50\/50 .ProseMirror) {
    padding: 0;
  }

  :global(.line-clamp-2) {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :global(.line-clamp-3) {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Custom scrollbar for comment content */
  :global(.custom-scrollbar) {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-thumb) {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }

  :global(.custom-scrollbar::-webkit-scrollbar-thumb:hover) {
    background-color: rgba(0, 0, 0, 0.3);
  }

  /* Dark mode scrollbar */
  :global(.dark .custom-scrollbar) {
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  :global(.dark .custom-scrollbar::-webkit-scrollbar-thumb) {
    background-color: rgba(255, 255, 255, 0.2);
  }

  :global(.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover) {
    background-color: rgba(255, 255, 255, 0.3);
  }
</style>
