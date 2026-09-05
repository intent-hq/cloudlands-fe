<!--
  ThinkingBlock.svelte

  Tool-call-style display for AI reasoning/thinking content.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faBrain } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { extractReasoningHeading } from './reasoning-heading';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
  } from './operational-disclosure-row';
  import ChatOperationalRow from './ChatOperationalRow.svelte';

  interface Props {
    content: string;
    isStreaming?: boolean;
    /** Auto-expand while streaming */
    autoExpandWhileStreaming?: boolean;
    workspaceId?: string;
    class?: string;
    adjacentOperationalRow?: boolean;
    searchPath?: string;
  }

  let {
    content,
    isStreaming = false,
    autoExpandWhileStreaming = true,
    workspaceId,
    class: className = '',
    adjacentOperationalRow = false,
    searchPath,
  }: Props = $props();

  // Auto-expand while streaming, collapse when done
  let isExpanded = $state(false);

  // Track if user has manually toggled
  let userToggled = $state(false);
  let searchPriorExpanded = $state<boolean | undefined>();

  $effect(() => {
    if (!userToggled) {
      isExpanded = autoExpandWhileStreaming && isStreaming;
    }
  });

  function toggle() {
    searchPriorExpanded = undefined;
    userToggled = true;
    isExpanded = !isExpanded;
  }

  function expandForSearch() {
    if (searchPriorExpanded !== undefined || isExpanded) return;
    searchPriorExpanded = false;
    isExpanded = true;
  }

  function restoreAfterSearch() {
    if (searchPriorExpanded === undefined) return;
    isExpanded = searchPriorExpanded;
    searchPriorExpanded = undefined;
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  const reasoningContent = $derived(extractReasoningHeading(content));
  const instanceId = $props.id();
  const detailsId = `reasoning-details-${instanceId}`;
  const toggleLabel = $derived(
    reasoningContent.heading ??
      (isStreaming
        ? m.chat_thinkingBlock_thinking_label()
        : m.chat_thinkingBlock_reasoning_label()),
  );
</script>

{#snippet leading()}
  <Fa
    icon={faBrain}
    size={16}
    class="{CHAT_OPERATIONAL_ICON_CLASS} {isStreaming ? 'animate-pulse' : ''}"
  />
{/snippet}

{#snippet summary()}
  <span class="min-w-0 truncate whitespace-nowrap font-normal">{toggleLabel}</span>
{/snippet}

{#snippet details()}
  <div
    class="reasoning-expanded-body"
    data-reasoning-expanded-body
    data-chat-search-block-path={searchPath ? `${searchPath}:body` : undefined}
  >
    <MarkdownViewer
      content={reasoningContent.body}
      {isStreaming}
      {workspaceId}
      taskBlockRenderMode="content"
    />
  </div>
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  showChevron={false}
  details={isExpanded ? details : undefined}
  interactive
  expanded={isExpanded}
  controls={detailsId}
  {detailsId}
  ariaLabel={toggleLabel}
  summaryTitle={toggleLabel}
  onclick={toggle}
  onkeydown={handleDisclosureKeydown}
  detailsClass="{OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
  {adjacentOperationalRow}
  streaming={isStreaming}
  testId="reasoning-tool-call"
  disclosureTestId="reasoning-disclosure"
  summaryTestId="reasoning-summary"
  searchDisclosureId={reasoningContent.body && searchPath ? `reasoning:${searchPath}` : undefined}
  summarySearchPath={searchPath ? `${searchPath}:summary` : undefined}
  onSearchExpand={expandForSearch}
  onSearchRestore={restoreAfterSearch}
  class={className}
/>

<style>
  .reasoning-expanded-body :global(.markdown-viewer) {
    display: flex;
    flex-direction: column;
    row-gap: 0.5rem;
  }

  .reasoning-expanded-body :global(.markdown-viewer > *) {
    margin-block: 0 !important;
  }

  .reasoning-expanded-body :global(.markdown-viewer :is(h1, h2, h3, h4, h5, h6):not(:first-child)) {
    margin-block-start: 1.5rem !important;
  }

  .reasoning-expanded-body :global(.markdown-viewer :is(br + strong, p > strong:only-child)) {
    display: block;
    margin-block-start: 1.5rem;
  }
</style>
