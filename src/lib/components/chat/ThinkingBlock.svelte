<!--
  ThinkingBlock.svelte

  Tool-call-style display for AI reasoning/thinking content.
-->
<script lang="ts">
  import { safeSlide } from '$lib/utils/animations';
  import Fa from 'svelte-fa';
  import { faBrain } from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { extractReasoningHeading } from './reasoning-heading';
  import {
    OPERATIONAL_DISCLOSURE_CLASS,
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
    OPERATIONAL_ICON_BOX_CLASS,
    OPERATIONAL_ICON_CLASS,
    OPERATIONAL_PRIMARY_CLASS,
    OPERATIONAL_ROW_CONTAINER_CLASS,
    OPERATIONAL_ROW_LINE_CLASS,
    OPERATIONAL_SUMMARY_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    content: string;
    isStreaming?: boolean;
    /** Auto-expand while streaming */
    autoExpandWhileStreaming?: boolean;
    workspaceId?: string;
    class?: string;
  }

  let {
    content,
    isStreaming = false,
    autoExpandWhileStreaming = true,
    workspaceId,
    class: className = '',
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

<div class="{OPERATIONAL_ROW_CONTAINER_CLASS} {className}" data-testid="reasoning-tool-call">
  <div class={OPERATIONAL_ROW_LINE_CLASS} data-operational-disclosure-row>
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-[var(--operational-leading-gap)] border-0 bg-transparent p-0 text-left focus-visible:outline-none"
      onclick={toggle}
      onkeydown={handleDisclosureKeydown}
      aria-expanded={isExpanded}
      aria-label={toggleLabel}
      data-testid="reasoning-disclosure"
    >
      <span class={OPERATIONAL_ICON_BOX_CLASS} data-operational-icon-box>
        <Fa
          icon={faBrain}
          size={18}
          class="{OPERATIONAL_ICON_CLASS} {isStreaming ? 'animate-pulse' : ''}"
        />
      </span>
      <span class="flex min-w-0 flex-1 items-baseline gap-1">
        <span
          class="font-normal {OPERATIONAL_PRIMARY_CLASS} {OPERATIONAL_SUMMARY_CLASS}"
          data-testid="reasoning-summary">{toggleLabel}</span
        >
      </span>
    </button>
  </div>

  {#if isExpanded}
    <div
      class="{OPERATIONAL_EXPANDED_CONTENT_CLASS} type-caption text-muted-foreground [&_p]:my-2 [&_p:first-child]:mt-0 [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
      data-operational-expanded-content
      transition:safeSlide={{ duration: 150 }}
    >
      <MarkdownViewer
        content={reasoningContent.body}
        {isStreaming}
        {workspaceId}
        taskBlockRenderMode="content"
      />
    </div>
  {/if}
</div>

<style>
  .tool-call-container {
    contain: layout style;
  }
</style>
