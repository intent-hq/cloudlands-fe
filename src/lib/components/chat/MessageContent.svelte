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
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import { parseAgentMessage, parseSuggestedPrompts, type ParsedContent } from '$lib/utils/messageParser';

  // Dynamically import MermaidRenderer to reduce bundle size (used infrequently)
  const MermaidRenderer = import('$lib/components/markdown/MermaidRenderer.svelte');
  import { createLogger } from '$lib/utils/client-logger';
  import { fly } from 'svelte/transition';

  const logger = createLogger('MessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
  }

  let { content, isStreaming = false }: Props = $props();

  // Filter out empty text blocks - computed once when content changes
  // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
  const blocks = $derived.by(() => {
    return (content || []).filter((block) => {
      if (block.type === 'text') {
        const text = block.text || '';
        const { cleanedContent } = parseSuggestedPrompts(text);
        return cleanedContent.trim().length > 0;
      }
      return true;
    });
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
  const parsedContentMap = $derived.by(() => {
    if (isStreaming) return new Map<string, ParsedContent[]>();

    const map = new Map<string, ParsedContent[]>();
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        // Strip suggested prompts before parsing (they're rendered separately in ChatPanel)
        const { cleanedContent } = parseSuggestedPrompts(block.text);
        map.set(block.text, parseAgentMessage(cleanedContent));
      }
    }
    return map;
  });

  // Handle file opening
  function handleOpenFile(detail: {
    path: string;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from message content', detail);
    // Dispatch workspace:open-file event with openInAdjacentPanel and sourcePanelId for panel layout support
    const event = new CustomEvent('workspace:open-file', {
      detail: {
        path: detail.path,
        openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
        sourcePanelId: detail.sourcePanelId,
      },
    });
    window.dispatchEvent(event);
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
      window.dispatchEvent(
        new CustomEvent('workspace:open-note', {
          detail: { noteId: binding.target, openInAdjacentPanel, sourcePanelId },
        }),
      );
    }
  }

  /**
   * Generate a stable unique key for a content block.
   */
  function getBlockKey(block: ContentBlock, index: number): string {
    if (block.id) return block.id;
    if (block.type === 'text') {
      const text = block.text || '';
      const hash = text
        .slice(0, 50)
        .split('')
        .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      return `text-${index}-${hash}`;
    }
    if (block.type === 'tool_result' && block.tool_use_id) {
      return `result-${block.tool_use_id}`;
    }
    return `${block.type}-${index}`;
  }

  // Pre-compute block keys for stable iteration
  const blockKeys = $derived(blocks.map((block, index) => getBlockKey(block, index)));
</script>

<div class="flex flex-col gap-1.5" style="contain: layout style paint;">
  {#each blocks as block, blockIndex (blockKeys[blockIndex])}
    {#if block.type === 'text' && block.text}
      {@const parsedContent = parsedContentMap.get(block.text) || []}
      <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
        {#if isStreaming}
          <!-- During streaming, use simple text display to avoid expensive markdown processing -->
          <div class="streaming-text whitespace-pre-wrap">{block.text}</div>
        {:else if parsedContent.length > 0}
          <!-- Render parsed content blocks -->
          {#each parsedContent as parsedBlock, parsedBlockIndex (`${blockIndex}-${parsedBlock.type}-${parsedBlockIndex}-${(parsedBlock.content || '')
            .slice(0, 20)
            .split('')
            .reduce((a: number, c: string) => a + c.charCodeAt(0), 0)}`)}
            {#if parsedBlock.type === 'augment_code_snippet'}
              <AugmentCodeSnippet
                code={parsedBlock.content}
                language={parsedBlock.metadata?.language}
                path={parsedBlock.metadata?.path}
                mode={parsedBlock.metadata?.mode}
                onOpenFile={handleOpenFile}
              />
            {:else if parsedBlock.type === 'diff'}
              <!-- Render diff viewer for diff blocks -->
              <ChatDiffViewer diff={parsedBlock.content} filePath={parsedBlock.metadata?.path} />
            {:else if parsedBlock.type === 'commit_message'}
              <!-- Render commit message in a nice format -->
              <div
                class="commit-message-block p-3 my-2 rounded-md bg-background border border-border"
              >
                <div class="text-xs font-medium text-muted-foreground mb-1.5">
                  Generated Commit Message
                </div>
                <div class="font-mono text-sm whitespace-pre-wrap text-foreground">
                  {parsedBlock.content}
                </div>
              </div>
            {:else if parsedBlock.type === 'diagram' && parsedBlock.metadata?.diagramData}
              <!-- Render diagram -->
              <div class="diagram-block my-2">
                <DiagramRenderer
                  diagram={parsedBlock.metadata.diagramData as DiagramPrimitive}
                  editable={false}
                  onBindingClick={handleDiagramBindingClick}
                />
              </div>
            {:else if parsedBlock.type === 'patch' && parsedBlock.metadata?.patchData}
              <!-- Render patch block using shared PatchBlockContent (same as notes) -->
              {@const patchData = parsedBlock.metadata.patchData}
              <PatchBlockContent
                patches={[{ filePath: patchData.filePath, diff: patchData.diff }]}
                label={patchData.description || patchData.filePath}
              />
            {:else if parsedBlock.type === 'digest'}
              <!-- Digest card rendered inline where the agent placed it -->
              <DigestCard digest={parsedBlock.content || ''} />
            {:else if parsedBlock.type === 'mermaid'}
              <!-- Render mermaid diagrams -->
              <div class="mermaid-block my-2">
                {#await MermaidRenderer then module}
                  <module.default code={parsedBlock.content || ''} />
                {/await}
              </div>
            {:else if parsedBlock.type === 'code'}
              <!-- Render standalone code blocks with proper syntax highlighting -->
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
          {/each}
        {:else}
          <!-- Fallback to regular MarkdownViewer -->
          <MarkdownViewer
            content={block.text}
            {isStreaming}
            onFileClick={(path) => handleOpenFile({ path })}
          />
        {/if}
      </div>
    {:else if block.type === 'tool_use'}
      {@const toolBlock = block as ToolUseBlock}
      {@const toolResult = toolResultsMap.get(toolBlock.id)}
      {@const toolState = toolStates.get(toolBlock.id) || 'completed'}
      {@const resultContent = toolResult ? toolResult.content : null}
      <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
        <ToolCall toolUse={toolBlock} {toolState} result={resultContent} />
      </div>
    {:else if block.type === 'tool_result'}
      <div class="border border-border rounded-md" in:fly={{ y: 10, duration: 200 }}>
        <div class="px-3 py-2 bg-muted/50 border-b border-border">
          <span class="text-xs text-muted-foreground">Tool Result</span>
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
                <ToolCall toolUse={nestedToolBlock} toolState={nestedToolState} result={nestedResultContent} />
              {/if}
            {/each}
          {/if}
        </div>
      </div>
    {:else if block.type === 'thinking'}
      <details class="p-2 bg-muted/50 rounded-md">
        <summary class="cursor-pointer text-sm text-muted-foreground"> 💭 Thinking... </summary>
        <div class="pl-4 mt-2 text-sm opacity-75">
          <MarkdownViewer content={block.content || 'Processing...'} />
        </div>
      </details>
    {/if}
  {/each}
</div>
