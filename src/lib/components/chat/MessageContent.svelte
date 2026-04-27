<script lang="ts">
  import type { ContentBlock, ToolUseBlock, ToolResultBlock } from '$shared/types';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import { PatchBlockContent } from '$lib/components/ui/diff';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    groupParsedBlocks,
    groupContentBlocks,
    type ParsedContent,
    type RenderBlock,
    type ContentBlockGroup,
    type RenderContentBlock,
  } from '$lib/utils/messageParser';
  import ResponseGroup from './ResponseGroup.svelte';

  // Dynamically import MermaidRenderer to reduce bundle size (used infrequently)
  const MermaidRenderer = import('$lib/components/markdown/MermaidRenderer.svelte');
  import { createLogger } from '$lib/utils/client-logger';
  import { fly } from 'svelte/transition';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { openWorkspaceFile, openWorkspaceNote } from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';

  const logger = createLogger('MessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
    workspaceId?: string;
  }

  let { content, isStreaming = false, workspaceId }: Props = $props();

  // Filter out empty text blocks and deduplicate tool_use blocks by ID.
  // Deduplication: when a skeleton tool_use (vague label) and its follow-up
  // (descriptive label) both exist with the same ID, keep only the last one.
  // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
  const blocks = $derived.by(() => {
    const filtered = (content || []).filter((block) => {
      if (block.type === 'text') {
        const text = block.text || '';
        const { cleanedContent } = parseSuggestedPrompts(text);
        return cleanedContent.trim().length > 0;
      }
      return true;
    });

    // Deduplicate tool_use blocks: if multiple blocks share the same ID,
    // keep only the last occurrence (which has the real input parameters).
    const toolUseLastIndex = new Map<string, number>();
    for (let i = 0; i < filtered.length; i++) {
      const block = filtered[i];
      if (block.type === 'tool_use' && block.id) {
        toolUseLastIndex.set(block.id, i);
      }
    }

    // Only filter if there are actual duplicates
    if (toolUseLastIndex.size === 0) return filtered;

    return filtered.filter((block, index) => {
      if (block.type === 'tool_use' && block.id) {
        // Keep only the last occurrence of each tool_use ID
        return toolUseLastIndex.get(block.id) === index;
      }
      return true;
    });
  });

  // Group content blocks by <group:Name> tags at the ContentBlock level
  const groupedBlocks = $derived.by(() => {
    return groupContentBlocks(blocks, isStreaming);
  });

  // Build a map of tool results from tool_result blocks
  // Handles both normal matching by tool_use_id AND position-based fallback
  // for error results with empty tool_use_id
  const toolResultsMap = $derived.by(() => {
    const map = new Map<string, ToolResultBlock>();
    const blocks = content || [];

    // First pass: collect results with valid tool_use_id
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultBlock;
        if (resultBlock.tool_use_id) {
          map.set(resultBlock.tool_use_id, resultBlock);
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
              if (!map.has(toolBlock.id)) {
                // Match this error result to the preceding tool_use
                map.set(toolBlock.id, resultBlock);
              }
              // Always break on first tool_use found - either we matched it or it
              // already has a result, in which case we can't safely attribute this error
              break;
            }
          }
        }
      }
    }

    return map;
  });

  // Compute tool states based on results
  const toolStates = $derived.by(() => {
    const states = new Map<string, 'running' | 'completed' | 'error'>();
    for (const block of content || []) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        const result = toolResultsMap.get(toolBlock.id);
        if (result) {
          // Check both snake_case and camelCase for error flag
          const isError = result.is_error || (result as any).isError;
          // Also detect errors from content text
          const contentText = typeof result.content === 'string' ? result.content : '';
          const hasErrorInContent =
            contentText.includes('❌') ||
            contentText.startsWith('Error:') ||
            contentText.includes('Tool Error:');
          states.set(toolBlock.id, isError || hasErrorInContent ? 'error' : 'completed');
        } else if (!isStreaming) {
          // Not streaming and no result - mark as completed
          states.set(toolBlock.id, 'completed');
        } else {
          // Still streaming
          states.set(toolBlock.id, 'running');
        }
      }
    }
    return states;
  });

  // Pre-compute parsed content for all text blocks - memoized via $derived
  // This avoids calling parseAgentMessage in the template loop on every render
  // Keys are "blockIndex" for top-level text blocks and "blockIndex-childIndex" for children inside groups
  const parsedContentMap = $derived.by(() => {
    if (isStreaming) return new Map<string, RenderBlock[]>();

    const map = new Map<string, RenderBlock[]>();
    groupedBlocks.forEach((block, index) => {
      if (block.type === 'text') {
        const contentBlock = block as ContentBlock;
        if (contentBlock.text) {
          const { cleanedContent } = parseSuggestedPrompts(contentBlock.text);
          const parsed = parseAgentMessage(cleanedContent);
          map.set(String(index), groupParsedBlocks(parsed));
        }
      } else if (block.type === 'content_group') {
        const group = block as ContentBlockGroup;
        group.children.forEach((child, childIndex) => {
          if (child.type === 'text' && child.text) {
            const { cleanedContent } = parseSuggestedPrompts(child.text);
            const parsed = parseAgentMessage(cleanedContent);
            map.set(`${index}-${childIndex}`, groupParsedBlocks(parsed));
          }
        });
      }
    });
    return map;
  });

  // Handle file opening
  function handleOpenFile(detail: {
    path: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from message content', detail);
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

  /**
   * Generate a stable unique key for a render content block.
   * Handles both regular ContentBlocks and ContentBlockGroups.
   */
  function getBlockKey(block: RenderContentBlock, index: number): string {
    if (block.type === 'content_group') {
      const group = block as ContentBlockGroup;
      return `group-${index}-${group.name}`;
    }
    const contentBlock = block as ContentBlock;
    if (contentBlock.id) return contentBlock.id;
    if (contentBlock.type === 'text') {
      const text = contentBlock.text || '';
      const hash = text
        .slice(0, 50)
        .split('')
        .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      return `text-${index}-${hash}`;
    }
    if (contentBlock.type === 'tool_result' && contentBlock.tool_use_id) {
      return `result-${contentBlock.tool_use_id}`;
    }
    return `${contentBlock.type}-${index}`;
  }

  // Pre-compute block keys for stable iteration
  const blockKeys = $derived(groupedBlocks.map((block, index) => getBlockKey(block, index)));
</script>

{#snippet renderParsedContentBlock(parsedBlock: ParsedContent)}
  {#if parsedBlock.type === 'augment_code_snippet'}
    <AugmentCodeSnippet
      code={parsedBlock.content}
      language={parsedBlock.metadata?.language}
      path={parsedBlock.metadata?.path}
      mode={parsedBlock.metadata?.mode}
      onOpenFile={handleOpenFile}
    />
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
  {:else if parsedBlock.type === 'patch' && parsedBlock.metadata?.patchData}
    {@const patchData = parsedBlock.metadata.patchData}
    <PatchBlockContent
      patches={[{ filePath: patchData.filePath, diff: patchData.diff }]}
      label={patchData.description || patchData.filePath}
    />
  {:else if parsedBlock.type === 'detected_scripts' && parsedBlock.metadata?.detectedScriptsData}
    <DetectedScriptsCard scripts={parsedBlock.metadata.detectedScriptsData} />
  {:else if parsedBlock.type === 'digest'}
    <DigestCard digest={parsedBlock.content || ''} />
  {:else if parsedBlock.type === 'mermaid'}
    <div class="mermaid-block my-2">
      {#await MermaidRenderer then module}
        <module.default code={parsedBlock.content || ''} />
      {/await}
    </div>
  {:else if parsedBlock.type === 'code'}
    <CodeBlock
      code={parsedBlock.content || ''}
      language={parsedBlock.metadata?.language || 'plaintext'}
    />
  {:else}
    <MarkdownViewer
      content={parsedBlock.content || ''}
      {isStreaming}
      onFileClick={(path) => handleOpenFile({ path })}
    />
  {/if}
{/snippet}

{#snippet renderContentBlock(block: ContentBlock, parsedKey: string, blockIndex: number)}
  {#if block.type === 'text' && block.text}
    {@const parsedContent = parsedContentMap.get(parsedKey) || []}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      {#if isStreaming}
        <!-- During streaming, use simple text display to avoid expensive markdown processing -->
        <div class="streaming-text whitespace-pre-wrap">{block.text}</div>
      {:else if parsedContent.length > 0}
        <!-- Render parsed content blocks -->
        {#each parsedContent as renderBlock, parsedBlockIndex (`${parsedKey}-parsed-${parsedBlockIndex}`)}
          {@render renderParsedContentBlock(renderBlock as ParsedContent)}
        {/each}
      {:else}
        <!-- Only render fallback if text has content after stripping suggested prompts -->
        {@const cleanedText = parseSuggestedPrompts(block.text).cleanedContent}
        {#if cleanedText.trim()}
          <MarkdownViewer
            content={cleanedText}
            {isStreaming}
            onFileClick={(path) => handleOpenFile({ path })}
          />
        {/if}
      {/if}
    </div>
  {:else if block.type === 'tool_use'}
    {@const toolBlock = block as ToolUseBlock}
    {@const toolResult = toolResultsMap.get(toolBlock.id)}
    {@const toolState = toolStates.get(toolBlock.id) || 'completed'}
    {@const resultContent = toolResult ? toolResult.content : null}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      <ToolCall toolUse={toolBlock} {toolState} result={resultContent} {workspaceId} />
    </div>
  {:else if block.type === 'tool_result'}
    <div class="border border-border rounded-md" in:fly={{ y: 10, duration: 200 }}>
      <div class="px-3 py-2 bg-muted/50 border-b border-border">
        <span class="text-xs text-subtle">Tool Result</span>
      </div>
      <div class="p-3">
        {#if typeof block.content === 'string'}
          <CodeBlock code={block.content} />
        {:else if Array.isArray(block.content)}
          <!-- Recursively render nested content blocks -->
          {#each block.content as any[] as nestedBlock, nestedIndex (nestedBlock.id || `nested-${blockIndex}-${nestedIndex}-${nestedBlock.type}`)}
            {#if nestedBlock.type === 'text' && nestedBlock.text}
              <div class="w-full">
                <MarkdownViewer
                  content={nestedBlock.text}
                  onFileClick={(path) => handleOpenFile({ path })}
                />
              </div>
            {:else if nestedBlock.type === 'tool_use'}
              {@const nestedToolBlock = nestedBlock as ToolUseBlock}
              {@const nestedToolResult = toolResultsMap.get(nestedToolBlock.id)}
              {@const nestedToolState = toolStates.get(nestedToolBlock.id) || 'completed'}
              {@const nestedResultContent = nestedToolResult ? nestedToolResult.content : null}
              <ToolCall
                toolUse={nestedToolBlock}
                toolState={nestedToolState}
                result={nestedResultContent}
                {workspaceId}
              />
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {:else if block.type === 'thinking'}
    <details class="p-2 bg-muted/50 rounded-md">
      <summary class="cursor-pointer text-sm text-subtle"> 💭 Thinking... </summary>
      <div class="pl-4 mt-2 text-sm opacity-75">
        <MarkdownViewer content={block.content || 'Processing...'} />
      </div>
    </details>
  {/if}
{/snippet}

<div class="flex flex-col gap-1.5" style="contain: layout style paint;">
  {#each groupedBlocks as block, blockIndex (blockKeys[blockIndex])}
    {#if block.type === 'content_group'}
      {@const group = block as ContentBlockGroup}
      <ResponseGroup
        name={group.name}
        isStreaming={group.isStreaming}
        isLast={blockIndex === groupedBlocks.length - 1}
        blocks={group.children}
      >
        {#snippet children()}
          {#each group.children as childBlock, childIndex (`${blockIndex}-group-${childIndex}`)}
            {@render renderContentBlock(childBlock, `${blockIndex}-${childIndex}`, blockIndex)}
          {/each}
        {/snippet}
      </ResponseGroup>
    {:else}
      {@render renderContentBlock(block as ContentBlock, String(blockIndex), blockIndex)}
    {/if}
  {/each}
</div>
