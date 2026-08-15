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

  // Generate a brief summary from the content
  const summary = $derived.by(() => {
    if (!content) return m.chat_shared_processing_fallback();
    // Take first 100 chars, clean up
    const cleaned = content.replace(/\n+/g, ' ').trim();
    if (cleaned.length <= 80) return cleaned;
    return cleaned.substring(0, 80).trim() + '...';
  });
</script>

<div class="{OPERATIONAL_ROW_CONTAINER_CLASS} {className}" data-testid="reasoning-tool-call">
  <div class={OPERATIONAL_ROW_LINE_CLASS} data-operational-disclosure-row>
    <span class={OPERATIONAL_ICON_BOX_CLASS} data-operational-icon-box aria-hidden="true">
      <Fa
        icon={faBrain}
        size={14}
        class="{OPERATIONAL_ICON_CLASS} {isStreaming ? 'animate-pulse' : ''}"
      />
    </span>
    <button
      class="{OPERATIONAL_DISCLOSURE_CLASS} cursor-pointer"
      onclick={toggle}
      aria-expanded={isExpanded}
    >
      <span class="shrink-0 whitespace-nowrap {OPERATIONAL_PRIMARY_CLASS}">
        {isStreaming
          ? m.chat_thinkingBlock_thinking_label()
          : m.chat_thinkingBlock_reasoning_label()}
      </span>
      {#if !isExpanded}
        <span class={OPERATIONAL_SUMMARY_CLASS} data-testid="reasoning-summary">{summary}</span>
      {/if}
    </button>
  </div>

  {#if isExpanded}
    <div
      class="{OPERATIONAL_EXPANDED_CONTENT_CLASS} type-caption ml-5 text-muted-foreground [&_p]:my-2 [&_p:first-child]:mt-0 [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
      data-operational-expanded-content
      transition:safeSlide={{ duration: 150 }}
    >
      <MarkdownViewer {content} {isStreaming} {workspaceId} taskBlockRenderMode="content" />
    </div>
  {/if}
</div>

<style>
  .tool-call-container {
    contain: layout style;
  }
</style>
