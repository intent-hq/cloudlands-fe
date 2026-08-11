<!--
  ThinkingBlock.svelte

  Tool-call-style display for AI reasoning/thinking content.
-->
<script lang="ts">
  import { safeSlide } from '$lib/utils/animations';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
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
  class="tool-call-container group type-caption font-family-child relative block w-full overflow-hidden text-muted-foreground/65 transition-all duration-[var(--motion-fast)] ease-out hover:text-muted-foreground focus-within:text-muted-foreground {className}"
  data-testid="reasoning-tool-call"
>
  <div class="relative flex min-h-5 w-full min-w-0 items-center gap-1.5 py-0">
    <Fa
      icon={faBrain}
      size="xs"
      class="w-4 shrink-0 text-muted-foreground opacity-30 {isStreaming ? 'animate-pulse' : ''}"
    />
    <Button
      variant="plain"
      class="h-auto! min-w-0 justify-start gap-0.5 overflow-hidden text-left font-normal"
      style="flex: 0 0.01 auto;"
      onclick={toggle}
      aria-expanded={isExpanded}
    >
      <span class="shrink-0 whitespace-nowrap text-muted-foreground">
        {isStreaming
          ? m.chat_thinkingBlock_thinking_label()
          : m.chat_thinkingBlock_reasoning_label()}
      </span>
      {#if !isExpanded}
        <span class="min-w-0 truncate whitespace-nowrap text-muted-foreground">{summary}</span>
      {/if}
    </Button>
  </div>

  {#if isExpanded}
    <div
      class="type-caption ml-5 pt-1 text-subtle [&_p]:my-2 [&_p:first-child]:mt-0 [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground"
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
