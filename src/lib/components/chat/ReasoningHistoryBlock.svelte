<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBrain } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import { extractReasoningHistory } from './reasoning-heading';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    NESTED_REASONING_SECTION_SEAM_CLASS,
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    content: string;
    isStreaming?: boolean;
    workspaceId?: string;
    adjacentOperationalRow?: boolean;
  }

  let {
    content,
    isStreaming = false,
    workspaceId,
    adjacentOperationalRow = false,
  }: Props = $props();

  const history = $derived(extractReasoningHistory(content));
  const instanceId = $props.id();
</script>

<div class="min-w-0 max-w-full" data-reasoning-history>
  {#each history as item, index (`${item.title ?? 'body'}-${index}`)}
    {@const titleId = item.title ? `reasoning-section-title-${instanceId}-${index}` : undefined}
    <section
      class="{index > 0 && item.title
        ? NESTED_REASONING_SECTION_SEAM_CLASS
        : ''} min-w-0 max-w-full"
      aria-labelledby={titleId}
      data-reasoning-section
      data-reasoning-section-boundary={index > 0 && item.title ? true : undefined}
    >
      {#if item.title}
        {#snippet leading()}
          <Fa icon={faBrain} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
        {/snippet}
        {#snippet summary()}
          <span
            id={titleId}
            class="min-w-0 truncate whitespace-nowrap font-normal"
            data-reasoning-section-title>{item.title}</span
          >
        {/snippet}
        <ChatOperationalRow
          {leading}
          {summary}
          ariaLabel={item.title}
          summaryTitle={item.title}
          {adjacentOperationalRow}
          testId="reasoning-history-row"
          summaryTestId="reasoning-history-title"
        />
      {/if}
      {#if item.body}
        <div
          class="reasoning-history-body {OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
          data-reasoning-history-body
        >
          <MarkdownViewer
            content={item.body}
            {isStreaming}
            {workspaceId}
            taskBlockRenderMode="content"
          />
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .reasoning-history-body :global(.markdown-viewer > *) {
    margin-block: 0 !important;
  }
</style>
