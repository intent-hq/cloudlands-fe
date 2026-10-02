<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';
  let {
    author,
    body,
    date,
    caption,
    url,
    open,
    threaded = false,
  }: {
    threaded?: boolean;
    author: string;
    body: string;
    date?: string | null;
    caption?: string;
    url?: string | null;
    open: (url: string, event?: MouseEvent) => void;
  } = $props();
  let expanded = $state(true);
  let bodyElement: HTMLDivElement;
  let overflowing = $state(false);
  $effect(() => {
    if (!bodyElement) return;
    const observer = new ResizeObserver(() => {
      overflowing = bodyElement.scrollHeight > 192;
    });
    observer.observe(bodyElement);
    return () => observer.disconnect();
  });
</script>

<article
  data-home-pr-comment
  class="min-w-0 overflow-hidden bg-background {threaded ? '' : 'rounded-lg border border-border'}"
>
  <header class="flex min-w-0 items-center gap-2 px-4 pt-4 pb-1 type-caption">
    <span class="flex size-6 shrink-0 items-center justify-center">
      <GitHubAvatar identity={author} size={24} class="rounded-full">
        {#snippet fallback()}<span
            class="flex size-6 items-center justify-center rounded-full bg-muted type-caption"
            >{author.slice(0, 1).toUpperCase()}</span
          >{/snippet}
      </GitHubAvatar>
    </span>
    <span class="truncate font-medium">{author}</span>
    {#if date}
      {#if url}<Button
          variant="ghost"
          size="sm"
          class="h-auto min-w-0 truncate px-0 text-muted-foreground underline underline-offset-2"
          onclick={(event) => url && open(url, event)}><RelativeTime {date} compact /></Button
        >
      {:else}<span class="text-muted-foreground"><RelativeTime {date} compact /></span>{/if}
    {/if}
    {#if url}<Button
        variant="ghost"
        size="icon"
        class="ml-auto size-8 shrink-0"
        aria-label={m.home_integrations_view_comment()}
        title={m.home_integrations_view_comment()}
        onclick={(event) => {
          if (url) open(url, event);
        }}><Fa icon={faArrowUpRightFromSquare} /></Button
      >{/if}
  </header>
  {#if caption}<p
      class="truncate border-b border-border px-3 py-2 text-xs text-muted-foreground"
      title={caption}
    >
      {caption}
    </p>{/if}
  <div
    class="comment-markdown pl-12 pr-4 pb-4"
    class:max-h-48={!expanded}
    class:overflow-hidden={!expanded}
  >
    <div bind:this={bodyElement}>
      <MarkdownViewer
        content={body}
        allowSanitizedHtml
        allowFileMedia={false}
        canOpenFile={() => false}
        renderRichFencesAsCode
      />
    </div>
  </div>
  {#if overflowing}<div class="border-t border-border px-2 py-1">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
        >{expanded ? m.home_integrations_show_less() : m.home_integrations_show_more()}</Button
      >
    </div>{/if}
</article>

<style>
  .comment-markdown :global(.markdown-viewer) {
    font-size: 0.8125rem;
    line-height: 1.5;
  }
  .comment-markdown :global(h1),
  .comment-markdown :global(h2),
  .comment-markdown :global(h3) {
    font-size: 0.875rem;
    line-height: 1.4;
    margin-block: 0.75rem 0.375rem;
  }
  .comment-markdown :global(h1:empty),
  .comment-markdown :global(h2:empty),
  .comment-markdown :global(h3:empty) {
    display: none;
  }
  .comment-markdown :global(p) {
    margin-block: 0.375rem;
  }
</style>
