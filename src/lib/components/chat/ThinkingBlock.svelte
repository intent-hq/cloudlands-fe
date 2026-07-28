<!--
  ThinkingBlock.svelte

  A collapsible display for AI reasoning/thinking content.
  Shows a summary when collapsed and full content when expanded.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
  faChevronRight,
  faBrain,
} from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    content: string;
    isStreaming?: boolean;
    /** Auto-expand while streaming */
    autoExpandWhileStreaming?: boolean;
    class?: string;
  }

  let {
    content,
    isStreaming = false,
    autoExpandWhileStreaming = true,
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
    if (!content) return 'Processing...';
    // Take first 100 chars, clean up
    const cleaned = content.replace(/\n+/g, ' ').trim();
    if (cleaned.length <= 80) return cleaned;
    return cleaned.substring(0, 80).trim() + '...';
  });
</script>

<div class="rounded-lg border border-border bg-muted overflow-hidden {className}">
  <button
    type="button"
    class="flex items-center gap-2 w-full px-3 py-2 bg-transparent border-none cursor-pointer text-left text-muted-foreground text-xs transition-colors duration-150 hover:bg-muted"
    onclick={toggle}
    aria-expanded={isExpanded}
  >
    <div
      class="flex items-center justify-center text-subtle {isStreaming
        ? 'animate-pulse'
        : ''}"
    >
      <Fa icon={faBrain} class="w-3.5 h-3.5" />
    </div>
    <span class="font-medium text-foreground shrink-0">
      {isStreaming ? m.chat_thinkingBlock_thinking_label() : m.chat_thinkingBlock_reasoning_label()}
    </span>
    <div
      class="flex items-center justify-center shrink-0 transition-transform duration-200 {isExpanded
        ? 'rotate-90'
        : ''}"
    >
      <Fa icon={faChevronRight} class="w-3 h-3" />
    </div>
    {#if !isExpanded}
      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap opacity-70 text-xs"
        >{summary}</span
      >
    {/if}
  </button>

  {#if isExpanded}
    <div
      class="px-3 pb-3 text-xs leading-relaxed text-subtle [&_p]:my-2 [&_p:first-child]:mt-0"
      transition:slide={{ duration: 200, easing: cubicOut }}
    >
      <MarkdownViewer {content} {isStreaming} />
    </div>
  {/if}
</div>
