<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import { onDestroy } from 'svelte';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';

  interface Props {
    content: string | ContentBlock[];
    isActive: boolean;
  }

  let { content, isActive }: Props = $props();

  let containerEl: HTMLDivElement;
  let rafId: number | null = null;
  let lastRenderedContent = '';
  let contentEl: HTMLDivElement | null = null;
  let cursorEl: HTMLSpanElement | null = null;

  // Simple markdown-to-HTML converter for streaming
  function convertBasicMarkdown(text: string): string {
    // Escape HTML first
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Handle code blocks
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block"><code class="language-${lang || 'plaintext'}">${code}</code></pre>`;
    });

    // Handle inline code
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Handle bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Handle italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Handle line breaks
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  // Extract text from content
  function extractText(content: string | ContentBlock[]): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      // Concatenate ALL text blocks in order
      return content
        .filter((block) => block.type === 'text')
        .map((block) => ('text' in block ? block.text || '' : ''))
        .join('');
    }
    return '';
  }

  // Throttled update using RAF
  function scheduleUpdate() {
    if (rafId !== null) return; // Already scheduled

    rafId = requestAnimationFrame(() => {
      rafId = null;
      performUpdate();
    });
  }

  function performUpdate() {
    if (!containerEl) return;

    if (isActive) {
      const textContent = extractText(content);

      // Only update if content actually changed
      if (textContent === lastRenderedContent) return;
      lastRenderedContent = textContent;

      const html = convertBasicMarkdown(AuggieTextParser.stripDigestTagsForDisplay(textContent));

      // Create or update content element
      if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'streaming-content';
        containerEl.appendChild(contentEl);
      }
      contentEl.innerHTML = html;

      // Create or reuse cursor element (only one cursor ever)
      if (!cursorEl) {
        cursorEl = document.createElement('span');
        cursorEl.className = 'streaming-cursor';
        containerEl.appendChild(cursorEl);
      }
    } else {
      containerEl.innerHTML = '';
      lastRenderedContent = '';
      contentEl = null;
      cursorEl = null;
    }
  }

  // Update DOM when content or isActive changes - throttled with RAF
  $effect(() => {
    // Read content to track it (Svelte 5 requires reading reactive values in $effect)
    content;

    if (isActive) {
      scheduleUpdate();
    } else {
      if (containerEl) {
        containerEl.innerHTML = '';
        lastRenderedContent = '';
      }
    }
  });

  onDestroy(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  });
</script>

<div bind:this={containerEl} class="streaming-renderer" class:active={isActive}></div>

<style>
  .streaming-renderer {
    display: none;
  }

  .streaming-renderer.active {
    display: block;
    line-height: 1.6;
    word-wrap: break-word;
  }

  :global(.streaming-renderer .code-block) {
    background: var(--color-surface-secondary);
    border-radius: 4px;
    padding: 0.75rem;
    margin: 0.5rem 0;
    overflow-x: auto;
  }

  :global(.streaming-renderer .inline-code) {
    background: var(--color-surface-secondary);
    padding: 0.125rem 0.25rem;
    border-radius: 3px;
    font-family: monospace;
    font-size: 0.9em;
  }

  :global(.streaming-renderer .streaming-cursor) {
    display: inline-block;
    animation: blink 1s infinite;
    color: var(--color-primary);
    margin-left: 2px;
  }

  @keyframes blink {
    0%,
    50% {
      opacity: 1;
    }
    51%,
    100% {
      opacity: 0;
    }
  }
</style>
