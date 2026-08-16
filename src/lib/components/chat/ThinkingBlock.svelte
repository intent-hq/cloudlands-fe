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
  }

  let {
    content,
    isStreaming = false,
    autoExpandWhileStreaming = true,
    workspaceId,
    class: className = '',
    adjacentOperationalRow = false,
  }: Props = $props();

  // Auto-expand while streaming, collapse when done
  let isExpanded = $state(false);

  // Track if user has manually toggled
  let userToggled = $state(false);

  $effect(() => {
    if (!userToggled) {
      isExpanded = autoExpandWhileStreaming && isStreaming;
    }
  });

  function toggle() {
    userToggled = true;
    isExpanded = !isExpanded;
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  const reasoningContent = $derived(extractReasoningHeading(content));
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
  <MarkdownViewer
    content={reasoningContent.body}
    {isStreaming}
    {workspaceId}
    taskBlockRenderMode="content"
  />
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  details={isExpanded ? details : undefined}
  interactive
  expanded={isExpanded}
  ariaLabel={toggleLabel}
  onclick={toggle}
  onkeydown={handleDisclosureKeydown}
  detailsClass="{OPERATIONAL_EXPANDED_CONTENT_CLASS} type-caption text-muted-foreground [&_p]:my-2 [&_p:first-child]:mt-0 [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
  {adjacentOperationalRow}
  streaming={isStreaming}
  testId="reasoning-tool-call"
  disclosureTestId="reasoning-disclosure"
  summaryTestId="reasoning-summary"
  class={className}
/>
