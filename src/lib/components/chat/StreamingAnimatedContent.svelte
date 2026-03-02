<script lang="ts">
  import type { ContentBlock, ToolUseBlock, ToolResultBlock } from '$shared/types';
  import ToolCall from './ToolCall.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { fly } from 'svelte/transition';
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('StreamingAnimatedContent');

  interface Props {
    content: string | ContentBlock[];
    isStreaming?: boolean;
    hideToolCalls?: boolean;
  }

  let { content, isStreaming = false, hideToolCalls = false }: Props = $props();

  // State for animated text
  let animatedTexts = $state<Map<number, string>>(new Map());
  let fullTexts = $state<Map<number, string>>(new Map());
  let animationFrames = $state<Map<number, number>>(new Map());

  // Track which tool calls have been shown
  let shownToolCalls = $state<Set<string>>(new Set());

  // Process blocks
  let blocks: ContentBlock[] = $state([]);

  // Track previous content to detect changes
  let previousContent = $state<string>('');
  let streamingCheckInterval: number | null = null;
  let hasInitialized = false;

  // Letter-by-letter animation speed (chars per frame)
  // Adjust based on content length for optimal performance
  const getCharsPerFrame = (textLength: number) => {
    if (textLength > 1000) return 8; // Very fast for long text
    if (textLength > 500) return 4; // Fast for medium text
    if (textLength > 200) return 3; // Normal for short text
    return 2; // Smooth for very short text
  };
  const FRAME_DELAY = 16; // ~60fps

  // Monitor streaming state and ensure animation continues
  $effect(() => {
    if (isStreaming && typeof content === 'string') {
      // Start monitoring for content changes
      if (!streamingCheckInterval) {
        streamingCheckInterval = setInterval(() => {
          const currentFull = fullTexts.get(0) || '';
          const currentAnimated = animatedTexts.get(0) || '';

          // Initialize animated text if needed
          if (!animatedTexts.has(0) && currentFull.length > 0) {
            animatedTexts.set(0, '');
          }

          // If there's unanimated text and no animation running, start it
          if (currentAnimated.length < currentFull.length && !animationFrames.has(0)) {
            startTextAnimation(0);
          }
        }, 100) as unknown as number;
      }
    } else {
      // Stop monitoring when not streaming
      if (streamingCheckInterval) {
        clearInterval(streamingCheckInterval);
        streamingCheckInterval = null;
      }
    }
  });

  // Process content into blocks and handle streaming updates
  $effect(() => {
    // FIX: Track actual content changes, not just length
    // For arrays, we need to track the text content of text blocks to detect updates
    // Using a simple hash of text lengths and types to detect changes efficiently
    const _contentDep =
      typeof content === 'string'
        ? content
        : content
            .map((b) => `${b.type}:${b.type === 'text' ? (b.text || '').length : ''}`)
            .join(',');

    if (!isStreaming) {
      // Not streaming - show everything immediately
      const rawBlocks =
        typeof content === 'string'
          ? ([{ type: 'text', text: content }] as ContentBlock[])
          : content;

      const filtered = rawBlocks.filter((block) => {
        if (hideToolCalls && (block.type === 'tool_use' || block.type === 'tool_result')) {
          return false;
        }
        if (block.type === 'tool_result') {
          const resultBlock = block as ToolResultBlock;
          if (typeof resultBlock.content === 'string') {
            const contentStr = resultBlock.content;
            if (contentStr.includes('\u001b[') || contentStr.includes('🔧 Tool call:')) {
              return false;
            }
          }
        }
        return true;
      });

      // Deduplicate tool_use blocks by ID (keep last occurrence with real input)
      const toolUseLastIndex = new Map<string, number>();
      for (let i = 0; i < filtered.length; i++) {
        if (filtered[i].type === 'tool_use' && filtered[i].id) {
          toolUseLastIndex.set(filtered[i].id!, i);
        }
      }
      blocks = filtered.filter((block, index) => {
        if (block.type === 'tool_use' && block.id) {
          return toolUseLastIndex.get(block.id) === index;
        }
        return true;
      });

      // Set full text immediately when not streaming
      blocks.forEach((block, index) => {
        if (block.type === 'text' && block.text) {
          fullTexts.set(index, block.text);
          animatedTexts.set(index, block.text);
        }
      });

      // Clear previous content tracking
      previousContent = '';
    } else {
      // Streaming - process content updates
      if (typeof content === 'string') {
        // Update blocks
        blocks = [{ type: 'text', text: content }];

        // Check if this is the very first content (initial mount with streaming)
        const isInitialMount = !hasInitialized && content.length > 0;

        // Check if content has changed or this is initial mount
        if (content !== previousContent || isInitialMount) {
          previousContent = content;

          // Update full text
          fullTexts.set(0, content);

          // Handle initial mount - start animation from empty
          if (isInitialMount) {
            hasInitialized = true;
            // Initialize animated text to empty string for animation to start
            animatedTexts.set(0, '');
            // Start animation immediately
            startTextAnimation(0);
          } else {
            // Get current animated position
            const currentAnimated = animatedTexts.get(0) || '';

            // If we haven't started animating yet, initialize
            if (!animatedTexts.has(0) && content.length > 0) {
              animatedTexts.set(0, '');
            }

            // If we're far behind, jump forward
            if (content.length > currentAnimated.length + 50) {
              animatedTexts.set(0, content.slice(0, content.length - 10));
            }

            // Ensure animation is running
            if (!animationFrames.has(0) && currentAnimated.length < content.length) {
              startTextAnimation(0);
            }
          }
        }
      } else if (Array.isArray(content)) {
        logger.debug('Array content update', {
          blockCount: content.length,
          blockTypes: content.map((b) => b.type),
        });

        if (hideToolCalls) {
          blocks = content.filter(
            (block) => block.type !== 'tool_use' && block.type !== 'tool_result',
          );
        } else {
          blocks = content;
        }

        // Update full texts for streaming blocks
        blocks.forEach((block, index) => {
          if (block.type === 'text' && block.text) {
            const currentFull = fullTexts.get(index) || '';
            const newText = block.text;

            // Update if text has changed
            if (newText !== currentFull) {
              fullTexts.set(index, newText);

              // Get current animated position
              const currentAnimated = animatedTexts.get(index) || '';

              // If we're far behind, jump forward
              if (newText.length > currentAnimated.length + 50) {
                animatedTexts.set(index, newText.slice(0, newText.length - 10));
              }

              // Ensure animation is running
              if (!animationFrames.has(index) && currentAnimated.length < newText.length) {
                startTextAnimation(index);
              }
            }
          }
        });
      }
    }
  });

  // Start text animation for a block
  function startTextAnimation(blockIndex: number) {
    // Cancel any existing animation for this block
    const existingFrame = animationFrames.get(blockIndex);
    if (existingFrame) {
      cancelAnimationFrame(existingFrame);
    }

    // Initialize animated text if not present
    if (!animatedTexts.has(blockIndex)) {
      animatedTexts.set(blockIndex, '');
    }

    const animate = () => {
      const fullText = fullTexts.get(blockIndex) || '';
      const currentAnimated = animatedTexts.get(blockIndex) || '';

      if (currentAnimated.length < fullText.length) {
        // Add more characters based on text length
        const charsPerFrame = getCharsPerFrame(fullText.length);
        const nextLength = Math.min(currentAnimated.length + charsPerFrame, fullText.length);
        animatedTexts.set(blockIndex, fullText.slice(0, nextLength));

        // Continue animation
        const frameId = requestAnimationFrame(animate);
        animationFrames.set(blockIndex, frameId);
      } else {
        // Animation caught up - clear frame tracker
        animationFrames.delete(blockIndex);

        // If still streaming, keep checking for new content
        if (isStreaming) {
          const checkForNewContent = () => {
            if (!isStreaming) return; // Stop if streaming ended

            const newFullText = fullTexts.get(blockIndex) || '';
            const currentAnimatedText = animatedTexts.get(blockIndex) || '';

            if (currentAnimatedText.length < newFullText.length) {
              // New content arrived, restart animation
              startTextAnimation(blockIndex);
            } else {
              // No new content yet, check again soon
              setTimeout(checkForNewContent, 50); // Check more frequently
            }
          };

          setTimeout(checkForNewContent, 50);
        }
      }
    };

    // Start immediately
    animate();
  }

  // Cleanup animations on unmount
  onMount(() => {
    return () => {
      // Cancel all animations
      animationFrames.forEach((frameId) => {
        cancelAnimationFrame(frameId);
      });
      animationFrames.clear();

      // Clear streaming check interval
      if (streamingCheckInterval) {
        clearInterval(streamingCheckInterval);
        streamingCheckInterval = null;
      }
    };
  });

  // Track tool states
  let toolStates = $state<Map<string, 'running' | 'completed' | 'error'>>(new Map());
  let toolResults = $state<Map<string, any>>(new Map());

  // Update tool states
  $effect(() => {
    // First pass: collect all tool results with valid tool_use_id
    const resultsMap = new Map<string, ToolResultBlock>();
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultBlock;
        if (resultBlock.tool_use_id) {
          resultsMap.set(resultBlock.tool_use_id, resultBlock);
        }
      }
    }

    // Second pass: match error results with empty tool_use_id to preceding tool_use
    // This handles the case where error results don't have proper IDs
    // SAFEGUARD: Only match if there's no other tool_use between the error and its target
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultBlock;
        const isError = resultBlock.is_error || (resultBlock as any).isError;
        // Only do position-based matching for error results with empty ID
        if (isError && !resultBlock.tool_use_id) {
          // Find the immediately preceding tool_use that doesn't have a result
          // Stop if we encounter another tool_use (to avoid misattribution)
          for (let j = i - 1; j >= 0; j--) {
            const prevBlock = blocks[j];
            if (prevBlock.type === 'tool_use') {
              const toolBlock = prevBlock as ToolUseBlock;
              if (!resultsMap.has(toolBlock.id)) {
                // Match this error result to the preceding tool_use
                resultsMap.set(toolBlock.id, resultBlock);
              }
              // Always break on first tool_use found - either we matched it or it
              // already has a result, in which case we can't safely attribute this error
              break;
            }
          }
        }
      }
    }

    const newToolStates = new Map<string, 'running' | 'completed' | 'error'>();
    const newToolResults = new Map<string, any>();

    // Collect all tool_use block IDs in order for sequential completion heuristic
    const toolUseIds: string[] = [];
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        toolUseIds.push((block as ToolUseBlock).id);
      }
    }

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        const result = resultsMap.get(toolBlock.id);
        if (result) {
          // Check both snake_case and camelCase for error flag
          const isError = result.is_error || (result as any).isError;
          // Also detect errors from content text
          const contentText = typeof result.content === 'string' ? result.content : '';
          const hasErrorInContent =
            contentText.includes('❌') ||
            contentText.startsWith('Error:') ||
            contentText.includes('Tool Error:');
          newToolStates.set(toolBlock.id, isError || hasErrorInContent ? 'error' : 'completed');
          newToolResults.set(toolBlock.id, result.content);
        } else if (!isStreaming) {
          // Streaming finished but no result - mark as completed anyway
          // This prevents tools from appearing stuck in "running" state forever
          newToolStates.set(toolBlock.id, 'completed');
        } else {
          // HEURISTIC: If a later tool_use block exists without a result, this tool
          // must have completed — the agent wouldn't start a new tool call if the
          // previous one hadn't finished. This handles ACP providers (like Codex) that
          // send tool_call events but never send tool_call_update completion events.
          const myIndex = toolUseIds.indexOf(toolBlock.id);
          const hasLaterToolUse = myIndex >= 0 && myIndex < toolUseIds.length - 1;
          if (hasLaterToolUse) {
            newToolStates.set(toolBlock.id, 'completed');
          } else {
            newToolStates.set(toolBlock.id, 'running');
          }
        }

        // Mark tool as shown for animation
        if (!shownToolCalls.has(toolBlock.id)) {
          shownToolCalls.add(toolBlock.id);
        }
      }
    }

    toolStates = newToolStates;
    toolResults = newToolResults;
  });

  // Render streaming text with basic markdown support
  function renderStreamingText(text: string): string {
    if (!text) return '';

    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Convert basic markdown (only safe transformations during streaming)
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Code (inline)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // Preserve spaces
    html = html.replace(/ {2}/g, ' &nbsp;');

    return html;
  }

  /**
   * Generate a stable unique key for a content block.
   */
  function getBlockKey(block: ContentBlock, index: number): string {
    if ((block as any).id) return (block as any).id;
    if (block.type === 'text') {
      const text = block.text || (block as any).content || '';
      const hash = text
        .slice(0, 50)
        .split('')
        .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      return `text-${index}-${hash}`;
    }
    if (block.type === 'tool_result' && (block as any).tool_use_id) {
      return `result-${(block as any).tool_use_id}`;
    }
    return `${block.type}-${index}`;
  }
