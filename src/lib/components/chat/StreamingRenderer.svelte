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

    // Step 1: Extract code blocks with placeholders to protect from inline transformations
    const codeBlocks: string[] = [];
    // Use null bytes to create a placeholder that's extremely unlikely to collide with user content
    const PLACEHOLDER_PREFIX = '\x00CB_';
    const PLACEHOLDER_SUFFIX = '_\x00';

    // Handle code blocks with matching fence lengths
    // Process iteratively to correctly match opening and closing fences
    let result = '';
    let pos = 0;
    // Match opening fence at start of line: backticks or tildes (3+), optional language
    const openFenceRegex = /^(`{3,}|~{3,})(\w+)?\n/gm;

    let match;
    while ((match = openFenceRegex.exec(text)) !== null) {
      const matchStart = match.index;
      const openFence = match[1];
      const lang = match[2] || 'plaintext';
      const fenceChar = openFence[0]; // ` or ~
      const minLength = openFence.length;

      // Add text before this code block
      result += text.substring(pos, matchStart);

      // Find the closing fence: must be at start of line, same char, N+ repetitions
      // where N is the opening fence length
      const afterOpener = matchStart + match[0].length;
      const closingRegex = new RegExp(`^(${fenceChar}{${minLength},})\\s*$`, 'gm');
      closingRegex.lastIndex = afterOpener;

      const closingMatch = closingRegex.exec(text);
      if (closingMatch && closingMatch.index > afterOpener) {
        // Found valid closing fence
        const code = text.substring(afterOpener, closingMatch.index);
        const placeholder = `${PLACEHOLDER_PREFIX}${codeBlocks.length}${PLACEHOLDER_SUFFIX}`;
        codeBlocks.push(`<pre class="code-block"><code class="language-${lang}">${code}</code></pre>`);
        result += placeholder;
        pos = closingMatch.index + closingMatch[0].length;
        openFenceRegex.lastIndex = pos;
      } else {
        // No closing fence found, treat as literal text
        result += match[0];
        pos = afterOpener;
        openFenceRegex.lastIndex = pos;
      }
    }

    // Add remaining text
    result += text.substring(pos);
    text = result;

    // Step 2: Now do inline transformations (these won't affect placeholders)
    // Handle inline code — extract to placeholders like fenced blocks so its content
    // stays literal (protected from the whitelisted-tag un-escape below)
    text = text.replace(/`([^`]+)`/g, (_match, code) => {
      const placeholder = `${PLACEHOLDER_PREFIX}${codeBlocks.length}${PLACEHOLDER_SUFFIX}`;
      codeBlocks.push(`<code class="inline-code">${code}</code>`);
      return placeholder;
    });

    // Handle bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Handle italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Handle line breaks
    text = text.replace(/\n/g, '<br>');

    // Convert escaped forms of whitelisted harmless inline tags (br/sub/sup) back to
    // real tags so the streaming view matches the final render
    text = text.replace(/&lt;(br\s*\/?)&gt;/gi, '<$1>');
    text = text.replace(/&lt;(\/?(?:sub|sup))&gt;/gi, '<$1>');

    // Step 3: Restore code blocks from placeholders
    // Guard against undefined by checking if the index exists in the array
    text = text.replace(new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'), (_, indexStr) => {
      const index = parseInt(indexStr, 10);
      return codeBlocks[index] !== undefined ? codeBlocks[index] : `${PLACEHOLDER_PREFIX}${indexStr}${PLACEHOLDER_SUFFIX}`;
    });

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
