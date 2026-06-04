<script lang="ts">
  import type {
    ContentBlock,
    ToolUseBlock,
    ToolResultBlock,
    Proposal,
    ProposalActionDetail,
  } from '$shared/types';
  import { isProposal } from '$shared/types';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import { PatchBlockContent } from '$lib/components/ui/diff';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import ChatWorkspaceCard from './ChatWorkspaceCard.svelte';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    groupParsedBlocks,
    groupContentBlocks,
    filterWorkspaceCardsCoveredByIds,
    type ParsedContent,
    type RenderBlock,
    type ContentBlockGroup,
    type RenderContentBlock,
  } from '$lib/utils/messageParser';
  import ResponseGroup from './ResponseGroup.svelte';
  import NavLink from './NavLink.svelte';
  import ProposalCard from './proposals/ProposalCard.svelte';
  import { applySpecialistProposal } from './proposals/specialist-proposal-actions';
  import {
    applySettingsProposal,
    undoSettingsProposal,
  } from './proposals/settings-proposal-actions';

  import { createLogger } from '$lib/utils/client-logger';
  import { fly } from 'svelte/transition';

  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { applyWorkspaceProposal } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { store as appStore } from '$store/renderer/store';

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

  const bulkProposalWorkspaceIds = $derived.by(() => collectBulkProposalWorkspaceIds(groupedBlocks));

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
          map.set(
            String(index),
            filterWorkspaceCardsCoveredByIds(groupParsedBlocks(parsed), bulkProposalWorkspaceIds),
          );
        }
      } else if (block.type === 'content_group') {
        const group = block as ContentBlockGroup;
        group.children.forEach((child, childIndex) => {
          if (child.type === 'text' && child.text) {
            const { cleanedContent } = parseSuggestedPrompts(child.text);
            const parsed = parseAgentMessage(cleanedContent);
            map.set(
              `${index}-${childIndex}`,
              filterWorkspaceCardsCoveredByIds(groupParsedBlocks(parsed), bulkProposalWorkspaceIds),
            );
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
    appStore.dispatch(
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
      appStore.dispatch(
        openWorkspaceNote(workspaceId, binding.target, { openInAdjacentPanel, sourcePanelId }),
      );
    }
  }

  type NavLinkBlock = ContentBlock & {
    kind?: 'nav-link';
    target: string;
    label?: string;
  };

  function isNavLinkBlock(block: ContentBlock): block is NavLinkBlock {
    const candidate = block as NavLinkBlock;
    return (
      (candidate.kind === 'nav-link' || candidate.type === 'nav-link') &&
      typeof candidate.target === 'string'
    );
  }

  function getProposalFromBlock(block: ContentBlock): Proposal | null {
    if (isProposal(block.proposal)) return block.proposal;
    const candidate = {
      kind: block.kind,
      payload: block.payload ?? {},
      preview: block.preview,
      applyToolCallId: block.applyToolCallId,
    };
    return isProposal(candidate) ? candidate : null;
  }

  function addBulkProposalWorkspaceIds(block: ContentBlock, ids: Set<string>) {
    const proposal = getProposalFromBlock(block);
    if (proposal?.kind !== 'bulk-op') return;
    if (
      proposal.payload.operation !== 'workspace.bulkArchive' &&
      proposal.payload.operation !== 'workspace.bulkDelete'
    ) {
      return;
    }

    proposal.payload.ids.forEach((id: string) => ids.add(id));
  }

  function collectBulkProposalWorkspaceIds(blocks: RenderContentBlock[]): Set<string> {
    const ids = new Set<string>();
    blocks.forEach((block) => {
      if (block.type === 'content_group') {
        (block as ContentBlockGroup).children.forEach((child) => addBulkProposalWorkspaceIds(child, ids));
      } else {
        addBulkProposalWorkspaceIds(block as ContentBlock, ids);
      }
    });
    return ids;
  }

  function handleProposalApply(detail: ProposalActionDetail) {
    const { proposal } = detail;
    if (proposal.kind === 'workspace-create' || proposal.kind === 'bulk-op') {
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal,
          editedFields: detail.editedFields,
          selectedBulkItemIds: detail.selectedBulkItemIds,
        }),
      );
      return;
    }

    if (applySpecialistProposal(detail)) return;
    applySettingsProposal(detail);
  }

  function handleProposalUndo(proposalId: string) {
    undoSettingsProposal(proposalId);
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
    if (isNavLinkBlock(contentBlock)) return `nav-link-${index}-${contentBlock.target}`;
    const proposal = getProposalFromBlock(contentBlock);
    if (proposal)
      return `proposal-${index}-${proposal.kind}-${proposal.applyToolCallId ?? proposal.preview.title}`;
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
  {:else if parsedBlock.type === 'workspace_card' && parsedBlock.metadata?.workspaceCardData}
    <ChatWorkspaceCard workspaceIds={parsedBlock.metadata.workspaceCardData.workspaceIds} />
  {:else if parsedBlock.type === 'nav_link' && parsedBlock.metadata?.navLinkData}
    <NavLink
      target={parsedBlock.metadata.navLinkData.target}
      label={parsedBlock.metadata.navLinkData.label}
    />
  {:else if parsedBlock.type === 'digest'}
    <DigestCard digest={parsedBlock.content || ''} />
  {:else if parsedBlock.type === 'mermaid'}
    <div class="mermaid-block my-2">
      <MermaidRenderer code={parsedBlock.content || ''} />
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
      taskBlockRenderMode="content"
      onFileClick={(path) => handleOpenFile({ path })}
    />
  {/if}
{/snippet}

{#snippet renderContentBlock(block: ContentBlock, parsedKey: string, blockIndex: number)}
  {#if isNavLinkBlock(block)}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      <NavLink target={block.target} label={block.label} />
    </div>
  {:else if getProposalFromBlock(block)}
    {@const proposal = getProposalFromBlock(block)}
    {#if proposal}
      <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
        <ProposalCard {proposal} onApply={handleProposalApply} onUndo={handleProposalUndo} />
      </div>
    {/if}
  {:else if block.type === 'text' && block.text}
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
            taskBlockRenderMode="content"
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
                  taskBlockRenderMode="content"
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
            {:else if getProposalFromBlock(nestedBlock)}
              {@const nestedProposal = getProposalFromBlock(nestedBlock)}
              {#if nestedProposal}
                <ProposalCard
                  proposal={nestedProposal}
                  onApply={handleProposalApply}
                  onUndo={handleProposalUndo}
                />
              {/if}
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {:else if block.type === 'thinking'}
    <details class="p-2 bg-muted/50 rounded-md">
      <summary class="cursor-pointer text-sm text-subtle"> 💭 Thinking... </summary>
      <div class="pl-4 mt-2 text-sm opacity-75">
        <MarkdownViewer content={block.content || 'Processing...'} taskBlockRenderMode="content" />
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
