<script lang="ts">
  import type { ContentBlock, ToolUseBlock, ToolResultBlock } from '$shared/types';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import { PatchBlockContent } from '$lib/components/ui/diff';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import Fa from 'svelte-fa';
  import { faCode, faTerminal, faRobot } from '@fortawesome/free-solid-svg-icons';
  import SetupScriptCard from './SetupScriptCard.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    groupParsedBlocks,
    groupContentBlocks,
    type RenderBlock,
    type ParsedContent,
    type ContentBlockGroup,
    type RenderContentBlock,
  } from '$lib/utils/messageParser';
  import ResponseGroup from './ResponseGroup.svelte';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
  import { createLogger } from '$lib/utils/client-logger';
  import { onDestroy } from 'svelte';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { openWorkspaceFile, openWorkspaceNote } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';

  // Dynamically import MermaidRenderer to reduce bundle size (used infrequently)
  const MermaidRenderer = import('$lib/components/markdown/MermaidRenderer.svelte');

  const logger = createLogger('StreamingMessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
    hideToolCalls?: boolean;
    hideSetupScripts?: boolean;
    workspaceId?: string;
    onSetupScriptGenerated?: (script: {
      name: string;
      description: string;
      content: string;
    }) => void;
  }

  let {
    content,
    isStreaming = false,
    hideToolCalls = false,
    hideSetupScripts = false,
    workspaceId,
    onSetupScriptGenerated,
  }: Props = $props();

  // OPTIMIZATION: Use $derived instead of $effect to avoid triggering re-renders
  let cleanupFunctions: Array<() => void> = [];

  // Cleanup on component destroy
  onDestroy(() => {
    cleanupFunctions.forEach((cleanup) => cleanup());
    cleanupFunctions = [];
  });

  /**
   * Set of block keys that have already been animated.
   * Prevents the slide-up animation from replaying when Svelte
   * recreates DOM elements due to reactive content updates.
   */
  const animatedKeys = new Set<string>();

  /**
   * Svelte action that adds the slide-up animation class once per unique
   * block key, then removes it after the animation completes. Uses a
   * persistent Set to track which keys have already animated, so even if
   * Svelte recreates the DOM element the animation won't replay.
   */
  function animateIn(node: HTMLElement, params: { animate: boolean; key: string }) {
    if (!params.animate || animatedKeys.has(params.key)) return {};

    // Mark as animated immediately
    animatedKeys.add(params.key);

    node.classList.add('content-block--animate-in');

    function onEnd() {
      node.classList.remove('content-block--animate-in');
      node.removeEventListener('animationend', onEnd);
    }

    node.addEventListener('animationend', onEnd);

    return {
      destroy() {
        node.removeEventListener('animationend', onEnd);
      },
    };
  }

  // Use $derived.by for synchronous computation without side effects
  let blocks = $derived.by(() => {
    const rawBlocks = content || [];

    // DEBUG: Log content block types for tool call visibility debugging
    if (isStreaming) {
      const blockTypes = rawBlocks.map((b) => b.type);
      const hasToolUse = blockTypes.includes('tool_use');
      if (hasToolUse) {
        logger.debug('[StreamingMessageContent] blocks derived - has tool_use', {
          blockCount: rawBlocks.length,
          blockTypes,
          hideToolCalls,
        });
      }
    }

    let filtered: ContentBlock[];
    if (!isStreaming) {
      // Not streaming - do full processing
      // Filter out malformed tool_result blocks, empty text blocks, and optionally tool_use blocks
      filtered = rawBlocks.filter((block) => {
        // Filter out tool_use blocks if hideToolCalls is true
        if (hideToolCalls && block.type === 'tool_use') {
          return false;
        }

        // Filter out empty text blocks (prevents blank spots in chat history)
        // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
        if (block.type === 'text') {
          const text = block.text || (block as any).content || '';
          const { cleanedContent } = parseSuggestedPrompts(text);
          if (!cleanedContent.trim()) {
            return false;
          }
        }

        if (block.type === 'tool_result') {
          // Also hide tool_result blocks if hideToolCalls is true
          if (hideToolCalls) {
            return false;
          }

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
    } else {
      // Streaming with content blocks - filter empty text blocks and optionally tool calls
      filtered = rawBlocks.filter((block) => {
        // Filter out tool calls if requested
        if (hideToolCalls && (block.type === 'tool_use' || block.type === 'tool_result')) {
          return false;
        }
        // Filter out empty text blocks during streaming (prevents spacing issues between tool calls)
        // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
        if (block.type === 'text') {
          const text = block.text || (block as any).content || '';
          const { cleanedContent } = parseSuggestedPrompts(text);
          if (!cleanedContent.trim()) {
            return false;
          }
        }
        return true;
      });
    }

    // Deduplicate tool_use blocks: if skeleton + follow-up both exist with same ID,
    // keep only the last one (which has descriptive input parameters).
    const toolUseLastIndex = new Map<string, number>();
    for (let i = 0; i < filtered.length; i++) {
      const block = filtered[i];
      if (block.type === 'tool_use' && block.id) {
        toolUseLastIndex.set(block.id, i);
      }
    }
    if (toolUseLastIndex.size === 0) return filtered;
    return filtered.filter((block, index) => {
      if (block.type === 'tool_use' && block.id) {
        return toolUseLastIndex.get(block.id) === index;
      }
      return true;
    });
  });

  // Group content blocks by <group:Name> tags at the ContentBlock level
  let groupedBlocks = $derived.by(() => {
    return groupContentBlocks(blocks, isStreaming);
  });

  // Track tool states
  let toolStates = $state<Map<string, 'running' | 'completed' | 'error'>>(new Map());

  // Update tool states based on content
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

    // Third pass: set tool states based on whether they have results
    const newToolStates = new Map<string, 'running' | 'completed' | 'error'>();

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        // If there's a result for this tool, mark as completed/error
        // If streaming is done but no result, mark as completed (result may have been lost)
        // Otherwise mark as running
        const result = resultsMap.get(toolBlock.id);
        if (result) {
          // Check both snake_case and camelCase for error flag
          const isError = result.is_error || (result as any).isError;
          // Also detect errors from content text (e.g., "Error:" prefix or "Tool Error:")
          // Note: We no longer check for ❌ emoji as it may be used as a visual indicator in content
          const contentText = typeof result.content === 'string' ? result.content : '';
          const hasErrorInContent =
            contentText.startsWith('Error:') || contentText.includes('Tool Error:');
          newToolStates.set(toolBlock.id, isError || hasErrorInContent ? 'error' : 'completed');
        } else if (!isStreaming) {
          // Streaming finished but no result - mark as completed anyway
          newToolStates.set(toolBlock.id, 'completed');
        } else {
          newToolStates.set(toolBlock.id, 'running');
        }
      }
    }

    // Update state with new maps to trigger reactivity
    toolStates = newToolStates;
  });

  // No need for manual markdown processing - MarkdownViewer handles it

  // Handle file opening from AugmentCodeSnippet
  function handleOpenFile(detail: {
    path: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from code snippet', detail);
    if (!workspaceId) return;
    getReduxStore().dispatch(
      openWorkspaceFile(workspaceId, detail.path, {
        openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
        sourcePanelId: detail.sourcePanelId,
      }),
    );
  }

  // Handle diagram binding clicks (file, note, etc.)
  function handleDiagramBindingClick(e: MouseEvent, binding: { type: string; target: string }) {
    logger.info('Diagram binding clicked', binding);
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    if (binding.type === 'file') {
      handleOpenFile({ path: binding.target, openInAdjacentPanel, sourcePanelId });
    } else if (binding.type === 'note') {
      if (!workspaceId) return;
      getReduxStore().dispatch(
        openWorkspaceNote(workspaceId, binding.target, { openInAdjacentPanel, sourcePanelId }),
      );
    }
  }

  // Parse text blocks to extract augment_code_snippet blocks, digests, and setup scripts
  // PERFORMANCE: Memoize results to avoid re-parsing on every render
  type ParsedTextResult = {
    blocks: RenderBlock[];
    setupScript: { name: string; description: string; content: string } | null;
  };

  // Cache for parsed text blocks - keyed by text content
  let parsedTextCache = new Map<string, ParsedTextResult>();
  const MAX_CACHE_SIZE = 100;

  function parseTextBlock(text: string): ParsedTextResult {
    // Check cache first
    const cached = parsedTextCache.get(text);
    if (cached) {
      return cached;
    }

    // Extract setup script if present
    const setupScript = AuggieTextParser.extractSetupScript(text);
    // Strip suggested prompts (they're rendered separately in ChatPanel)
    const { cleanedContent: contentWithoutSuggestions } = parseSuggestedPrompts(text);
    // Parse the content - this handles digests inline as 'digest' type blocks
    const parsed = parseAgentMessage(contentWithoutSuggestions);
    // Group parsed blocks to wrap group_start/group_end markers into GroupedBlock objects
    const grouped = groupParsedBlocks(parsed);
    const result = { blocks: grouped, setupScript };

    // Cache the result
    parsedTextCache.set(text, result);

    // Limit cache size (LRU-style: remove oldest entries)
    if (parsedTextCache.size > MAX_CACHE_SIZE) {
      const firstKey = parsedTextCache.keys().next().value;
      if (firstKey !== undefined) {
        parsedTextCache.delete(firstKey);
      }
    }

    return result;
  }

  // Pre-compute parsed results for all text blocks to avoid parsing in template
  // This runs once when blocks change, not on every render
  // Keys are "blockIndex" for top-level text blocks and "blockIndex-childIndex" for children inside groups
  let parsedTextBlocks = $derived.by(() => {
    const results = new Map<string, ParsedTextResult>();
    groupedBlocks.forEach((block, index) => {
      if (block.type === 'text') {
        const textContent = (block as ContentBlock).text || (block as any).content || '';
        if (textContent) {
          results.set(String(index), parseTextBlock(textContent));
        }
      } else if (block.type === 'content_group') {
        const group = block as ContentBlockGroup;
        group.children.forEach((child, childIndex) => {
          if (child.type === 'text') {
            const textContent = child.text || (child as any).content || '';
            if (textContent) {
              results.set(`${index}-${childIndex}`, parseTextBlock(textContent));
            }
          }
        });
      }
    });
    return results;
  });

  // Clear animatedKeys when streaming ends to prevent unbounded growth
  // during long conversations (keys are only needed while streaming)
  let prevIsStreaming = false;
  $effect(() => {
    if (prevIsStreaming && !isStreaming) {
      animatedKeys.clear();
    }
    prevIsStreaming = isStreaming;
  });

  // Clear cache when component is destroyed
  onDestroy(() => {
    parsedTextCache.clear();
    animatedKeys.clear();
  });

  /**
   * Generate a stable unique key for a render content block.
   * Handles both regular ContentBlocks and ContentBlockGroups.
   */
  function getBlockKey(block: RenderContentBlock, index: number): string {
    // ContentBlockGroup: use group name + index
    if (block.type === 'content_group') {
      const group = block as ContentBlockGroup;
      return `group-${index}-${group.name}`;
    }

    const contentBlock = block as ContentBlock;

    // If block has an explicit ID, use it (tool_use blocks typically have IDs)
    if (contentBlock.id) {
      return contentBlock.id;
    }

    // For text blocks, use stable index-based key
    if (contentBlock.type === 'text') {
      return `text-${index}`;
    }

    // For thinking blocks
    if (contentBlock.type === 'thinking') {
      return `thinking-${index}`;
    }

    // For tool_result blocks, use the tool_use_id if available
    if (contentBlock.type === 'tool_result' && contentBlock.tool_use_id) {
      return `result-${contentBlock.tool_use_id}`;
    }

    // Fallback: type + index (should rarely be reached)
    return `${contentBlock.type}-${index}`;
  }

  // Pre-compute block keys for stable iteration, ensuring uniqueness
  let blockKeys = $derived.by(() => {
    const keys = groupedBlocks.map((block, index) => getBlockKey(block, index));
    // Ensure uniqueness by appending index if duplicates exist
    const seen = new Map<string, number>();
    return keys.map((key, index) => {
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);
      // If this key was seen before, make it unique by appending the index
      return count > 0 ? `${key}-dup-${index}` : key;
    });
  });

