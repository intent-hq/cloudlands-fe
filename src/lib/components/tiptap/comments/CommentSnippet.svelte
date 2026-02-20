<script lang="ts">
  import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
  import InitialsAvatar from './InitialsAvatar.svelte';
  import { processMarkdownToHTML } from '$lib/utils/markdown-processor';
  import { extractTextFromHTML } from '$lib/utils/html-sanitizer';

  type CommentType = 'comment' | 'suggestion' | 'change-request' | 'question' | string;

  interface CommentLike {
    id: string;
    author?: string;
    type?: CommentType;
    content?: string;
    createdAt?: string;
  }

  interface Props {
    comment: CommentLike;
    repliesCount?: number;
    onShow?: () => void;
  }

  let { comment, repliesCount = 0, onShow }: Props = $props();

  let snippetText = $state('');
  $effect(() => {
    let destroyed = false;
    const content = comment.content || '';
    Promise.resolve(processMarkdownToHTML(content, { allowEmpty: true })).then((h) => {
      if (destroyed) return;
      snippetText = extractTextFromHTML(h || '');
    });

    return () => {
      destroyed = true;
    };
  });
</script>

<div class="bg-card rounded-lg px-3 py-2.5 cursor-pointer hover:shadow-sm transition-shadow w-full">
  <div class="flex items-start gap-2">
    <InitialsAvatar name={comment.author || '?'} size={24} class="shrink-0 mt-0.5" />
    <div class="flex-1 min-w-0 mt-1">
      <div class="flex items-baseline gap-2 mb-1">
        <span class="text-[13px] font-medium text-foreground">{comment.author || 'Unknown'}</span>
        {#if comment.createdAt}
          <span
            class="text-[12px] text-muted-foreground"
            title={new Date(comment.createdAt).toLocaleString()}
          >
            {(() => {
              const d = new Date(comment.createdAt);
              return differenceInDays(new Date(), d) >= 1
                ? format(d, 'MMM d')
                : formatDistanceToNow(d, { addSuffix: true });
            })()}
          </span>
        {/if}
      </div>
      <p
        class="text-[14px] leading-relaxed text-foreground/80 line-clamp-2 whitespace-pre-wrap wrap-break-word"
      >
        {snippetText}
      </p>
      {#if repliesCount > 0}
        <button
          class="text-[11px] text-muted-foreground hover:text-foreground mt-1"
          onclick={(e) => {
            e.stopPropagation();
            onShow?.();
          }}
          type="button"
        >
          Show {repliesCount}
          {repliesCount === 1 ? 'reply' : 'replies'}
        </button>
      {/if}
    </div>
  </div>
</div>
