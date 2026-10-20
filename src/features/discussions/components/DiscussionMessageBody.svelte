<script lang="ts">
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import type { DiscussionAgentMention } from '../discussion-agent-mentions';
  import { discussionMessageParts, discussionMessageMarkdown } from '../discussion-message-content';
  import Fa from 'svelte-fa';
  import { faRobot, faFileLines, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { parseDiscussionReference, type DiscussionReference } from '../discussion-references';
  import { openDiscussionReference } from '../discussion-reference-navigation';
  let {
    body,
    workspaceId,
    sourcePanelId,
    mode = 'inline',
    agentMentions = [],
  }: {
    body: string;
    workspaceId: string;
    agentMentions?: readonly DiscussionAgentMention[];
    sourcePanelId?: string;
    mode?: 'inline' | 'text' | 'references' | 'markdown';
  } = $props();
  const parts = $derived(discussionMessageParts(body, workspaceId, agentMentions));
  const references = $derived(
    parts.filter(
      (part): part is DiscussionReference => typeof part !== 'string' && part.kind !== 'mention',
    ),
  );
  const markdown = $derived(discussionMessageMarkdown(parts, workspaceId));
  function navigateMarkdownReference(event: MouseEvent) {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    const reference = parseDiscussionReference(href, anchor.textContent ?? href, workspaceId);
    if (reference || /^intent:/i.test(href.trim())) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (reference) void openDiscussionReference(reference, workspaceId, sourcePanelId, event);
    }
  }
</script>

{#if mode === 'references'}
  {#if references.length}<div class="flex flex-wrap items-start gap-1.5">
      {#each references as reference}{@render chip(reference)}{/each}
    </div>{/if}
{:else if mode === 'markdown'}
  <!-- Native anchors retain their keyboard behavior; capture only canonical discussion references. -->
  <div class="discussion-markdown" onclickcapture={navigateMarkdownReference}>
    <MarkdownViewer
      content={markdown}
      {workspaceId}
      allowFileMedia={false}
      renderRichFencesAsCode
    />
  </div>
{:else}
  <span class="whitespace-pre-wrap wrap-break-word">
    {#each parts as part}
      {#if typeof part === 'string'}{part}{:else if part.kind === 'mention'}<span
          class="rounded bg-primary px-1 font-medium text-primary-foreground"
          data-discussion-agent-mention={part.agentId}>@{part.name}</span
        >{:else if mode === 'inline'}{@render chip(part)}{/if}
    {/each}
  </span>
{/if}

{#snippet chip(reference: DiscussionReference)}
  <Button
    variant="outline"
    size="sm"
    class="h-7 max-w-full gap-1.5 rounded-[10px] px-2 align-middle type-caption"
    onclick={(event) => openDiscussionReference(reference, workspaceId, sourcePanelId, event)}
    title={reference.url}
  >
    <Fa
      icon={reference.kind === 'agent'
        ? faRobot
        : reference.kind === 'pr'
          ? faCodePullRequest
          : faFileLines}
      size="xs"
    />
    <span class="min-w-0 truncate">{reference.label}</span>
  </Button>
{/snippet}

<style>
  .discussion-markdown :global(.markdown-viewer) {
    font-size: inherit;
    line-height: 20px;
  }
  .discussion-markdown :global(p) {
    margin: 0 0 8px;
    line-height: 20px;
  }
  .discussion-markdown :global(p:last-child) {
    margin-bottom: 0;
  }
  .discussion-markdown :global(ul),
  .discussion-markdown :global(ol) {
    margin: 8px 0;
    padding-left: 20px;
  }
  .discussion-markdown :global(li) {
    margin: 0;
    line-height: 20px;
  }
  .discussion-markdown :global(a[href*='/agent/']) {
    border-radius: var(--radius-small);
    padding: 0 4px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    text-decoration: none;
  }
</style>
