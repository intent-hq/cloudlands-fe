<script lang="ts">
  import Fa from 'svelte-fa';
  import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
  import { Button } from '$lib/components/ui/button';
  import TipTapEditor from '$lib/components/chat/input/TipTapEditor.svelte';
  import type { Workspace } from '$shared/types';
  import { slide } from 'svelte/transition';
  import InitialsAvatar from './InitialsAvatar.svelte';
  import { faEdit, faCheck, faTimes } from '@fortawesome/free-solid-svg-icons';
  import { processMarkdownToHTML, processHTMLToMarkdown } from '$lib/utils/markdown-processor';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getDispatch } from '$lib/store/utils/utils';
  import { selectCommentById } from '$lib/store/slices/comments/comments-selectors';
  import { updateCommentAction } from '$lib/store/slices/comments/comments-slice';

  const reduxDispatch = getDispatch();

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

  // Helper to check if comment is a session comment with agentId
  // Note: CommentLike is a simplified UI type, so we still need runtime checks
  // The full CommentV2 type uses discriminated unions for compile-time safety
  function isSessionCommentWithAgent(
    comment: CommentLike,
  ): comment is CommentLike & { agentId: string } {
    return comment.type === 'session' && !!comment.agentId;
  }

  interface Props {
    comment: CommentLike;
    workspace?: Workspace;
    isCollapsed?: boolean;
    showTimeline?: boolean;
    isLastInThread?: boolean;
    showActions?: boolean;
    showResolveButton?: boolean;
    showCloseButton?: boolean;
    showType?: boolean;
    onEdit?: () => void;
    onResolve?: () => void;
    onClose?: () => void;
    onDelete?: () => void;
    size?: 'default' | 'compact';
    // External editing state (for coordinated editing like replies)
    externalIsEditing?: boolean;
    externalEditHTML?: string;
    externalEditEditor?: any;
    onBeginEdit?: (commentId: string) => void;
    onSaveEdit?: () => void;
    onCancelEdit?: () => void;
  }

  let {
    comment,
    workspace,
    isCollapsed = false,
    showTimeline = false,
    isLastInThread = true,
    showActions = true,
    showResolveButton = true,
    showCloseButton = false,
    showType = false,
    onEdit,
    onResolve,
    onClose,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onDelete,
    size = 'default',
    externalIsEditing,
    externalEditHTML,
    externalEditEditor = $bindable(),
    onBeginEdit,
    onSaveEdit,
    onCancelEdit,
  }: Props = $props();

  function formatTimestamp(dateStr?: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const days = differenceInDays(new Date(), d);
    return days >= 1 ? format(d, 'MMM d') : formatDistanceToNow(d, { addSuffix: true });
  }

  // Editing state - use external if provided, otherwise internal
  const useExternalEditing = $derived(externalIsEditing !== undefined && onBeginEdit !== undefined);
  let internalIsEditing = $state(false);
  let internalEditEditor: any = $state(null);
  let internalEditHTML = $state('');

  const isEditing = $derived(useExternalEditing ? externalIsEditing : internalIsEditing);

  // For binding, we need to use the actual variable, not a derived
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let currentEditEditor = $derived.by(() => {
    if (useExternalEditing && externalEditEditor) return externalEditEditor;
    return internalEditEditor;
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const currentEditHTML = $derived(
    useExternalEditing ? (externalEditHTML ?? '') : internalEditHTML,
  );

  async function beginEdit() {
    if (useExternalEditing) {
      onBeginEdit?.(comment.id);
    } else {
      internalIsEditing = true;
      const html = await Promise.resolve(
        processMarkdownToHTML(comment.content || '', { allowEmpty: true }),
      );
      internalEditHTML = html || '';
    }
  }

  async function saveEdit() {
    if (useExternalEditing) {
      onSaveEdit?.();
    } else {
      try {
        const html = internalEditEditor?.getHTML?.() ?? '';
        const md = processHTMLToMarkdown(html, { preserveAnchors: false }).trim();
        if (!md) return cancelEdit();
        const v2 = selectCommentById.select(getReduxStore().getState(), comment.id);
        if (v2) {
          reduxDispatch(updateCommentAction(comment.id, { content: md }));
        }
        internalIsEditing = false;
      } catch {
        internalIsEditing = false;
      }
    }
  }

  function cancelEdit() {
    if (useExternalEditing) {
      onCancelEdit?.();
    } else {
      internalIsEditing = false;
      internalEditHTML = '';
    }
  }

  // Expand/collapse long text
  let expanded = $state(false);
  const contentKey = $derived(`${comment.id}:${(comment.content || '').length}`);
  $effect(() => {
    contentKey;
    expanded = false;
  });

  // Rendered HTML and plain-text
  let commentHtml = $state('');
  let commentText = $state('');
  $effect(() => {
    let destroyed = false;
    const content = comment.content || '';
    Promise.resolve(processMarkdownToHTML(content, { allowEmpty: true })).then((h) => {
      if (destroyed) return;
      commentHtml = h || '';
      try {
        const d = document.createElement('div');
        d.innerHTML = commentHtml;
        commentText = (d.textContent || '').trim();
      } catch {
        commentText = content;
      }
    });

    return () => {
      destroyed = true;
    };
  });

  const isCompact = $derived(size === 'compact');
  const authorSize = $derived(isCollapsed || isCompact ? 'text-[13px]' : 'text-sm');
  const timestampSize = $derived(isCollapsed || isCompact ? 'text-xs' : 'text-xs');
  const contentSize = $derived(isCompact ? 'text-[14px]' : 'text-sm');
</script>

<div class="group flex gap-2">
  <!-- Avatar column with timeline -->
  <div class="flex flex-col items-center">
    <InitialsAvatar name={comment.author || '?'} size={24} class="shrink-0" />
    {#if showTimeline && !isLastInThread}
      <div class="w-px bg-border flex-1 mt-2"></div>
    {/if}
  </div>

  <!-- Content column -->
  <div class="flex-1 min-w-0">
    <!-- Header: author, time, actions -->
    <div class="flex items-start justify-between">
      <div
        class="flex items-baseline gap-2 min-w-0"
        class:mt-0.5={!isCollapsed && !isCompact}
        class:mt-1={isCollapsed}
      >
        <span class="font-medium text-foreground truncate {authorSize}"
          >{comment.author || 'Unknown'}</span
        >
        {#if comment.createdAt}
          <span
            class="text-subtle whitespace-nowrap {timestampSize}"
            title={new Date(comment.createdAt).toLocaleString()}
            >{formatTimestamp(comment.createdAt)}</span
          >
        {/if}
        {#if showType && comment.type && comment.type !== 'comment'}
          <span
            class="comment-type-badge px-1.5 py-0.5 text-ui font-mono bg-muted/50 text-subtle"
            title="Comment type"
          >
            {comment.type}
          </span>
        {/if}
      </div>
      {#if showActions && !isCollapsed}
        <div
          class="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto transition-opacity duration-150"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          <!-- Edit -->
          {#if comment.status === 'open'}
            <Button
              variant="ghost-light"
              size="icon-xs"
              aria-label="Edit"
              tooltip="Edit"
              onclick={() => {
                beginEdit();
                onEdit?.();
              }}
            >
              <Fa icon={faEdit} size="xs" />
            </Button>
          {/if}
          <!-- Resolve -->
          {#if showResolveButton && comment.status === 'open'}
            <Button
              variant="ghost-light"
              size="icon-xs"
              aria-label="Resolve"
              tooltip="Resolve"
              onclick={() => onResolve?.()}
            >
              <Fa icon={faCheck} size="xs" />
            </Button>
          {/if}
          <!-- Close/Collapse -->
          {#if showCloseButton && onClose}
            <Button
              variant="ghost-light"
              size="icon-xs"
              aria-label="Collapse"
              tooltip="Collapse"
              onclick={() => onClose?.()}
            >
              <Fa icon={faTimes} size="xs" />
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Comment content -->
    {#if isCollapsed}
      <!-- Collapsed: show truncated text -->
      <p class="text-xs line-clamp-2 whitespace-pre-wrap wrap-break-word">
        {commentText}
      </p>
    {:else if isEditing}
      {#if useExternalEditing}
        <TipTapEditor
          bind:this={externalEditEditor}
          value={externalEditHTML ?? ''}
          placeholder="Edit comment"
          minHeight={60}
          maxHeight={200}
          {workspace}
          onSubmit={() => saveEdit()}
        />
      {:else}
        <TipTapEditor
          bind:this={internalEditEditor}
          value={internalEditHTML}
          placeholder="Edit comment"
          minHeight={60}
          maxHeight={200}
          {workspace}
          onSubmit={() => saveEdit()}
        />
      {/if}
      <div class="flex items-center gap-2 mt-2">
        <Button size="sm" onclick={saveEdit}>Save</Button>
        <Button size="sm" variant="ghost" onclick={cancelEdit}>Cancel</Button>
      </div>
    {:else if (commentText || '').length > 180}
      <div class="text-xs">
        {#if expanded}
          <div class="whitespace-pre-wrap wrap-break-word">
            {@html commentHtml}
          </div>
        {:else}
          <div class="line-clamp-3 whitespace-pre-wrap wrap-break-word">
            {commentText}
          </div>
          <button
            class="block text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
            onclick={() => (expanded = true)}
            type="button">more</button
          >
        {/if}
      </div>
    {:else}
      <div
        class="comment-content {contentSize} leading-snug text-subtle whitespace-pre-wrap wrap-break-word"
        class:leading-relaxed={isCompact}
        class:text-gray-700={isCompact}
      >
        {@html commentHtml}
      </div>
    {/if}

    <!-- Agent link for session comments -->
    {#if isSessionCommentWithAgent(comment)}
      <button
        onclick={(e) => {
          const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
          const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
          const openInAdjacentPanel = e.metaKey || e.ctrlKey;
          window.dispatchEvent(
            new CustomEvent('workspace:open-agent', {
              detail: { agentId: comment.agentId, sourcePanelId, openInAdjacentPanel },
            }),
          );
        }}
        class="mt-2 text-xs text-blue-500 hover:text-blue-600 hover:underline"
        type="button"
      >
        View agent →
      </button>
    {/if}
  </div>
</div>

<style>
  .comment-type-badge {
    position: absolute;
    top: 0;
    right: 0;
    border-bottom-left-radius: 4px;
    border-top-right-radius: 4px;
  }
</style>