</script>

<!-- Use animated component when streaming with animations enabled -->
<!-- Temporarily disabled streaming animation due to issues -->
<!-- {#if isStreaming && useAnimations}
  <StreamingAnimatedContent {content} {isStreaming} {hideToolCalls} {workspaceId} />
{:else} -->
{#if true}
  {#snippet renderParsedContentBlock(parsedBlock: ParsedContent, blockIndex: number)}
    {#if parsedBlock.type === 'augment_code_snippet'}
      <AugmentCodeSnippet
        code={parsedBlock.content}
        language={parsedBlock.metadata?.language}
        path={parsedBlock.metadata?.path}
        mode={parsedBlock.metadata?.mode}
        onOpenFile={handleOpenFile}
      />
    {:else if parsedBlock.type === 'digest'}
      <DigestCard digest={parsedBlock.content || ''} />
    {:else if parsedBlock.type === 'diff'}
      <ChatDiffViewer diff={parsedBlock.content} filePath={parsedBlock.metadata?.path} />
    {:else if parsedBlock.type === 'commit_message'}
      <div class="commit-message-block p-3 my-2 rounded-md bg-background border border-border">
        <div class="text-xs font-medium text-subtle mb-1.5">Generated Commit Message</div>
        <div class="font-mono text-sm whitespace-pre-wrap text-foreground">
          {parsedBlock.content}
        </div>
      </div>
    {:else if parsedBlock.type === 'diagram' && parsedBlock.metadata?.diagramData}
      <div class="diagram-block my-2">
        <DiagramRenderer
          diagram={parsedBlock.metadata.diagramData as DiagramPrimitive}
          editable={false}
          onBindingClick={handleDiagramBindingClick}
        />
      </div>
    {:else if parsedBlock.type === 'mermaid'}
      <div class="mermaid-block my-8">
        {#await MermaidRenderer then module}
          <module.default code={parsedBlock.content || ''} />
        {/await}
      </div>
    {:else if parsedBlock.type === 'patch' && parsedBlock.metadata?.patchData}
      {@const patchData = parsedBlock.metadata.patchData}
      <PatchBlockContent
        patches={[{ filePath: patchData.filePath, diff: patchData.diff }]}
        label={patchData.description || patchData.filePath}
      />
    {:else if parsedBlock.type === 'detected_scripts' && parsedBlock.metadata?.detectedScriptsData}
      <DetectedScriptsCard scripts={parsedBlock.metadata.detectedScriptsData} />
    {:else if parsedBlock.type === 'reference' && parsedBlock.metadata?.referenceData}
      {@const refData = parsedBlock.metadata.referenceData}
      {@const refFileName = refData.filePath?.split('/').pop() || refData.semanticId || 'Reference'}
      <div class="my-2 rounded-lg border border-border overflow-hidden bg-background">
        <div class="flex items-center gap-2 px-3 py-1.5">
          <Fa icon={faCode} size="xs" class="flex-none text-ghost" />
          <span class="text-sm font-medium truncate">{refFileName}</span>
          {#if refData.filePath && refData.filePath !== refFileName}
            <span class="text-sm text-subtle truncate flex-1 min-w-0">
              {refData.filePath}
            </span>
          {/if}
        </div>
        {#if refData.snapshot?.code}
          <div class="border-t border-border">
            <CodeBlock
              code={refData.snapshot.code}
              language={refData.snapshot.languageId || 'plaintext'}
              showLineNumbers={true}
              noBorder={true}
              noMargin={true}
            />
          </div>
        {/if}
      </div>
    {:else if parsedBlock.type === 'cli' && parsedBlock.metadata?.cliData}
      {@const cliData = parsedBlock.metadata.cliData}
      <div class="my-1.5 flex items-center gap-2">
        <Fa icon={faTerminal} size="sm" class="text-ghost flex-none" />
        <code class="font-mono text-sm text-subtle flex-1 min-w-0 truncate">
          {cliData.command}
        </code>
      </div>
    {:else if parsedBlock.type === 'agent_action' && parsedBlock.metadata?.agentActionData}
      {@const actionData = parsedBlock.metadata.agentActionData}
      <div class="my-1.5 flex items-center gap-2">
        <Fa icon={faRobot} size="sm" class="text-ghost flex-none" />
        <span class="text-sm text-subtle flex-1 min-w-0 truncate">
          {actionData.goal}
        </span>
      </div>
    {:else if parsedBlock.type === 'code'}
      <CodeBlock
        code={parsedBlock.content || ''}
        language={parsedBlock.metadata?.language || 'plaintext'}
      />
    {:else if parsedBlock.type === 'text'}
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
        onFileClick={(path) => handleOpenFile({ path })}
      />
    {:else}
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
        onFileClick={(path) => handleOpenFile({ path })}
      />
    {/if}
  {/snippet}

  {#snippet renderContentBlock(block: ContentBlock, parsedKey: string, blockIndex: number)}
    {#if block.type === 'text' && (block.text || (block as any).content)}
      {@const textContent = block.text || (block as any).content || ''}
      {@const parsedResult = parsedTextBlocks.get(parsedKey) || {
        blocks: [],
        setupScript: null,
      }}
      <div class="w-full">
        <!-- Show setup script card if present (unless hidden) -->
        {#if parsedResult.setupScript && !hideSetupScripts}
          <SetupScriptCard
            name={parsedResult.setupScript.name}
            description={parsedResult.setupScript.description}
            content={parsedResult.setupScript.content}
            onUseScript={onSetupScriptGenerated}
          />
        {/if}
        {#if parsedResult.blocks.length > 0}
          {#each parsedResult.blocks as renderBlock, parsedBlockIndex (`${parsedKey}-parsed-${parsedBlockIndex}`)}
            {@render renderParsedContentBlock(renderBlock as ParsedContent, blockIndex)}
          {/each}
        {:else}
          <!-- Only render fallback if text has content after stripping suggested prompts -->
          <!-- (suggested prompts are rendered separately; empty blocks should be hidden) -->
          {@const cleanedText = parseSuggestedPrompts(textContent).cleanedContent}
          {#if cleanedText.trim()}
            <MarkdownViewer
              content={cleanedText}
              isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
              onFileClick={(path) => handleOpenFile({ path })}
            />
          {/if}
        {/if}
      </div>
    {:else if block.type === 'tool_use'}
      {@const toolBlock = block as ToolUseBlock}
      {@const toolResultBlock = blocks.find(
        (b) => b.type === 'tool_result' && (b as any).tool_use_id === toolBlock.id,
      )}
      {@const resultContent = toolResultBlock ? (toolResultBlock as ToolResultBlock).content : null}
      <div class="relative w-full min-w-0">
        <ToolCall
          toolUse={toolBlock}
          toolState={toolStates.get(toolBlock.id) || 'running'}
          result={resultContent}
          {workspaceId}
        />
      </div>
    {:else if block.type === 'tool_result'}
      <!-- Tool results are handled by associating them with their tool_use blocks -->
      <!-- We don't render them separately as they're shown within the ToolCall component -->
    {:else if block.type === 'thinking'}
      <ThinkingBlock
        content={block.content || 'Processing...'}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
      />
    {/if}
  {/snippet}

  <div
    class="flex flex-col gap-1.5 relative"
    class:streaming={isStreaming}
    style="contain: layout style paint;"
    data-tool-executing={[...toolStates.values()].some((s) => s === 'running')}
  >
    {#each groupedBlocks as block, blockIndex (blockKeys[blockIndex])}
      {#if block.type === 'content_group'}
        {@const group = block as ContentBlockGroup}
        <div class="content-block content-block--group my-1.25" use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}>
          <ResponseGroup
            name={group.name}
            isStreaming={group.isStreaming}
            isLast={blockIndex === groupedBlocks.length - 1}
            blocks={group.children}
          >
            {#snippet children()}
              {#each group.children as childBlock, childIndex (`${blockIndex}-group-${childIndex}`)}
                {#if childBlock.type !== 'tool_result'}
                  <div class="content-block content-block--{childBlock.type} my-1.25">
                    {@render renderContentBlock(
                      childBlock,
                      `${blockIndex}-${childIndex}`,
                      blockIndex,
                    )}
                  </div>
                {/if}
              {/each}
            {/snippet}
          </ResponseGroup>
        </div>
      {:else if ['text', 'tool_use', 'thinking'].includes(block.type)}
        <div class="content-block content-block--{block.type} my-1.25" use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}>
          {@render renderContentBlock(block as ContentBlock, String(blockIndex), blockIndex)}
        </div>
      {/if}
    {/each}

    <!-- Show streaming cursor if streaming but no content yet -->
    {#if isStreaming && groupedBlocks.length === 0}
      <div class="w-full">
        <MarkdownViewer content="" isStreaming={true} />
      </div>
    {/if}
  </div>
{/if}

<!-- End of temporary disable of streaming animation -->

<style>
  /* Adjacent tool_use blocks should have reduced spacing */
  .content-block--tool_use + .content-block--tool_use {
    margin-top: -0.5rem;
  }
  /* Adjacent tool_use blocks should have reduced spacing */
  .content-block--group + .content-block--group {
    margin-top: -0.5rem;
  }

  /* PERF: Content blocks use containment for rendering isolation */
  .content-block {
    contain: layout style;
  }

  /* PERF: Tool use blocks are heavier - use stricter containment */
  .content-block--tool_use {
    contain: layout style paint;
  }

  @keyframes slideUpIn {
    from {
      transform: translateY(24px);
    }
    to {
      transform: translateY(0);
    }
  }

  .content-block--animate-in {
    animation: slideUpIn 250ms ease-out both;
  }
</style>
