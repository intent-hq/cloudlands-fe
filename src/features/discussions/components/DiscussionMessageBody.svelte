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
    mentionNames = [],
  }: {
    body: string;
    workspaceId: string;
    agentMentions?: readonly DiscussionAgentMention[];
    mentionNames?: readonly string[];
    sourcePanelId?: string;
    mode?: 'inline' | 'text' | 'references' | 'markdown';
  } = $props();
  const parts = $derived(discussionMessageParts(body, workspaceId, agentMentions, mentionNames));
  const references = $derived(
    parts.filter(
      (part): part is DiscussionReference => typeof part !== 'string' && part.kind !== 'mention',
    ),
  );
  const markdown = $derived(discussionMessageMarkdown(parts, workspaceId));
  // Decorate sanitized markdown text nodes only. No HTML parsing, navigation, or
  // delivery metadata is created for ordinary @labels or historical messages.
  function highlightMarkdownMentions(node: HTMLElement, names: readonly string[]) {
    let currentNames = names;
    const observer = new MutationObserver(decorate);
    function decorate() {
      observer.disconnect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (!text.parentElement?.closest('a, code, pre, mark, [data-discussion-text-mention]'))
          texts.push(text);
      }
      for (const text of texts) {
        const fragments = discussionMessageParts(text.data, '', [], currentNames);
        if (!fragments.some((part) => typeof part !== 'string')) continue;
        const fragment = document.createDocumentFragment();
        for (const part of fragments) {
          if (typeof part === 'string') fragment.append(document.createTextNode(part));
          else if (part.kind === 'mention') {
            const mark = document.createElement('mark');
            mark.dataset.discussionTextMention = '';
            mark.textContent = `@${part.name}`;
            fragment.append(mark);
          }
        }
        text.replaceWith(fragment);
      }
      observer.observe(node, { subtree: true, childList: true, characterData: true });
    }
    decorate();
    return {
      update(names: readonly string[]) {
        currentNames = names;
        observer.disconnect();
        for (const mark of node.querySelectorAll('[data-discussion-text-mention]')) {
          const parent = mark.parentNode;
          mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
          parent?.normalize();
        }
        decorate();
      },
      destroy() {
        observer.disconnect();
      },
    };
  }
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
  <div
    class="discussion-markdown"
    use:highlightMarkdownMentions={mentionNames}
    onclickcapture={navigateMarkdownReference}
  >
    <MarkdownViewer
      content={markdown}
      {workspaceId}
      allowFileMedia={false}
      renderRichFencesAsCode
    />
  </div>
{:else}
  <span class="whitespace-pre-wrap wrap-break-word"
    >{#each parts as part}
      {#if typeof part === 'string'}{part}{:else if part.kind === 'mention'}<span
          class="inline-block max-w-full rounded bg-primary px-1 align-bottom font-medium text-primary-foreground"
          data-discussion-mention
          data-discussion-agent-mention={part.agentId}>@{part.name}</span
        >{:else if mode === 'inline'}{@render chip(part)}{/if}
    {/each}</span
  >
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
  .discussion-markdown :global([data-discussion-text-mention]),
  .discussion-markdown :global(a[href*='/agent/']) {
    display: inline-block;
    max-width: 100%;
    border-radius: var(--radius-small);
    padding: 0 4px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    text-decoration: none;
  }
</style>
