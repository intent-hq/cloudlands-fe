<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBrain } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import { extractReasoningHistory } from './reasoning-heading';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
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
  let disclosureOverrides = $state<Record<number, boolean>>({});
  const searchPriorState = new Map<number, boolean>();

  function phaseExpanded(index: number): boolean {
    return disclosureOverrides[index] ?? (isStreaming && index === history.length - 1);
  }

  function setPhaseExpanded(index: number, expanded: boolean) {
    disclosureOverrides[index] = expanded;
  }

  function togglePhase(index: number) {
    searchPriorState.delete(index);
    setPhaseExpanded(index, !phaseExpanded(index));
  }

  function expandPhaseForSearch(index: number) {
    if (searchPriorState.has(index) || phaseExpanded(index)) return;
    searchPriorState.set(index, false);
    setPhaseExpanded(index, true);
  }

  function restorePhaseAfterSearch(index: number) {
    const prior = searchPriorState.get(index);
    if (prior === undefined) return;
    searchPriorState.delete(index);
    setPhaseExpanded(index, prior);
  }
</script>

<div class="min-w-0 max-w-full" data-reasoning-history>
  {#each history as item, index (`${item.title ?? 'body'}-${index}`)}
    {@const title = item.title ?? m.chat_thinkingBlock_reasoning_label()}
    {@const titleId = `reasoning-section-title-${instanceId}-${index}`}
    {@const expanded = phaseExpanded(index)}
    {@const phasePath = searchPath ? `${searchPath}:p:${index}` : undefined}
    {@const detailsId = `reasoning-history-details-${instanceId}-${index}`}
    <section
      class="min-w-0 max-w-full"
      aria-labelledby={titleId}
      data-reasoning-section
      data-reasoning-section-boundary={index > 0 && item.title ? true : undefined}
    >
      {#snippet leading()}
        <Fa icon={faBrain} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
      {/snippet}
      {#snippet summary()}
        <span
          id={titleId}
          class="min-w-0 truncate whitespace-nowrap font-normal"
          data-reasoning-section-title>{title}</span
        >
      {/snippet}
      {#snippet details()}
        <div
          class="reasoning-history-body {OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
          data-reasoning-history-body
          data-chat-search-block-path={phasePath}
        >
          <MarkdownViewer
            content={item.body}
            isStreaming={isStreaming && index === history.length - 1}
            {workspaceId}
            taskBlockRenderMode="content"
          />
        </div>
      {/snippet}
      <ChatOperationalRow
        {leading}
        {summary}
        details={item.body && expanded ? details : undefined}
        ariaLabel={title}
        summaryTitle={title}
        interactive={Boolean(item.body)}
        {expanded}
        controls={item.body ? detailsId : undefined}
        detailsId={item.body ? detailsId : undefined}
        onclick={() => togglePhase(index)}
        searchDisclosureId={item.body && phasePath ? `reasoning:${phasePath}` : undefined}
        summarySearchPath={phasePath}
        onSearchExpand={() => expandPhaseForSearch(index)}
        onSearchRestore={() => restorePhaseAfterSearch(index)}
        {adjacentOperationalRow}
        testId="reasoning-history-row"
        summaryTestId="reasoning-history-title"
      />
    </section>
  {/each}
</div>

<style>
  .reasoning-history-body :global(.markdown-viewer) {
    display: flex;
    flex-direction: column;
    row-gap: 0.5rem;
  }

  .reasoning-history-body :global(.markdown-viewer > *) {
    margin-block: 0 !important;
  }
</style>