</script>

<div class="message-content" class:streaming={isStreaming}>
  {#each blocks as block, blockIndex (getBlockKey(block, blockIndex))}
    {#if block.type === 'text' && (block.text || (block as any).content)}
      <div class="text-block">
        {#if isStreaming}
          <!-- Animated streaming text with basic markdown support -->
          <div class="streaming-text-container">
            {@html renderStreamingText(animatedTexts.get(blockIndex) || '')}
          </div>
        {:else}
          <!-- Regular markdown for non-streaming -->
          <MarkdownViewer
            content={block.text || (block as any).content || ''}
            isStreaming={false}
          />
        {/if}
      </div>
    {:else if block.type === 'tool_use'}
      {@const toolBlock = block as ToolUseBlock}
      <div class="tool-call-container" in:fly={{ y: 20, duration: 300, delay: 100 }}>
        <ToolCall
          toolUse={toolBlock}
          toolState={toolStates.get(toolBlock.id) || 'running'}
          result={toolResults.get(toolBlock.id)}
        />
      </div>
    {:else if block.type === 'thinking'}
      <details class="thinking-block" open={isStreaming} in:fly={{ y: 10, duration: 200 }}>
        <summary class="cursor-pointer text-sm text-subtle">
          <span class="thinking-icon">🤔</span>
          Thinking...
        </summary>
        <div class="thinking-content">
          {#if isStreaming}
            <div class="streaming-text-container">
              {@html renderStreamingText(
                animatedTexts.get(blockIndex) || block.content || 'Processing...',
              )}
            </div>
          {:else}
            <MarkdownViewer content={block.content || 'Processing...'} isStreaming={false} />
          {/if}
        </div>
      </details>
    {/if}
  {/each}

  <!-- Show cursor if streaming but no content yet -->
  {#if isStreaming && blocks.length === 0}
    <div class="text-block">
      <span class="cursor standalone">▊</span>
    </div>
  {/if}
</div>

<style>
  .message-content {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    position: relative;
    contain: layout style;
  }

  .text-block {
    width: 100%;
    line-height: 1.6;
  }

  .streaming-text-container {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    display: inline;
  }

  .streaming-text-container :global(strong) {
    font-weight: 600;
    color: var(--text-primary, #111827);
  }

  .streaming-text-container :global(em) {
    font-style: italic;
  }

  .streaming-text-container :global(.inline-code) {
    background: var(--color-surface-2, #f3f4f6);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 0.875em;
    color: var(--text-code, #d97706);
  }

  .cursor {
    display: inline-block;
    animation: blink 1s infinite;
    color: var(--text-subtle, #6b7280);
    margin-left: 2px;
    font-weight: 300;
  }

  .cursor.standalone {
    animation: pulse 1.5s infinite;
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

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.1);
    }
  }

  .tool-call-container {
    position: relative;
    will-change: transform;
  }

  .thinking-block {
    padding: 0.625rem 0.875rem;
    background: linear-gradient(
      135deg,
      var(--color-surface-2, #f3f4f6),
      var(--color-surface-1, #ffffff)
    );
    border-radius: 0.5rem;
    border: 1px solid var(--color-border, #e5e7eb);
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .thinking-block summary {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    user-select: none;
  }

  .thinking-icon {
    animation: thinking 2s infinite;
  }

  @keyframes thinking {
    0%,
    100% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(-10deg);
    }
    75% {
      transform: rotate(10deg);
    }
  }

  .thinking-content {
    margin-top: 0.625rem;
    padding-left: 1.5rem;
    font-size: 0.875rem;
    color: var(--color-text-secondary, #6b7280);
    line-height: 1.5;
  }

  /* Performance optimizations */
  .message-content.streaming {
    will-change: contents;
  }

  .streaming-text-container {
    will-change: contents;
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    .cursor {
      animation: none;
      opacity: 1;
    }
    .cursor.standalone {
      animation: none;
      opacity: 1;
      transform: none;
    }
    .thinking-icon {
      animation: none;
    }
    .thinking-block {
      animation: none;
    }
  }
</style>
