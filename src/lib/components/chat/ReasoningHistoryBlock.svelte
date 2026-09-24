<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBrain } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import { extractReasoningHistory } from './reasoning-heading';
  import { m } from '$shared/paraglide/messages.js';
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
    searchPath?: string;
  }

  let {
    content,
    isStreaming = false,
    workspaceId,
    adjacentOperationalRow = false,
    searchPath,
  }: Props = $props();

  const history = $derived(extractReasoningHistory(content));
  const instanceId = $props.id();
  let manualExpansion = $state<Record<number, boolean>>({});
  let searchExpansion = $state<Record<number, boolean>>({});

  function expanded(index: number): boolean {
    return (
      searchExpansion[index] ??
      manualExpansion[index] ??
      (isStreaming && index === history.length - 1)
    );
  }

  function toggle(index: number) {
    const next = !expanded(index);
    delete searchExpansion[index];
    manualExpansion[index] = next;
  }
</script>

<div class="min-w-0 max-w-full" data-reasoning-history>
  {#each history as item, index (`${item.title ?? 'body'}-${index}`)}
    {@const titleId = item.title ? `reasoning-section-title-${instanceId}-${index}` : undefined}
    {@const followsBody = !!item.title && index > 0 && !!history[index - 1].body}
    {@const phasePath = searchPath ? `${searchPath}:phase:${index}` : undefined}
    {@const detailsId = `reasoning-phase-details-${instanceId}-${index}`}
    <section
      class="{followsBody ? NESTED_REASONING_SECTION_SEAM_CLASS : ''} min-w-0 max-w-full"
      aria-labelledby={titleId}
      data-reasoning-section
      data-reasoning-section-boundary={followsBody ? true : undefined}
    >
      {#if item.title || item.body}
        {#snippet leading()}
          <Fa icon={faBrain} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
        {/snippet}
        {#snippet summary()}
          <span
            id={titleId}
            class="min-w-0 truncate whitespace-nowrap font-normal"
            data-reasoning-section-title={item.title ? true : undefined}
            >{item.title ?? m.chat_thinkingBlock_reasoning_label()}</span
          >
        {/snippet}
        <ChatOperationalRow
          {leading}
          {summary}
          ariaLabel={item.title ?? m.chat_thinkingBlock_reasoning_label()}
          summaryTitle={item.title ?? m.chat_thinkingBlock_reasoning_label()}
          {adjacentOperationalRow}
          testId="reasoning-history-row"
          summaryTestId="reasoning-history-title"
          interactive={!!item.body}
          showChevron={false}
          expanded={expanded(index)}
          controls={detailsId}
          {detailsId}
          details={item.body && expanded(index) ? body : undefined}
          onclick={() => toggle(index)}
          searchDisclosureId={phasePath && item.body ? `reasoning:${phasePath}` : undefined}
          summarySearchPath={phasePath ? `${phasePath}:summary` : undefined}
          onSearchExpand={() => {
            searchExpansion[index] = true;
          }}
          onSearchRestore={() => {
            delete searchExpansion[index];
          }}
        />
      {/if}
      {#snippet body()}
        <div
          class="reasoning-history-body {OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
          data-reasoning-history-body
          data-chat-search-block-path={phasePath ? `${phasePath}:body` : undefined}
        >
          <MarkdownViewer
            content={item.body}
            {isStreaming}
            {workspaceId}
            taskBlockRenderMode="content"
          />
        </div>
      {/snippet}
    </section>
  {/each}
</div>

<style>
  .reasoning-history-body :global(.markdown-viewer > *) {
    margin-block: 0 !important;
  }
</style>
