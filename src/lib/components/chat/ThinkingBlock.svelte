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

<div
  class="tool-call-container group type-caption font-family-child relative block w-full overflow-hidden text-foreground/75 transition-all duration-[var(--motion-fast)] ease-out hover:text-foreground focus-within:text-foreground {className}"
  data-testid="reasoning-tool-call"
>
  <div class="relative flex min-h-5 w-full min-w-0 items-center gap-1.5 py-0">
    <Fa
      icon={faBrain}
      size={14}
      class="w-4 shrink-0 text-foreground/60 {isStreaming ? 'animate-pulse' : ''}"
    />
    <button
      class="flex min-w-0 items-center gap-1 overflow-hidden border-0 bg-transparent p-0 text-left cursor-pointer"
      style="flex: 0 0.01 auto;"
      onclick={toggle}
      aria-expanded={isExpanded}
    >
      <span class="shrink-0 whitespace-nowrap text-foreground/75">
        {isStreaming
          ? m.chat_thinkingBlock_thinking_label()
          : m.chat_thinkingBlock_reasoning_label()}
      </span>
      {#if !isExpanded}
        <span class="min-w-0 truncate whitespace-nowrap text-foreground/70">{summary}</span>
      {/if}
    </button>
  </div>

  {#if isExpanded}
    <div
      class="type-caption ml-5 pt-1 text-foreground/75 [&_p]:my-2 [&_p:first-child]:mt-0 [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-foreground/75"
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
